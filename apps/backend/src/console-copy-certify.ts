#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { consoleCriticalCopyArtifacts } from '@agent-builder/contracts';
import {
  AnthropicModelProvider,
  DeterministicDailyBriefProvider,
  type ModelProvider,
  type ModelStreamEvent,
} from '@paul-os/runtime';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { runWithPrincipal } from './request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_PRINCIPAL_ID, LOCAL_WORKSPACE_ID } from './scope-constants.js';
import { ConsoleCopyCertificationService } from './services/console-copy-certification-service.js';

const optionalString = (minimum = 1) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(minimum).optional(),
  );

const certificationEnvironmentSchema = z.object({
  MODEL_PROVIDER: z.enum(['deterministic', 'anthropic', 'gateway']).default('deterministic'),
  PROVIDER_POLICY: z.enum(['direct_allowed', 'gateway_only']).default('direct_allowed'),
  MODEL_NAME: optionalString(),
  ANTHROPIC_API_KEY: optionalString(20),
  AUTH_ACTOR_ID: z.string().trim().min(2).max(200).default('local-console-release-approver'),
  CONSOLE_COPY_GOVERNED_PATH: optionalString(),
  CONSOLE_COPY_EVIDENCE_PATH: optionalString(),
  REPOSITORY_SOURCE_COMMIT: optionalString(),
});

class UnavailableSemanticProvider implements ModelProvider {
  readonly version = 'unavailable';

  constructor(
    readonly kind: ModelProvider['kind'],
    readonly model: string,
  ) {}

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    yield* [] as ModelStreamEvent[];
    throw new Error('SEMANTIC_PROVIDER_UNAVAILABLE');
  }
}

function createCertificationProvider(
  environment: z.infer<typeof certificationEnvironmentSchema>,
): ModelProvider {
  if (environment.MODEL_PROVIDER === 'deterministic') {
    return new DeterministicDailyBriefProvider();
  }
  if (
    environment.MODEL_PROVIDER === 'anthropic' &&
    environment.ANTHROPIC_API_KEY !== undefined &&
    environment.MODEL_NAME !== undefined
  ) {
    return new AnthropicModelProvider({
      apiKey: environment.ANTHROPIC_API_KEY,
      model: environment.MODEL_NAME,
    });
  }
  return new UnavailableSemanticProvider(
    environment.MODEL_PROVIDER,
    environment.MODEL_NAME ?? `${environment.MODEL_PROVIDER}-unconfigured`,
  );
}

function repositoryRoot(): string {
  return process.cwd().endsWith(path.join('apps', 'backend'))
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
}

async function main(): Promise<void> {
  const environment = certificationEnvironmentSchema.parse(process.env);
  const governedPath = path.resolve(
    repositoryRoot(),
    environment.CONSOLE_COPY_GOVERNED_PATH ??
      path.join('05-reference', 'console-critical-copy', 'fixtures', 'copy.json'),
  );
  let governedValue: unknown = null;
  try {
    governedValue = JSON.parse(await readFile(governedPath, 'utf8')) as unknown;
  } catch {
    // The service records a failed governed-copy gate without exposing local paths or file contents.
  }

  const prisma = new PrismaClient();
  try {
    const service = new ConsoleCopyCertificationService(
      prisma,
      createCertificationProvider(environment),
      environment.PROVIDER_POLICY,
    );
    const result = await runWithPrincipal(
      {
        principalId: LOCAL_PRINCIPAL_ID,
        actorId: environment.AUTH_ACTOR_ID,
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        authentication: 'local',
        roles: ['admin'],
        requestId: `console-copy-certification:${randomUUID()}`,
      },
      () =>
        service.certify({
          artifacts: consoleCriticalCopyArtifacts,
          governedValue,
          ...(environment.REPOSITORY_SOURCE_COMMIT === undefined
            ? {}
            : { sourceCommit: environment.REPOSITORY_SOURCE_COMMIT }),
        }),
    );
    const evidence = {
      state: result.state,
      evidenceId: result.evidenceId,
      sourceCommit: result.sourceCommit,
      copyDigest: result.copyDigest,
      providerPolicy: result.providerPolicy,
      providerKind: result.providerKind,
      providerVersion: result.providerVersion,
      model: result.model,
      certifiedAt: result.certifiedAt,
      artifactStates: result.artifacts.map(({ screen, deterministic, semantic }) => ({
        screen,
        deterministic: deterministic.passed ? 'passed' : 'failed',
        semantic: semantic.state,
      })),
    };
    const serializedEvidence = `${JSON.stringify(evidence)}\n`;
    if (environment.CONSOLE_COPY_EVIDENCE_PATH !== undefined) {
      await writeFile(
        path.resolve(repositoryRoot(), environment.CONSOLE_COPY_EVIDENCE_PATH),
        serializedEvidence,
        { encoding: 'utf8', flag: 'wx' },
      );
    }
    process.stdout.write(serializedEvidence);
    if (result.state !== 'certified') process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write('Console copy certification could not complete.\n');
  process.exitCode = 1;
});
