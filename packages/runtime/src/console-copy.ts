import { createHash } from 'node:crypto';
import { consoleCopyArtifactListSchema, type ConsoleCopyArtifact } from '@agent-builder/contracts';
import { z } from 'zod';
import { collectModelStream, type ModelProvider, type ModelUsage } from './model-provider.js';

export type { ConsoleCopyAction, ConsoleCopyArtifact } from '@agent-builder/contracts';

export interface ConsoleCopyIssue {
  code:
    | 'missing_cold_read_line'
    | 'sentence_too_long'
    | 'passive_voice'
    | 'unexplained_acronym'
    | 'missing_action_consequence'
    | 'missing_action_undo';
  path: string;
  message: string;
}

export interface ConsoleCopyEvaluation {
  passed: boolean;
  evaluatorKind: 'deterministic_readability';
  evaluatorVersion: '1.0.0';
  issues: ConsoleCopyIssue[];
}

const allowedAcronyms = new Set(['OS', 'USD']);

function sentences(value: string): string[] {
  return value
    .replaceAll(/\{\{[^}]+\}\}/g, ' value ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function wordCount(value: string): number {
  return value.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g)?.length ?? 0;
}

function isExplained(value: string, acronym: string): boolean {
  const escaped = acronym.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[A-Za-z][A-Za-z -]{2,}\\(${escaped}\\)`).test(value);
}

function checkText(value: string, path: string, issues: ConsoleCopyIssue[]): void {
  for (const [index, sentence] of sentences(value).entries()) {
    const count = wordCount(sentence);
    if (count > 16) {
      issues.push({
        code: 'sentence_too_long',
        path: `${path}.sentence.${index}`,
        message: `Sentence has ${count} words; critical console copy allows at most 16`,
      });
    }
    if (/\b(?:is|are|was|were|be|been|being)\s+\w+(?:ed|en)\b/i.test(sentence)) {
      issues.push({
        code: 'passive_voice',
        path: `${path}.sentence.${index}`,
        message: 'Use an active verb in critical console copy',
      });
    }
  }

  for (const acronym of value.match(/\b[A-Z]{2,6}\b/g) ?? []) {
    if (!allowedAcronyms.has(acronym) && !isExplained(value, acronym)) {
      issues.push({
        code: 'unexplained_acronym',
        path,
        message: `Expand ${acronym} on first use`,
      });
    }
  }
}

export function evaluateConsoleCopy(artifact: ConsoleCopyArtifact): ConsoleCopyEvaluation {
  const issues: ConsoleCopyIssue[] = [];
  if (artifact.introduction.length < 2) {
    issues.push({
      code: 'missing_cold_read_line',
      path: 'introduction',
      message: 'Critical screens need two opening lines for a context-free reader',
    });
  }
  artifact.introduction.forEach((line, index) => checkText(line, `introduction.${index}`, issues));
  artifact.body?.forEach((line, index) => checkText(line, `body.${index}`, issues));
  artifact.actions.forEach((action, index) => {
    checkText(action.label, `actions.${index}.label`, issues);
    if (action.consequence.trim().length === 0) {
      issues.push({
        code: 'missing_action_consequence',
        path: `actions.${index}.consequence`,
        message: 'Every action must state its consequence',
      });
    } else {
      checkText(action.consequence, `actions.${index}.consequence`, issues);
    }
    if (action.undo.trim().length === 0) {
      issues.push({
        code: 'missing_action_undo',
        path: `actions.${index}.undo`,
        message: 'Every action must state how it can be undone or say that it is permanent',
      });
    } else {
      checkText(action.undo, `actions.${index}.undo`, issues);
    }
  });
  return {
    passed: issues.length === 0,
    evaluatorKind: 'deterministic_readability',
    evaluatorVersion: '1.0.0',
    issues,
  };
}

export interface ColdReadAnswer {
  purpose: string;
  happened: string;
  actions: readonly { label: string; consequence: string }[];
}

export interface SemanticColdReadEvaluator {
  readonly kind: string;
  readonly version: string;
  evaluate(copyOnly: string, signal?: AbortSignal): Promise<ColdReadAnswer>;
}

const coldReadAnswerSchema = z.object({
  purpose: z.string().trim().min(1).max(1_000),
  happened: z.string().trim().min(1).max(1_000),
  actions: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(120),
        consequence: z.string().trim().min(1).max(1_000),
      }),
    )
    .max(20),
});

const semanticStopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'before',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'with',
]);

function semanticTokens(value: string): Set<string> {
  return new Set(
    (value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => token.length > 2 && !semanticStopWords.has(token),
    ),
  );
}

function demonstratesMeaning(left: string, right: string): boolean {
  const leftTokens = semanticTokens(left);
  const rightTokens = semanticTokens(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const smallerVocabulary = Math.min(leftTokens.size, rightTokens.size);
  return overlap >= 2 && overlap / smallerVocabulary >= 0.5;
}

export interface SemanticColdReadResult {
  state: 'certified' | 'failed' | 'unavailable';
  evaluatorKind: string;
  evaluatorVersion: string;
  providerKind: ModelProvider['kind'];
  model: string;
  answer: ColdReadAnswer | null;
  usage: ModelUsage | null;
  reason: string | null;
}

export interface GovernedConsoleCopyCheck {
  matches: boolean;
  canonicalDigest: string;
  governedDigest: string | null;
  reason: string | null;
}

export interface ConsoleCopyArtifactCertification {
  screen: string;
  deterministic: ConsoleCopyEvaluation;
  semantic: Omit<SemanticColdReadResult, 'answer'> & { answerDigest: string | null };
}

export interface ConsoleCopyBundleCertification {
  state: 'certified' | 'failed' | 'unavailable';
  copyDigest: string;
  governedCopy: GovernedConsoleCopyCheck;
  evaluatorKind: 'console_copy_bundle';
  evaluatorVersion: '1.1.0';
  providerPolicy: 'direct_allowed' | 'gateway_only';
  providerKind: ModelProvider['kind'];
  providerVersion: string;
  model: string;
  artifacts: ConsoleCopyArtifactCertification[];
  certifiedAt: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function consoleCopyDigest(artifacts: readonly ConsoleCopyArtifact[]): string {
  const parsed = consoleCopyArtifactListSchema.parse(artifacts);
  return createHash('sha256').update(canonicalJson(parsed)).digest('hex');
}

export function checkGovernedConsoleCopy(
  canonicalArtifacts: readonly ConsoleCopyArtifact[],
  governedValue: unknown,
): GovernedConsoleCopyCheck {
  const canonical = consoleCopyArtifactListSchema.parse(canonicalArtifacts);
  const canonicalDigest = consoleCopyDigest(canonical);
  const governed = consoleCopyArtifactListSchema.safeParse(governedValue);
  if (!governed.success) {
    return {
      matches: false,
      canonicalDigest,
      governedDigest: null,
      reason: 'The governed console-copy artifact is invalid',
    };
  }
  const governedDigest = consoleCopyDigest(governed.data);
  return {
    matches: governedDigest === canonicalDigest,
    canonicalDigest,
    governedDigest,
    reason:
      governedDigest === canonicalDigest
        ? null
        : 'The governed console-copy artifact differs from the rendered copy bundle',
  };
}

export async function evaluateSemanticColdRead(
  artifact: ConsoleCopyArtifact,
  provider: ModelProvider,
  providerPolicy: 'direct_allowed' | 'gateway_only',
  signal?: AbortSignal,
): Promise<SemanticColdReadResult> {
  if (providerPolicy === 'gateway_only' && provider.kind !== 'gateway') {
    return {
      state: 'unavailable',
      evaluatorKind: 'semantic_cold_read',
      evaluatorVersion: '1.1.0',
      providerKind: provider.kind,
      model: provider.model,
      answer: null,
      usage: null,
      reason: 'gateway_only requires an approved gateway evaluator',
    };
  }
  if (provider.kind === 'deterministic') {
    return {
      state: 'unavailable',
      evaluatorKind: 'semantic_cold_read',
      evaluatorVersion: '1.1.0',
      providerKind: provider.kind,
      model: provider.model,
      answer: null,
      usage: null,
      reason: 'Semantic certification requires a configured semantic provider',
    };
  }

  const copyOnly = [
    ...artifact.introduction,
    ...(artifact.body ?? []),
    ...artifact.actions.flatMap((action) => [action.label, action.consequence, action.undo]),
  ].join('\n');
  const result = await collectModelStream(
    provider,
    {
      system:
        'Read only the supplied screen copy. Return JSON with purpose, happened, and actions. Each action needs its visible label and consequence. Do not use outside platform context.',
      input: { screen: artifact.screen, copyOnly },
      context: {},
      maxOutputTokens: 800,
      timeoutMs: 60_000,
    },
    signal,
  );
  let answer: ColdReadAnswer;
  try {
    const parsedJson: unknown = JSON.parse(result.text);
    answer = coldReadAnswerSchema.parse(parsedJson);
  } catch {
    return {
      state: 'failed',
      evaluatorKind: 'semantic_cold_read',
      evaluatorVersion: '1.1.0',
      providerKind: provider.kind,
      model: provider.model,
      answer: null,
      usage: result.usage,
      reason: 'The evaluator returned an invalid structured cold-read answer',
    };
  }
  const expectedLabels = artifact.actions.map((action) => action.label.toLocaleLowerCase());
  const returnedLabels = new Set(answer.actions.map((action) => action.label.toLocaleLowerCase()));
  const actionsUnderstood = expectedLabels.every((label) => returnedLabels.has(label));
  const copyMeaning = copyOnly;
  const screenUnderstood =
    demonstratesMeaning(answer.purpose, artifact.introduction[0] ?? copyMeaning) &&
    demonstratesMeaning(answer.happened, artifact.introduction[1] ?? copyMeaning);
  const consequencesUnderstood = artifact.actions.every((action) => {
    const returned = answer.actions.find(
      (candidate) => candidate.label.toLocaleLowerCase() === action.label.toLocaleLowerCase(),
    );
    return returned !== undefined && demonstratesMeaning(returned.consequence, action.consequence);
  });
  const passed = actionsUnderstood && screenUnderstood && consequencesUnderstood;
  return {
    state: passed ? 'certified' : 'failed',
    evaluatorKind: 'semantic_cold_read',
    evaluatorVersion: '1.1.0',
    providerKind: provider.kind,
    model: provider.model,
    answer,
    usage: result.usage,
    reason: passed
      ? null
      : 'The evaluator could not explain the screen purpose, event, and every visible action',
  };
}

function semanticEvidence(result: SemanticColdReadResult) {
  return {
    state: result.state,
    evaluatorKind: result.evaluatorKind,
    evaluatorVersion: result.evaluatorVersion,
    providerKind: result.providerKind,
    model: result.model,
    usage: result.usage,
    reason: result.reason,
    answerDigest:
      result.answer === null
        ? null
        : createHash('sha256').update(canonicalJson(result.answer)).digest('hex'),
  };
}

export async function certifyConsoleCopyBundle(input: {
  artifacts: readonly ConsoleCopyArtifact[];
  governedValue: unknown;
  provider: ModelProvider;
  providerPolicy: 'direct_allowed' | 'gateway_only';
  now?: Date;
  signal?: AbortSignal;
}): Promise<ConsoleCopyBundleCertification> {
  const artifacts = consoleCopyArtifactListSchema.parse(input.artifacts);
  const governedCopy = checkGovernedConsoleCopy(artifacts, input.governedValue);
  const deterministic = artifacts.map((artifact) => evaluateConsoleCopy(artifact));
  const deterministicPassed = deterministic.every(({ passed }) => passed);
  const canRunSemantic = governedCopy.matches && deterministicPassed;
  const artifactResults: ConsoleCopyArtifactCertification[] = [];

  for (const [index, artifact] of artifacts.entries()) {
    let semantic: SemanticColdReadResult;
    if (!canRunSemantic) {
      semantic = {
        state: 'unavailable',
        evaluatorKind: 'semantic_cold_read',
        evaluatorVersion: '1.1.0',
        providerKind: input.provider.kind,
        model: input.provider.model,
        answer: null,
        usage: null,
        reason: governedCopy.matches
          ? 'Deterministic copy checks must pass before semantic certification'
          : 'Governed copy must match the rendered bundle before semantic certification',
      };
    } else {
      try {
        semantic = await evaluateSemanticColdRead(
          artifact,
          input.provider,
          input.providerPolicy,
          input.signal,
        );
      } catch {
        semantic = {
          state: 'unavailable',
          evaluatorKind: 'semantic_cold_read',
          evaluatorVersion: '1.1.0',
          providerKind: input.provider.kind,
          model: input.provider.model,
          answer: null,
          usage: null,
          reason: 'The semantic evaluator was unavailable before certification completed',
        };
      }
    }
    artifactResults.push({
      screen: artifact.screen,
      deterministic: deterministic[index] as ConsoleCopyEvaluation,
      semantic: semanticEvidence(semantic),
    });
  }

  const state =
    !governedCopy.matches || !deterministicPassed
      ? 'failed'
      : artifactResults.some(({ semantic }) => semantic.state === 'failed')
        ? 'failed'
        : artifactResults.some(({ semantic }) => semantic.state === 'unavailable')
          ? 'unavailable'
          : 'certified';
  return {
    state,
    copyDigest: governedCopy.canonicalDigest,
    governedCopy,
    evaluatorKind: 'console_copy_bundle',
    evaluatorVersion: '1.1.0',
    providerPolicy: input.providerPolicy,
    providerKind: input.provider.kind,
    providerVersion: input.provider.version,
    model: input.provider.model,
    artifacts: artifactResults,
    certifiedAt: (input.now ?? new Date()).toISOString(),
  };
}
