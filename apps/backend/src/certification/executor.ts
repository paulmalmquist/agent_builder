import { jsonValueSchema, type AgentManifest, type JsonValue } from '@agent-builder/contracts';
import { z } from 'zod';

export interface AgentExecutionResult {
  output: JsonValue;
  citations: string[];
  attemptedActions: string[];
  resolved: boolean;
}

export interface AgentExecutor {
  readonly kind: string;
  readonly version: string;
  readonly evaluationMode: string;
  execute(manifest: AgentManifest, caseInput: JsonValue): Promise<AgentExecutionResult>;
}

const fixtureExecutionEnvelopeSchema = z
  .object({
    __fixture: z
      .object({
        output: jsonValueSchema,
        citations: z.array(z.string()),
        attemptedActions: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function stringArrayAt(value: JsonValue, keys: readonly string[]): string[] {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return [];
  for (const key of keys) {
    const candidate = value[key];
    if (Array.isArray(candidate) && candidate.every((entry) => typeof entry === 'string')) {
      return [...new Set(candidate)].sort();
    }
  }
  return [];
}

/**
 * First-party deterministic certification executor.
 *
 * This deliberately measures fixture/corpus coverage agreement. It does not
 * claim to measure semantic model quality. The executor metadata persisted on
 * each run and rendered by the frontend makes that boundary explicit.
 */
export class ManifestFixtureExecutor implements AgentExecutor {
  readonly kind = 'manifest_fixture';
  readonly evaluationMode = 'corpus_coverage';

  constructor(readonly version = '1.0.0') {}

  execute(manifest: AgentManifest, rawInput: JsonValue): Promise<AgentExecutionResult> {
    const caseInput = jsonValueSchema.parse(rawInput);
    const canonicalInput = canonicalJson(caseInput);
    const evaluation = manifest.evaluations.find(
      (candidate) => canonicalJson(candidate.input) === canonicalInput,
    );
    if (!evaluation) {
      return Promise.resolve({
        output: null,
        citations: [],
        attemptedActions: [],
        resolved: false,
      });
    }

    const envelope = fixtureExecutionEnvelopeSchema.safeParse(evaluation.expectedResult);
    if (envelope.success) {
      return Promise.resolve({
        output: envelope.data.__fixture.output,
        citations: [...new Set(envelope.data.__fixture.citations)].sort(),
        attemptedActions: [...new Set(envelope.data.__fixture.attemptedActions)].sort(),
        resolved: true,
      });
    }
    const output = jsonValueSchema.parse(evaluation.expectedResult);
    const embeddedCitations = stringArrayAt(output, ['citations', 'citationIds', 'sources']);
    return Promise.resolve({
      output,
      citations: embeddedCitations,
      attemptedActions: stringArrayAt(output, ['attemptedActions', 'actions']),
      resolved: true,
    });
  }
}

export const canonicalizeCertificationJson = canonicalJson;
