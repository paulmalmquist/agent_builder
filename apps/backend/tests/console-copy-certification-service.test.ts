import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { consoleCriticalCopyArtifacts } from '@agent-builder/contracts';
import { DeterministicDailyBriefProvider, type ModelProvider } from '@paul-os/runtime';
import type { PrismaClient } from '@prisma/client';
import { runWithPrincipal } from '../src/request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';
import { ConsoleCopyCertificationService } from '../src/services/console-copy-certification-service.js';

const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

async function governedCopy(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      path.join(workspaceRoot, '05-reference', 'console-critical-copy', 'fixtures', 'copy.json'),
      'utf8',
    ),
  ) as unknown;
}

function semanticProvider(): ModelProvider {
  return {
    kind: 'anthropic',
    version: 'test-provider-v1',
    model: 'cold-read-test',
    async *stream(request) {
      await Promise.resolve();
      const input = request.input as { screen: string };
      const source = consoleCriticalCopyArtifacts.find(({ screen }) => screen === input.screen);
      if (source === undefined) throw new Error('UNKNOWN_SCREEN');
      yield {
        type: 'text_delta',
        text: JSON.stringify({
          purpose: source.introduction[0],
          happened: source.introduction[1],
          actions: source.actions.map(({ label, consequence }) => ({ label, consequence })),
        }),
      };
      yield { type: 'usage', usage: { inputTokens: 25, outputTokens: 20 } };
      yield { type: 'complete', stopReason: 'end_turn' };
    },
  };
}

function ledger() {
  const create = jest.fn<Promise<{ id: string }>, [unknown]>(() =>
    Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }),
  );
  const prisma = {
    $transaction: <T>(operation: (transaction: unknown) => Promise<T>) =>
      operation({ auditEvent: { create } }),
  } as unknown as PrismaClient;
  return { prisma, create };
}

function certify(service: ConsoleCopyCertificationService, governedValue: unknown) {
  return runWithPrincipal(
    {
      principalId: '00000000-0000-4000-8000-000000000003',
      actorId: 'human:copy-release-reviewer',
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
      authentication: 'local',
      roles: ['admin'],
      requestId: 'copy-certification-test',
    },
    () =>
      service.certify({
        artifacts: consoleCriticalCopyArtifacts,
        governedValue,
        now: new Date('2026-08-16T12:00:00.000Z'),
        sourceCommit: '0123456789abcdef0123456789abcdef01234567',
      }),
  );
}

describe('ConsoleCopyCertificationService', () => {
  it('persists passing semantic evidence without model answers or screen text', async () => {
    const { prisma, create } = ledger();
    const result = await certify(
      new ConsoleCopyCertificationService(prisma, semanticProvider(), 'direct_allowed'),
      await governedCopy(),
    );

    expect(result).toMatchObject({
      state: 'certified',
      evidenceId: '99999999-9999-4999-8999-999999999999',
      providerKind: 'anthropic',
      sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'console_copy.certified',
        entityType: 'ConsoleCopyBundle',
        entityId: result.copyDigest,
        actorId: 'human:copy-release-reviewer',
        requestId: 'copy-certification-test',
      }),
    });
    const persisted = JSON.stringify(create.mock.calls[0]?.[0]);
    expect(persisted).not.toContain('Review the few items that need you.');
    expect(persisted).not.toContain('Everything else waits for your next briefing.');
    expect(persisted).toContain('answerDigest');
    expect(persisted).toContain('0123456789abcdef0123456789abcdef01234567');
  });

  it('records unavailable semantic evaluation and never grants certification', async () => {
    const { prisma, create } = ledger();
    const result = await certify(
      new ConsoleCopyCertificationService(
        prisma,
        new DeterministicDailyBriefProvider(),
        'direct_allowed',
      ),
      await governedCopy(),
    );

    expect(result.state).toBe('unavailable');
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'console_copy.unavailable' }),
    });
  });

  it('rejects a direct provider under gateway-only policy before any model call', async () => {
    const { prisma, create } = ledger();
    const baseProvider = semanticProvider();
    const stream = jest.fn((...arguments_: Parameters<ModelProvider['stream']>) =>
      baseProvider.stream(...arguments_),
    );
    const provider: ModelProvider = { ...semanticProvider(), stream };
    const result = await certify(
      new ConsoleCopyCertificationService(prisma, provider, 'gateway_only'),
      await governedCopy(),
    );

    expect(result.state).toBe('unavailable');
    expect(stream).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'console_copy.unavailable' }),
    });
  });
});
