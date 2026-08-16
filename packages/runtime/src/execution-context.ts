import type { JsonValue } from '@agent-builder/contracts';
import {
  assembleContext,
  type AssembledContext,
  type ContextLayer,
  type ContextProvenance,
} from './context-assembly.js';
import { loadPrivateProfileLayer } from './profile.js';

const dailyBriefCoreLayer: ContextLayer = {
  source: 'core',
  values: {
    workflow: 'daily-brief',
    executionPolicy: {
      externalWritesAllowed: false,
      citationsMustReferenceRunInput: true,
    },
  },
  allow: [],
  deny: ['write:external', 'write:production'],
  mandatoryProtocols: ['bounded-authority', 'citation-provenance'],
  provenance: {
    origin: 'paul-os:daily-brief-core',
    classification: 'public',
  },
};

export const defaultDailyBriefExecutionContext = assembleContext([dailyBriefCoreLayer]);

export interface ExecutionContextSummary {
  provenance: Array<Pick<ContextProvenance, 'source' | 'classification' | 'tokenContribution'>>;
  classification: AssembledContext['classification'];
  estimatedTokens: number;
}

/**
 * Builds the ephemeral daily-brief context in the canonical precedence order. The private layer is
 * optional for the local bootstrap path, but an unreadable or invalid configured file fails closed.
 */
export async function loadDailyBriefExecutionContext(
  profilePath: string,
): Promise<AssembledContext> {
  const privateProfile = await loadPrivateProfileLayer(profilePath);
  return privateProfile === null
    ? defaultDailyBriefExecutionContext
    : assembleContext([dailyBriefCoreLayer, privateProfile]);
}

/** Returns the only context metadata that may cross the persistence/API boundary. */
export function summarizeExecutionContext(context: AssembledContext): ExecutionContextSummary {
  return {
    provenance: context.provenance.map(({ source, classification, tokenContribution }) => ({
      source,
      classification,
      tokenContribution,
    })),
    classification: context.classification,
    estimatedTokens: context.estimatedTokens,
  };
}

/**
 * Produces the provider payload in memory. Callers must never persist or log the returned value.
 */
export function providerContextValues(context: AssembledContext): Record<string, JsonValue> {
  return context.values;
}
