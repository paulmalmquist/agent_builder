import {
  agentManifestSchema,
  generatorInputSchema,
  type AgentManifest,
  type GeneratorInput,
} from '@agent-builder/contracts';

export const GENERATOR_VERSION = '0.2.0';

export function composeManifest(rawInput: unknown, generatedAt = new Date()): AgentManifest {
  const input: GeneratorInput = generatorInputSchema.parse(rawInput);
  const { spec } = input;

  return agentManifestSchema.parse({
    agentId: input.agentId,
    name: spec.outcomes.name,
    department: spec.outcomes.department,
    purpose: spec.outcomes.purpose,
    version: `0.1.${spec.revision}`,
    specRevision: spec.revision,
    generatorVersion: GENERATOR_VERSION,
    workflow: spec.guardrails.workflowStages,
    knowledgeSourceIds: spec.knowledge.sources.map((source) => source.descriptorId),
    guardrails: spec.guardrails,
    outputType: spec.outputs.outputType,
    outputSchema: spec.outputs.outputSchema,
    evaluations: spec.outputs.acceptanceTests,
    generatedAt: generatedAt.toISOString(),
  });
}
