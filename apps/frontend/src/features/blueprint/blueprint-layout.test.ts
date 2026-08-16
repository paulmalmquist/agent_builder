import { describe, expect, it } from 'vitest';
import type { AgentSpec } from '@agent-builder/contracts';
import { layoutBlueprint, truncateBlueprintText } from './blueprint-layout';

const baseSpec: AgentSpec = {
  id: '11111111-1111-4111-8111-111111111111',
  agentId: '22222222-2222-4222-8222-222222222222',
  baseAgentId: null,
  derivationMode: 'new',
  interpretationId: null,
  unconfirmedPrefill: null,
  status: 'draft',
  revision: 3,
  outcomes: {
    name: 'Supplier briefing agent',
    department: 'Supply Chain Operations',
    purpose: 'Prepare a governed supplier risk briefing for operations leaders every morning.',
    audience: 'Operations leadership',
    desiredOutcomes: ['Surface material supplier risks', 'Cite governed evidence'],
    humanBaseline: null,
    exclusions: [],
  },
  knowledge: null,
  guardrails: null,
  outputs: null,
  completion: {
    outcomes: true,
    knowledge: false,
    guardrails: false,
    outputs: false,
  },
  createdAt: '2026-07-30T13:30:00.000Z',
  updatedAt: '2026-07-31T14:45:00.000Z',
};

describe('layoutBlueprint', () => {
  it('lays out an empty draft as four pending stations', () => {
    const layout = layoutBlueprint(null, 1_200, 640);

    expect(layout.stations).toHaveLength(4);
    expect(layout.stations.map((station) => station.lines)).toEqual([
      ['PENDING'],
      ['PENDING'],
      ['PENDING'],
      ['PENDING'],
    ]);
    expect(layout.watermark).toEqual({ text: 'DRAFT', ready: false });
    expect(layout.titleBlock.title).toBe('UNTITLED AGENT');
    expect(layout.titleBlock.status).toBe('DRAFT');
  });

  it('uses live section values for partially completed stations', () => {
    const partialSpec: AgentSpec = {
      ...baseSpec,
      knowledge: {
        sources: [
          {
            descriptorId: 'supplier-risk-register',
            purpose: 'Ground risk claims',
            requiredCitations: true,
          },
          {
            descriptorId: 'relativity-mes-builds',
            purpose: 'Track production delays',
            requiredCitations: true,
          },
          {
            descriptorId: 'quality-events',
            purpose: 'Find quality signals',
            requiredCitations: false,
          },
        ],
      },
      completion: { ...baseSpec.completion, knowledge: true },
    };

    const layout = layoutBlueprint(partialSpec, 1_200, 640);
    const scope = layout.stations[0];
    const knowledge = layout.stations[1];

    expect(scope?.complete).toBe(true);
    expect(scope?.lines).toContain('DEPT · Supply Chain Operations');
    expect(scope?.lines).toContain('2 DESIRED OUTCOMES');
    expect(knowledge?.complete).toBe(true);
    expect(knowledge?.lines[0]).toBe('3 SOURCES');
    expect(knowledge?.lines[1]).toContain('supplier risk register');
    expect(knowledge?.lines[2]).toContain('relativity mes builds');
    expect(layout.stations[2]?.lines).toEqual(['PENDING']);
    expect(layout.watermark.text).toBe('DRAFT');
  });

  it('produces ready drawing metadata and bounded title-block fields for a complete spec', () => {
    const completeSpec: AgentSpec = {
      ...baseSpec,
      status: 'generated',
      outcomes: {
        ...baseSpec.outcomes!,
        purpose:
          'Prepare a meticulously governed and exceptionally detailed supplier risk briefing for every regional operations leader.',
      },
      knowledge: {
        sources: [
          {
            descriptorId: 'supplier-risk-register',
            purpose: 'Ground risk claims',
            requiredCitations: true,
          },
        ],
      },
      guardrails: {
        workflowStages: ['Collect signals', 'Synthesize brief'],
        prohibitedActions: ['Do not contact suppliers'],
        approvalRequirements: ['Operations lead approves escalation'],
        failClosedConditions: ['Stop when governed evidence is unavailable'],
        responseRequirements: {
          citations: true,
          confidence: true,
          unresolvedConflicts: true,
        },
      },
      outputs: {
        outputType: 'decision_brief',
        outputSchema: { title: 'SupplierRiskBrief', type: 'object' },
        successMetrics: [
          { name: 'Citation coverage', operator: 'gte', threshold: 0.95, unit: 'ratio' },
        ],
        acceptanceTests: [
          { name: 'Known delay', input: { supplier: 'A' }, expectedResult: { escalated: true } },
        ],
      },
      completion: { outcomes: true, knowledge: true, guardrails: true, outputs: true },
    };

    const layout = layoutBlueprint(completeSpec, 1_200, 640);

    expect(layout.stations.every((station) => station.complete)).toBe(true);
    expect(layout.stations[2]?.lines).toEqual(['2 STAGES', '1 APPROVALS', '1 PROHIBITED']);
    expect(layout.stations[3]?.lines).toContain('SCHEMA · SupplierRiskBrief');
    expect(layout.watermark).toEqual({ text: 'READY FOR GENERATION', ready: true });
    expect(layout.titleBlock).toMatchObject({
      revision: 'REV 3',
      date: '2026-07-31',
      status: 'GENERATED',
    });
    expect(layout.titleBlock.title.endsWith('…')).toBe(true);
    expect(layout.titleBlock.title.length).toBeLessThanOrEqual(40);
    expect(layout.titleBlock.department.startsWith('DEPT ·')).toBe(true);
    expect(layout.titleBlock.audience.startsWith('AUD ·')).toBe(true);
  });

  it('truncates only beyond the requested boundary', () => {
    expect(truncateBlueprintText('A'.repeat(40), 40)).toBe('A'.repeat(40));
    expect(truncateBlueprintText('B'.repeat(41), 40)).toBe(`${'B'.repeat(39)}…`);
    expect(truncateBlueprintText('too long', 1)).toBe('…');
  });
});
