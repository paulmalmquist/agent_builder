import { sourceDescriptorSchema, type SourceDescriptor } from '@agent-builder/contracts';
import { HeuristicSpecInterpreter } from '../src/interpretation/heuristic.js';

const sources: SourceDescriptor[] = [
  sourceDescriptorSchema.parse({
    id: 'bq-relativity-mes-builds',
    role: 'knowledge',
    provider: 'bigquery',
    displayName: 'MES Supplier Build Records',
    uri: 'bigquery://project/dataset/builds',
    authority: 'system_of_record',
    owner: 'Manufacturing Data',
    region: 'US',
    lastRefreshed: null,
    citationRequired: true,
    readOnly: true,
    synthetic: true,
    metadata: {},
  }),
  sourceDescriptorSchema.parse({
    id: 'confluence-supplier-playbook',
    role: 'knowledge',
    provider: 'confluence',
    displayName: 'Supplier Escalation Playbook',
    uri: 'confluence://supply/supplier-escalation-playbook',
    authority: 'curated',
    owner: 'Supply Chain',
    region: null,
    lastRefreshed: null,
    citationRequired: true,
    readOnly: true,
    synthetic: true,
    metadata: {},
  }),
];

describe('HeuristicSpecInterpreter', () => {
  const interpreter = new HeuristicSpecInterpreter();

  it('prefills all four supplier-delay sections with registry descriptors only', () => {
    const result = interpreter.interpret(
      'Identify supplier delays, read build records and prepare an evidence-backed escalation brief for production planners.',
      sources,
    );
    expect(result.kind).toBe('prefill');
    expect(result.draft?.outcomes.value?.department).toBe('Supply Chain');
    expect(result.draft?.knowledge.value?.sources.map((source) => source.descriptorId)).toEqual(
      expect.arrayContaining(['bq-relativity-mes-builds', 'confluence-supplier-playbook']),
    );
    expect(result.draft?.guardrails.value).not.toBeNull();
    expect(result.draft?.outputs.value).not.toBeNull();
  });

  it('flags unknown sources and elevated authority without inventing descriptor ids', () => {
    const result = interpreter.interpret(
      'Read our ERP and give it write access to production holds so it can update records after supplier delays.',
      sources,
    );
    expect(result.draft?.knowledge.unresolved).toContain('Map “our ERP” to a governed descriptor.');
    expect(result.draft?.guardrails.needsReview).toBe(true);
    expect(result.draft?.guardrails.value?.approvalRequirements[0]).toMatch(/Human approval/);
    const ids = result.draft?.knowledge.value?.sources.map((source) => source.descriptorId) ?? [];
    expect(ids.every((id) => sources.some((source) => source.id === id))).toBe(true);
  });

  it('suggests separate scopes for multi-agent prompts', () => {
    const result = interpreter.interpret(
      'When a supplier is late then create a risk brief and also when a defect is found then prepare a quality report',
      sources,
    );
    expect(result).toMatchObject({ kind: 'split_required', draft: null });
    expect(result.candidates).toHaveLength(2);
  });
});
