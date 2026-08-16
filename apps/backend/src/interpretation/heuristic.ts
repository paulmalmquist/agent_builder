import { createHash } from 'node:crypto';
import type {
  GuardrailsSection,
  KnowledgeSection,
  OutcomesSection,
  OutputsSection,
  SourceDescriptor,
} from '@agent-builder/contracts';

export type InterpretationConfidence = 'high' | 'medium' | 'low';

export interface InterpretedSection<T> {
  value: T | null;
  confidence: InterpretationConfidence;
  unresolved: string[];
  needsReview: boolean;
}

export interface InterpretationDraft {
  outcomes: InterpretedSection<OutcomesSection>;
  knowledge: InterpretedSection<KnowledgeSection>;
  guardrails: InterpretedSection<GuardrailsSection>;
  outputs: InterpretedSection<OutputsSection>;
  authorityWarnings: Array<{
    requestedAction: string;
    disposition: 'approval_required' | 'prohibited';
    message: string;
  }>;
  reuseQuery: string;
}

export interface SplitCandidate {
  id: string;
  title: string;
  prompt: string;
}

export interface HeuristicInterpretationResult {
  kind: 'prefill' | 'split_required';
  draft: InterpretationDraft | null;
  candidates: SplitCandidate[];
}

export interface SpecInterpreter {
  interpret(
    rawPrompt: string,
    sources: readonly SourceDescriptor[],
  ): HeuristicInterpretationResult | Promise<HeuristicInterpretationResult>;
}

const normalize = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const title = (prompt: string): string => {
  const words = prompt
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  const ignored = new Set(['a', 'an', 'agent', 'build', 'create', 'design', 'please', 'the']);
  const useful = words.filter((word) => !ignored.has(word.toLowerCase()));
  const selected = useful.length > 0 ? useful : words;
  return selected
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ')
    .slice(0, 120);
};

const departmentFor = (prompt: string): string => {
  if (/supplier|inventory|procurement|build delay/.test(prompt)) return 'Supply Chain';
  if (/quality|ncr|nonconformance|defect/.test(prompt)) return 'Quality';
  if (/finance|invoice|spend|budget/.test(prompt)) return 'Finance';
  if (/security|incident|vulnerability/.test(prompt)) return 'Security';
  return 'Operations';
};

const sourceTokens = (source: SourceDescriptor): Set<string> =>
  new Set(
    normalize(`${source.id} ${source.displayName} ${source.provider} ${source.uri}`)
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2),
  );

function relevantSources(prompt: string, sources: readonly SourceDescriptor[]): SourceDescriptor[] {
  const promptTokens = new Set(prompt.split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  return sources
    .map((source) => ({
      source,
      score: [...sourceTokens(source)].filter((token) => promptTokens.has(token)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.source.id.localeCompare(right.source.id),
    )
    .slice(0, 4)
    .map(({ source }) => source);
}

function unknownSourceReferences(prompt: string, matched: readonly SourceDescriptor[]): string[] {
  const unresolved: string[] = [];
  const knownText = normalize(
    matched.map((source) => `${source.id} ${source.displayName}`).join(' '),
  );
  const patterns = [
    { expression: /\b(?:our|the)\s+erp\b/, label: 'Map “our ERP” to a governed descriptor.' },
    { expression: /\b(?:our|the)\s+crm\b/, label: 'Map “our CRM” to a governed descriptor.' },
    {
      expression: /\b(?:our|the)\s+data(?:base| warehouse)\b/,
      label: 'Map the requested data store to a governed descriptor.',
    },
  ];
  for (const pattern of patterns) {
    if (pattern.expression.test(prompt) && !pattern.expression.test(knownText)) {
      unresolved.push(pattern.label);
    }
  }
  return unresolved;
}

function splitCandidates(prompt: string): SplitCandidate[] {
  const explicitPairs = [
    ...prompt.matchAll(/(?:when|if)\s+(.+?)\s+(?:then|,|→)\s*(.+?)(?=(?:\bwhen\b|\bif\b|$))/gi),
  ];
  const segments =
    explicitPairs.length >= 2
      ? explicitPairs.map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`.trim())
      : prompt
          .split(/\s+(?:and\s+also|separately|in addition)\s+/i)
          .map((segment) => segment.trim())
          .filter((segment) => segment.length >= 20);
  if (segments.length < 2) return [];
  return segments.slice(0, 5).map((segment, index) => ({
    id: createHash('sha256')
      .update(`${index}:${normalize(segment)}`)
      .digest('hex')
      .slice(0, 24),
    title: title(segment) || `Agent ${index + 1}`,
    prompt: segment,
  }));
}

export class HeuristicSpecInterpreter implements SpecInterpreter {
  interpret(
    rawPrompt: string,
    sources: readonly SourceDescriptor[],
  ): HeuristicInterpretationResult {
    const prompt = rawPrompt.trim();
    const normalized = normalize(prompt);
    const candidates = splitCandidates(prompt);
    if (candidates.length >= 2) return { kind: 'split_required', draft: null, candidates };

    const matched = relevantSources(normalized, sources);
    const unknownSources = unknownSourceReferences(normalized, matched);
    const requestsElevatedAuthority =
      /\b(write|delete|change|update|modify|approve|release|send|contact)\b/.test(normalized) &&
      /\b(production|hold|supplier|record|system|database|erp)\b/.test(normalized);
    const requestsProhibitedAuthority =
      /\b(delete|destroy|bypass|disable|release)\b/.test(normalized) &&
      /\b(production|hold|record|system|database|erp)\b/.test(normalized);
    const authorityWarnings = requestsProhibitedAuthority
      ? [
          {
            requestedAction: 'Destructive production authority',
            disposition: 'prohibited' as const,
            message:
              'The requested destructive production authority is prohibited by the default allowlist.',
          },
        ]
      : requestsElevatedAuthority
        ? [
            {
              requestedAction: 'Write or production authority',
              disposition: 'approval_required' as const,
              message:
                'Requested write authority requires explicit human approval and section review.',
            },
          ]
        : [];
    const department = departmentFor(normalized);
    const derivedTitle = title(prompt) || 'Untitled Agent';
    const purpose = `Assist ${department} with this governed workflow: ${prompt}`.slice(0, 3000);
    const knowledgeValue: KnowledgeSection | null =
      matched.length === 0
        ? null
        : {
            sources: matched.map((source) => ({
              descriptorId: source.id,
              purpose: `Use ${source.displayName} as governed evidence for this workflow`,
              requiredCitations: source.citationRequired,
            })),
          };

    const draft: InterpretationDraft = {
      outcomes: {
        value: {
          name: derivedTitle,
          department,
          purpose,
          audience: `${department} workflow owners`,
          desiredOutcomes: [prompt.slice(0, 500)],
          humanBaseline: null,
          exclusions: ['Do not silently modify production agents or source records'],
        },
        confidence: normalized.length >= 80 ? 'high' : 'medium',
        unresolved: normalized.length < 40 ? ['Clarify the desired business outcome.'] : [],
        needsReview: normalized.length < 80,
      },
      knowledge: {
        value: knowledgeValue,
        confidence:
          matched.length >= 2 && unknownSources.length === 0
            ? 'high'
            : matched.length > 0
              ? 'medium'
              : 'low',
        unresolved:
          unknownSources.length > 0
            ? unknownSources
            : matched.length === 0
              ? ['Select at least one governed source descriptor.']
              : [],
        needsReview: matched.length < 2 || unknownSources.length > 0,
      },
      guardrails: {
        value: {
          workflowStages: [
            'Collect evidence from governed sources',
            'Evaluate the requested outcome against policy',
            'Prepare an approval-ready result',
          ],
          prohibitedActions: ['Do not mutate production systems without explicit authority'],
          approvalRequirements:
            requestsElevatedAuthority && !requestsProhibitedAuthority
              ? ['Human approval is required before every requested write or production action']
              : [],
          failClosedConditions: [
            'Stop when a required governed source is unavailable or evidence conflicts remain unresolved',
          ],
          responseRequirements: {
            citations: true,
            confidence: true,
            unresolvedConflicts: true,
          },
        },
        confidence: requestsElevatedAuthority ? 'low' : 'medium',
        unresolved: authorityWarnings.map(({ message }) => message),
        needsReview: true,
      },
      outputs: {
        value: {
          outputType: 'decision_brief',
          outputSchema: {
            summary: 'string',
            evidence: ['citation'],
            recommendation: 'string',
            confidence: 'number',
          },
          successMetrics: [
            { name: 'Required evidence coverage', operator: 'eq', threshold: 1, unit: 'ratio' },
          ],
          acceptanceTests: [
            {
              name: 'Governed evidence available',
              input: { scenario: 'fixture evidence available' },
              expectedResult: { producesDecisionBrief: true, citesSources: true },
            },
          ],
        },
        confidence: 'medium',
        unresolved: ['Confirm success metrics and acceptance-test fixtures.'],
        needsReview: true,
      },
      authorityWarnings,
      reuseQuery: `${derivedTitle} ${department} ${prompt}`.slice(0, 2000),
    };
    return { kind: 'prefill', draft, candidates: [] };
  }
}
