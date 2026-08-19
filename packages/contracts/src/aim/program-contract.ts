import { z } from 'zod';
import { pluginMarkAssetSourceSchema } from '../plugin-schemas.js';

export const AIM_PROGRAM_SCHEMA_VERSION = 'aim.program/v2' as const;
export const AIM_GEOMETRY_DISCLAIMER = 'CONCEPTUAL GEOMETRY — NOT VEHICLE CAD' as const;

const stableIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/, 'Use a stable lower_snake_case ID');
const boundedLabelSchema = z.string().trim().min(2).max(160);
const boundedDescriptionSchema = z.string().trim().min(10).max(2000);
const timestampSchema = z.string().datetime({ offset: true });
const idListSchema = z.array(stableIdSchema).max(200);

export const aimLifecycleSchema = z.enum(['planned', 'poc', 'pilot', 'production', 'retired']);
export const aimReadinessSchema = z.enum(['unknown', 'no_go', 'conditional', 'go']);
export const aimCapabilityLayerSchema = z.enum([
  'foundation',
  'connectivity',
  'knowledge',
  'simulation',
  'decision',
  'agent',
  'outcome',
]);
export const aimMakeMethodSchema = z.enum(['printed', 'purchased', 'facility']);
/** Accepted operational authority rung. Present it as R0 through R4. */
export const aimAgentTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export const aimAgentCertificationStatusSchema = z.enum(['candidate', 'certified']);

export const aimProgramDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    description: boundedDescriptionSchema.optional(),
    asOf: timestampSchema,
    geometryDisclaimer: z.literal(AIM_GEOMETRY_DISCLAIMER),
    synthetic: z.boolean(),
  })
  .strict();

export const aimDisplayPolicySchema = z
  .object({
    showOwnerNames: z.boolean(),
    groupGranularity: z.enum(['aggregate', 'detailed']),
    showNoGoAsFailure: z.boolean(),
    showEvidenceLinks: z.boolean(),
    showInternalSourceIds: z.boolean(),
    showDetailedAgentLists: z.boolean(),
    showDecisionLoopPerformance: z.boolean(),
    defaultEvidenceFreshnessSlaHours: z.number().int().positive().max(8760),
    factoryMaturityMetricId: stableIdSchema.optional(),
  })
  .strict();

const timelineMarkerSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    at: timestampSchema,
    kind: z.enum(['today', 'relative', 'quarter', 'custom']),
  })
  .strict();

export const aimTimelineDefinitionSchema = z
  .object({
    startAt: timestampSchema,
    endAt: timestampSchema,
    markers: z.array(timelineMarkerSchema).max(100),
  })
  .strict();

export const aimAnchorDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    kind: z.enum(['vehicle', 'ground', 'region']),
    description: boundedDescriptionSchema.optional(),
    aliases: idListSchema,
    fallbackRegion: stableIdSchema.optional(),
  })
  .strict();

export const aimGroupDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    description: boundedDescriptionSchema.optional(),
    kind: z.enum(['primary', 'supporting']),
    displayOrder: z.number().int().nonnegative().max(999),
    lead: z.string().trim().min(2).max(160).optional(),
    ownedAnchorIds: idListSchema,
    participatingCapabilityIds: idListSchema,
    decisionLoopIds: idListSchema,
    agentBuilderQuery: z.string().trim().min(2).max(500).optional(),
    sourceRefs: idListSchema,
  })
  .strict();

export const aimAgentConnectorSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    monogram: z
      .string()
      .trim()
      .min(1)
      .max(4)
      .regex(/^[A-Z0-9]+$/),
    accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    assetSrc: pluginMarkAssetSourceSchema.optional(),
    access: z.enum(['read', 'write']),
  })
  .strict();

export const aimAgentDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    description: boundedDescriptionSchema,
    tier: aimAgentTierSchema,
    certificationStatus: aimAgentCertificationStatusSchema,
    synthetic: z.boolean(),
    groupIds: idListSchema.min(1),
    partIds: idListSchema.min(1),
    connectors: z.array(aimAgentConnectorSchema).max(50),
    certificationEvidenceRefs: idListSchema,
    sourceRefs: idListSchema.min(1),
  })
  .strict();

export const aimCapabilityDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    layer: aimCapabilityLayerSchema,
    description: boundedDescriptionSchema.optional(),
    dependencyIds: idListSchema,
  })
  .strict();

export const aimPartStatusEventSchema = z
  .object({
    effectiveAt: timestampSchema,
    lifecycle: aimLifecycleSchema,
    readiness: aimReadinessSchema,
    note: z.string().trim().min(2).max(1000).optional(),
    evidenceRefs: idListSchema,
    sourceRef: stableIdSchema,
  })
  .strict();

export const aimPartCoverageSchema = z
  .object({
    agentIds: idListSchema,
    evidenceRefs: idListSchema,
  })
  .strict();

export const aimPartDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    anchorId: stableIdSchema,
    fallbackRegion: stableIdSchema.optional(),
    makeMethod: aimMakeMethodSchema,
    process: boundedDescriptionSchema,
    ownerGroupId: stableIdSchema,
    coverage: aimPartCoverageSchema,
    capabilityIds: idListSchema.min(1),
    participatingGroupIds: idListSchema.min(1),
    problem: z.string().trim().min(10).max(2000),
    decisionLoopIds: idListSchema,
    unlocksPartIds: idListSchema,
    dependencyPartIds: idListSchema,
    statusHistory: z.array(aimPartStatusEventSchema).min(1).max(500),
    knowledgeCoverageMetricId: stableIdSchema.optional(),
    agentStatusMetricId: stableIdSchema.optional(),
    baselineLatencyMetricId: stableIdSchema.optional(),
    currentLatencyMetricId: stableIdSchema.optional(),
    targetLatencyMetricId: stableIdSchema.optional(),
    evidenceRefs: idListSchema,
    sourceRefs: idListSchema.min(1),
  })
  .strict();

export const aimGateCriterionResultSchema = z
  .object({
    effectiveAt: timestampSchema,
    state: z.enum(['unknown', 'unsatisfied', 'satisfied']),
    evidenceRefs: idListSchema,
    sourceRef: stableIdSchema,
  })
  .strict();

export const aimGateCriterionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    required: z.boolean(),
    affectedPartIds: idListSchema,
    requiredMetricIds: idListSchema,
    evidenceRefs: idListSchema,
    resultHistory: z.array(aimGateCriterionResultSchema).min(1).max(500),
  })
  .strict();

export const aimMilestoneDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    date: timestampSchema,
    ownerGroupIds: idListSchema.min(1),
    affectedPartIds: idListSchema.min(1),
    gateCriteria: z.array(aimGateCriterionSchema).min(1).max(100),
    evidenceRefs: idListSchema,
    sourceRefs: idListSchema.min(1),
  })
  .strict();

export const aimWorkstreamDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    ownerGroupId: stableIdSchema,
    affectedPartIds: idListSchema.min(1),
    startAt: timestampSchema,
    endAt: timestampSchema,
    state: z.enum(['complete', 'in_work', 'planned', 'at_risk']),
    sourceRefs: idListSchema.min(1),
    milestoneIds: idListSchema,
  })
  .strict();

export const aimDecisionStepSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    phase: z.enum(['observe', 'contextualize', 'explain', 'simulate', 'decide', 'act', 'measure']),
    sequence: z.number().int().nonnegative().max(100),
  })
  .strict();

export const aimManualHandoffSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    fromStepId: stableIdSchema,
    toStepId: stableIdSchema,
    statusHistory: z
      .array(
        z
          .object({
            effectiveAt: timestampSchema,
            state: z.enum(['manual', 'governed', 'retired']),
            sourceRef: stableIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();

export const aimDecisionLoopDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    ownerGroupIds: idListSchema.min(1),
    sourceSystemIds: idListSchema.min(1),
    partIds: idListSchema.min(1),
    baselineLatencyMetricId: stableIdSchema,
    currentLatencyMetricId: stableIdSchema,
    targetLatencyMetricId: stableIdSchema,
    steps: z.array(aimDecisionStepSchema).min(2).max(100),
    manualHandoffs: z.array(aimManualHandoffSchema).max(100),
    sourceRefs: idListSchema.min(1),
  })
  .strict();

export const aimInterfaceContractDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    partIds: z.tuple([stableIdSchema, stableIdSchema]),
    statusHistory: z
      .array(
        z
          .object({
            effectiveAt: timestampSchema,
            state: z.enum(['planned', 'manual', 'governed', 'stale', 'retired']),
            evidenceRefs: idListSchema,
            sourceRef: stableIdSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
    evidenceRefs: idListSchema,
    sourceRefs: idListSchema.min(1),
  })
  .strict();

export const aimEvidenceReferenceSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    type: z.enum([
      'metric',
      'report',
      'test',
      'deployment',
      'approval',
      'artifact',
      'source-record',
    ]),
    sourceId: stableIdSchema,
    externalId: z.string().trim().min(1).max(240).optional(),
    internalUri: z.string().trim().min(1).max(500).optional(),
    observedAt: timestampSchema,
    freshnessSlaHours: z.number().int().positive().max(8760).optional(),
  })
  .strict();

export const aimSourceDefinitionSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    kind: z.enum([
      'seed',
      'file',
      'csv',
      'work_item_export',
      'metric_registry',
      'deployment_registry',
      'knowledge_registry',
      'manual',
    ]),
    adapterVersion: z.string().trim().min(1).max(80),
    observedAt: timestampSchema,
    freshnessSlaHours: z.number().int().positive().max(8760).optional(),
    classification: z.enum(['public', 'internal', 'restricted']),
    synthetic: z.boolean(),
    reconciliationStatus: z.enum(['authoritative', 'corroborated', 'conflicting', 'unverified']),
  })
  .strict();

export const aimMetricObservationSchema = z
  .object({
    observedAt: timestampSchema,
    value: z.number().finite(),
    sourceRef: stableIdSchema,
    evidenceRefs: idListSchema,
    confidence: z.enum(['low', 'medium', 'high']),
  })
  .strict();

export const aimMetricSeriesSchema = z
  .object({
    id: stableIdSchema,
    label: boundedLabelSchema,
    kind: z.enum(['percentage', 'duration_hours', 'maturity', 'count', 'boolean']),
    unit: z.enum(['percent', 'hours', 'score', 'count', 'boolean']),
    sourceRefs: idListSchema.min(1),
    observations: z.array(aimMetricObservationSchema).min(1).max(5000),
  })
  .strict();

function addIssue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function idsOf(values: ReadonlyArray<{ id: string }>): Set<string> {
  return new Set(values.map(({ id }) => id));
}

function requireUniqueIds(
  values: ReadonlyArray<{ id: string }>,
  path: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach(({ id }, index) => {
    if (seen.has(id)) addIssue(context, [path, index, 'id'], `Duplicate ${path} ID: ${id}`);
    seen.add(id);
  });
}

function requireReferences(
  refs: readonly string[],
  allowed: ReadonlySet<string>,
  path: Array<string | number>,
  label: string,
  context: z.RefinementCtx,
): void {
  refs.forEach((ref, index) => {
    if (!allowed.has(ref)) addIssue(context, [...path, index], `Unknown ${label}: ${ref}`);
  });
}

function requireStrictlyIncreasing(
  values: ReadonlyArray<{ effectiveAt?: string; observedAt?: string }>,
  path: Array<string | number>,
  context: z.RefinementCtx,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]?.effectiveAt ?? values[index - 1]?.observedAt;
    const current = values[index]?.effectiveAt ?? values[index]?.observedAt;
    if (
      previous !== undefined &&
      current !== undefined &&
      Date.parse(current) <= Date.parse(previous)
    ) {
      addIssue(context, [...path, index], 'History must be strictly ordered by time');
    }
  }
}

function requireAcyclicDependencies(
  values: ReadonlyArray<{ id: string; dependencyIds: string[] }>,
  path: string,
  context: z.RefinementCtx,
): void {
  const graph = new Map(values.map(({ id, dependencyIds }) => [id, dependencyIds] as const));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    const valid = (graph.get(id) ?? []).every(visit);
    visiting.delete(id);
    visited.add(id);
    return valid;
  };
  values.forEach(({ id }, index) => {
    if (!visit(id))
      addIssue(context, [path, index, 'dependencyIds'], `Dependency cycle includes ${id}`);
  });
}

export const aimProgramManifestSchema = z
  .object({
    schemaVersion: z.literal(AIM_PROGRAM_SCHEMA_VERSION),
    program: aimProgramDefinitionSchema,
    displayPolicy: aimDisplayPolicySchema,
    timeline: aimTimelineDefinitionSchema,
    anchors: z.array(aimAnchorDefinitionSchema).min(1).max(500),
    groups: z.array(aimGroupDefinitionSchema).min(1).max(500),
    agents: z.array(aimAgentDefinitionSchema).max(2000),
    capabilities: z.array(aimCapabilityDefinitionSchema).min(1).max(500),
    parts: z.array(aimPartDefinitionSchema).min(1).max(2000),
    milestones: z.array(aimMilestoneDefinitionSchema).max(1000),
    workstreams: z.array(aimWorkstreamDefinitionSchema).max(2000),
    decisionLoops: z.array(aimDecisionLoopDefinitionSchema).max(500),
    interfaces: z.array(aimInterfaceContractDefinitionSchema).max(2000),
    evidence: z.array(aimEvidenceReferenceSchema).max(10_000),
    sources: z.array(aimSourceDefinitionSchema).min(1).max(1000),
    metrics: z.array(aimMetricSeriesSchema).max(5000),
  })
  .strict()
  .superRefine((manifest, context) => {
    const collections = [
      ['anchors', manifest.anchors],
      ['groups', manifest.groups],
      ['agents', manifest.agents],
      ['capabilities', manifest.capabilities],
      ['parts', manifest.parts],
      ['milestones', manifest.milestones],
      ['workstreams', manifest.workstreams],
      ['decisionLoops', manifest.decisionLoops],
      ['interfaces', manifest.interfaces],
      ['evidence', manifest.evidence],
      ['sources', manifest.sources],
      ['metrics', manifest.metrics],
      ['timeline.markers', manifest.timeline.markers],
    ] as const;
    collections.forEach(([path, values]) => requireUniqueIds(values, path, context));

    const anchors = idsOf(manifest.anchors);
    const groups = idsOf(manifest.groups);
    const agents = idsOf(manifest.agents);
    const capabilities = idsOf(manifest.capabilities);
    const parts = idsOf(manifest.parts);
    const milestones = idsOf(manifest.milestones);
    const loops = idsOf(manifest.decisionLoops);
    const evidence = idsOf(manifest.evidence);
    const sources = idsOf(manifest.sources);
    const metrics = idsOf(manifest.metrics);
    const groupById = new Map(manifest.groups.map((group) => [group.id, group] as const));
    const agentById = new Map(manifest.agents.map((agent) => [agent.id, agent] as const));
    const partById = new Map(manifest.parts.map((part) => [part.id, part] as const));
    const milestoneById = new Map(
      manifest.milestones.map((milestone) => [milestone.id, milestone] as const),
    );
    const evidenceById = new Map(manifest.evidence.map((item) => [item.id, item] as const));
    const partByAnchor = new Map<string, (typeof manifest.parts)[number]>();
    manifest.parts.forEach((part, index) => {
      if (partByAnchor.has(part.anchorId)) {
        addIssue(
          context,
          ['parts', index, 'anchorId'],
          `Duplicate hardware part anchor: ${part.anchorId}`,
        );
      }
      partByAnchor.set(part.anchorId, part);
    });

    if (Date.parse(manifest.timeline.startAt) >= Date.parse(manifest.timeline.endAt)) {
      addIssue(context, ['timeline', 'endAt'], 'Timeline endAt must be after startAt');
    }
    manifest.timeline.markers.forEach(({ at }, index) => {
      if (
        Date.parse(at) < Date.parse(manifest.timeline.startAt) ||
        Date.parse(at) > Date.parse(manifest.timeline.endAt)
      ) {
        addIssue(
          context,
          ['timeline', 'markers', index, 'at'],
          'Timeline marker is outside the timeline',
        );
      }
    });

    manifest.anchors.forEach((anchor, index) => {
      if (anchor.fallbackRegion !== undefined && !anchors.has(anchor.fallbackRegion)) {
        addIssue(
          context,
          ['anchors', index, 'fallbackRegion'],
          `Unknown anchor: ${anchor.fallbackRegion}`,
        );
      }
      if (
        anchor.fallbackRegion !== undefined &&
        manifest.anchors.find(({ id }) => id === anchor.fallbackRegion)?.kind !== 'region'
      ) {
        addIssue(context, ['anchors', index, 'fallbackRegion'], 'Fallback anchor must be a region');
      }
    });
    const aliases = new Set<string>();
    manifest.anchors.forEach((anchor, anchorIndex) => {
      anchor.aliases.forEach((alias, aliasIndex) => {
        if (anchors.has(alias)) {
          addIssue(
            context,
            ['anchors', anchorIndex, 'aliases', aliasIndex],
            `Anchor alias collides with a canonical anchor ID: ${alias}`,
          );
        }
        if (aliases.has(alias)) {
          addIssue(
            context,
            ['anchors', anchorIndex, 'aliases', aliasIndex],
            `Duplicate anchor alias: ${alias}`,
          );
        }
        aliases.add(alias);
      });
    });
    manifest.groups.forEach((group, index) => {
      requireReferences(
        group.ownedAnchorIds,
        anchors,
        ['groups', index, 'ownedAnchorIds'],
        'anchor',
        context,
      );
      requireReferences(
        group.participatingCapabilityIds,
        capabilities,
        ['groups', index, 'participatingCapabilityIds'],
        'capability',
        context,
      );
      requireReferences(
        group.decisionLoopIds,
        loops,
        ['groups', index, 'decisionLoopIds'],
        'decision loop',
        context,
      );
      requireReferences(
        group.sourceRefs,
        sources,
        ['groups', index, 'sourceRefs'],
        'source',
        context,
      );
      if (group.kind === 'supporting' && group.ownedAnchorIds.length > 0) {
        addIssue(
          context,
          ['groups', index, 'ownedAnchorIds'],
          'Supporting groups cannot own hardware anchors',
        );
      }
      group.ownedAnchorIds.forEach((anchorId, anchorIndex) => {
        const part = partByAnchor.get(anchorId);
        if (part === undefined || part.ownerGroupId !== group.id) {
          addIssue(
            context,
            ['groups', index, 'ownedAnchorIds', anchorIndex],
            `Owned anchor ${anchorId} must resolve to a part owned by ${group.id}`,
          );
        }
      });
    });
    const primaryDisplayOrders = new Set<number>();
    manifest.groups.forEach((group, index) => {
      if (group.kind !== 'primary') return;
      if (primaryDisplayOrders.has(group.displayOrder)) {
        addIssue(
          context,
          ['groups', index, 'displayOrder'],
          `Duplicate primary group display order: ${group.displayOrder}`,
        );
      }
      primaryDisplayOrders.add(group.displayOrder);
    });
    const anchorOwners = new Map<string, string[]>();
    manifest.groups.forEach((group) => {
      group.ownedAnchorIds.forEach((anchorId) => {
        anchorOwners.set(anchorId, [...(anchorOwners.get(anchorId) ?? []), group.id]);
      });
    });
    manifest.agents.forEach((agent, index) => {
      requireReferences(agent.groupIds, groups, ['agents', index, 'groupIds'], 'group', context);
      requireReferences(agent.partIds, parts, ['agents', index, 'partIds'], 'part', context);
      requireReferences(
        agent.certificationEvidenceRefs,
        evidence,
        ['agents', index, 'certificationEvidenceRefs'],
        'evidence',
        context,
      );
      requireReferences(
        agent.sourceRefs,
        sources,
        ['agents', index, 'sourceRefs'],
        'source',
        context,
      );
      if (
        agent.certificationStatus === 'certified' &&
        agent.certificationEvidenceRefs.length === 0
      ) {
        addIssue(
          context,
          ['agents', index, 'certificationEvidenceRefs'],
          'Certified agents require certification evidence',
        );
      }
      if (
        agent.certificationStatus === 'certified' &&
        agent.certificationEvidenceRefs.some((id) => {
          const type = evidenceById.get(id)?.type;
          return type !== undefined && !['approval', 'deployment', 'test'].includes(type);
        })
      ) {
        addIssue(
          context,
          ['agents', index, 'certificationEvidenceRefs'],
          'Certified agent evidence must be an approval, deployment, or test',
        );
      }
      const connectorIds = new Set<string>();
      agent.connectors.forEach((connector, connectorIndex) => {
        if (connectorIds.has(connector.id)) {
          addIssue(
            context,
            ['agents', index, 'connectors', connectorIndex, 'id'],
            `Duplicate connector ID for agent ${agent.id}: ${connector.id}`,
          );
        }
        connectorIds.add(connector.id);
      });
      agent.partIds.forEach((partId, partIndex) => {
        const part = partById.get(partId);
        if (part !== undefined && !part.coverage.agentIds.includes(agent.id)) {
          addIssue(
            context,
            ['agents', index, 'partIds', partIndex],
            `Part ${partId} does not declare agent ${agent.id} in coverage`,
          );
        }
        if (part !== undefined && !agent.groupIds.includes(part.ownerGroupId)) {
          addIssue(
            context,
            ['agents', index, 'partIds', partIndex],
            `Agent ${agent.id} must include owner group ${part.ownerGroupId}`,
          );
        }
      });
      agent.groupIds.forEach((groupId, groupIndex) => {
        const participates = agent.partIds.some((partId) =>
          partById.get(partId)?.participatingGroupIds.includes(groupId),
        );
        if (!participates) {
          addIssue(
            context,
            ['agents', index, 'groupIds', groupIndex],
            `Agent ${agent.id} has no covered part involving group ${groupId}`,
          );
        }
      });
    });
    manifest.capabilities.forEach((capability, index) => {
      requireReferences(
        capability.dependencyIds,
        capabilities,
        ['capabilities', index, 'dependencyIds'],
        'capability',
        context,
      );
      if (capability.dependencyIds.includes(capability.id)) {
        addIssue(
          context,
          ['capabilities', index, 'dependencyIds'],
          'A capability cannot depend on itself',
        );
      }
    });
    requireAcyclicDependencies(manifest.capabilities, 'capabilities', context);

    manifest.parts.forEach((part, index) => {
      requireReferences([part.anchorId], anchors, ['parts', index, 'anchorId'], 'anchor', context);
      if (part.fallbackRegion !== undefined) {
        requireReferences(
          [part.fallbackRegion],
          anchors,
          ['parts', index, 'fallbackRegion'],
          'anchor',
          context,
        );
        if (manifest.anchors.find(({ id }) => id === part.fallbackRegion)?.kind !== 'region') {
          addIssue(context, ['parts', index, 'fallbackRegion'], 'Fallback anchor must be a region');
        }
      }
      requireReferences(
        part.capabilityIds,
        capabilities,
        ['parts', index, 'capabilityIds'],
        'capability',
        context,
      );
      requireReferences(
        part.participatingGroupIds,
        groups,
        ['parts', index, 'participatingGroupIds'],
        'group',
        context,
      );
      requireReferences(
        [part.ownerGroupId],
        groups,
        ['parts', index, 'ownerGroupId'],
        'group',
        context,
      );
      requireReferences(
        part.coverage.agentIds,
        agents,
        ['parts', index, 'coverage', 'agentIds'],
        'agent',
        context,
      );
      requireReferences(
        part.coverage.evidenceRefs,
        evidence,
        ['parts', index, 'coverage', 'evidenceRefs'],
        'evidence',
        context,
      );
      requireReferences(
        part.decisionLoopIds,
        loops,
        ['parts', index, 'decisionLoopIds'],
        'decision loop',
        context,
      );
      requireReferences(
        part.unlocksPartIds,
        parts,
        ['parts', index, 'unlocksPartIds'],
        'part',
        context,
      );
      requireReferences(
        part.dependencyPartIds,
        parts,
        ['parts', index, 'dependencyPartIds'],
        'part',
        context,
      );
      requireReferences(
        part.evidenceRefs,
        evidence,
        ['parts', index, 'evidenceRefs'],
        'evidence',
        context,
      );
      requireReferences(
        part.sourceRefs,
        sources,
        ['parts', index, 'sourceRefs'],
        'source',
        context,
      );
      if (!part.participatingGroupIds.includes(part.ownerGroupId)) {
        addIssue(
          context,
          ['parts', index, 'ownerGroupId'],
          'Owner group must participate in the part',
        );
      }
      const owner = groupById.get(part.ownerGroupId);
      if (owner !== undefined && owner.kind !== 'primary') {
        addIssue(
          context,
          ['parts', index, 'ownerGroupId'],
          'Part owner must be a primary display group',
        );
      }
      if (owner !== undefined && !owner.ownedAnchorIds.includes(part.anchorId)) {
        addIssue(
          context,
          ['parts', index, 'ownerGroupId'],
          'Owner group must declare the part anchor as owned',
        );
      }
      part.coverage.agentIds.forEach((agentId, agentIndex) => {
        const agent = agentById.get(agentId);
        if (agent !== undefined && !agent.partIds.includes(part.id)) {
          addIssue(
            context,
            ['parts', index, 'coverage', 'agentIds', agentIndex],
            `Agent ${agentId} does not declare part ${part.id}`,
          );
        }
      });
      const declaredOwners = anchorOwners.get(part.anchorId) ?? [];
      if (declaredOwners.length !== 1 || declaredOwners[0] !== part.ownerGroupId) {
        addIssue(
          context,
          ['parts', index, 'ownerGroupId'],
          `Part anchor must be owned only by ${part.ownerGroupId}`,
        );
      }
      if (part.unlocksPartIds.includes(part.id) || part.dependencyPartIds.includes(part.id)) {
        addIssue(context, ['parts', index], 'A part cannot unlock or depend on itself');
      }
      const metricRefs = [
        part.knowledgeCoverageMetricId,
        part.agentStatusMetricId,
        part.baselineLatencyMetricId,
        part.currentLatencyMetricId,
        part.targetLatencyMetricId,
      ].filter((value): value is string => value !== undefined);
      requireReferences(metricRefs, metrics, ['parts', index], 'metric', context);
      requireStrictlyIncreasing(part.statusHistory, ['parts', index, 'statusHistory'], context);
      part.statusHistory.forEach((event, eventIndex) => {
        requireReferences(
          event.evidenceRefs,
          evidence,
          ['parts', index, 'statusHistory', eventIndex, 'evidenceRefs'],
          'evidence',
          context,
        );
        requireReferences(
          [event.sourceRef],
          sources,
          ['parts', index, 'statusHistory', eventIndex, 'sourceRef'],
          'source',
          context,
        );
      });
    });

    manifest.milestones.forEach((milestone, index) => {
      requireReferences(
        milestone.ownerGroupIds,
        groups,
        ['milestones', index, 'ownerGroupIds'],
        'group',
        context,
      );
      requireReferences(
        milestone.affectedPartIds,
        parts,
        ['milestones', index, 'affectedPartIds'],
        'part',
        context,
      );
      requireReferences(
        milestone.evidenceRefs,
        evidence,
        ['milestones', index, 'evidenceRefs'],
        'evidence',
        context,
      );
      requireReferences(
        milestone.sourceRefs,
        sources,
        ['milestones', index, 'sourceRefs'],
        'source',
        context,
      );
      requireUniqueIds(milestone.gateCriteria, `milestones.${index}.gateCriteria`, context);
      milestone.gateCriteria.forEach((criterion, criterionIndex) => {
        requireReferences(
          criterion.affectedPartIds,
          parts,
          ['milestones', index, 'gateCriteria', criterionIndex, 'affectedPartIds'],
          'part',
          context,
        );
        requireReferences(
          criterion.requiredMetricIds,
          metrics,
          ['milestones', index, 'gateCriteria', criterionIndex, 'requiredMetricIds'],
          'metric',
          context,
        );
        requireReferences(
          criterion.evidenceRefs,
          evidence,
          ['milestones', index, 'gateCriteria', criterionIndex, 'evidenceRefs'],
          'evidence',
          context,
        );
        requireStrictlyIncreasing(
          criterion.resultHistory,
          ['milestones', index, 'gateCriteria', criterionIndex, 'resultHistory'],
          context,
        );
        criterion.resultHistory.forEach((result, resultIndex) => {
          requireReferences(
            result.evidenceRefs,
            evidence,
            [
              'milestones',
              index,
              'gateCriteria',
              criterionIndex,
              'resultHistory',
              resultIndex,
              'evidenceRefs',
            ],
            'evidence',
            context,
          );
          requireReferences(
            [result.sourceRef],
            sources,
            [
              'milestones',
              index,
              'gateCriteria',
              criterionIndex,
              'resultHistory',
              resultIndex,
              'sourceRef',
            ],
            'source',
            context,
          );
        });
      });
    });

    manifest.workstreams.forEach((workstream, index) => {
      requireReferences(
        [workstream.ownerGroupId],
        groups,
        ['workstreams', index, 'ownerGroupId'],
        'group',
        context,
      );
      requireReferences(
        workstream.affectedPartIds,
        parts,
        ['workstreams', index, 'affectedPartIds'],
        'part',
        context,
      );
      requireReferences(
        workstream.sourceRefs,
        sources,
        ['workstreams', index, 'sourceRefs'],
        'source',
        context,
      );
      requireReferences(
        workstream.milestoneIds,
        milestones,
        ['workstreams', index, 'milestoneIds'],
        'milestone',
        context,
      );

      if (Date.parse(workstream.startAt) >= Date.parse(workstream.endAt)) {
        addIssue(
          context,
          ['workstreams', index, 'endAt'],
          'Workstream endAt must be after startAt',
        );
      }
      if (Date.parse(workstream.startAt) < Date.parse(manifest.timeline.startAt)) {
        addIssue(
          context,
          ['workstreams', index, 'startAt'],
          'Workstream startAt is outside the timeline',
        );
      }
      if (Date.parse(workstream.endAt) > Date.parse(manifest.timeline.endAt)) {
        addIssue(
          context,
          ['workstreams', index, 'endAt'],
          'Workstream endAt is outside the timeline',
        );
      }

      const ownerGroup = groupById.get(workstream.ownerGroupId);
      if (ownerGroup !== undefined && ownerGroup.kind !== 'primary') {
        addIssue(
          context,
          ['workstreams', index, 'ownerGroupId'],
          'Workstream owner must be a primary display group',
        );
      }
      workstream.affectedPartIds.forEach((partId, partIndex) => {
        const part = partById.get(partId);
        if (part !== undefined && part.ownerGroupId !== workstream.ownerGroupId) {
          addIssue(
            context,
            ['workstreams', index, 'affectedPartIds', partIndex],
            `Workstream part ${partId} must be owned by ${workstream.ownerGroupId}`,
          );
        }
      });
      workstream.milestoneIds.forEach((milestoneId, milestoneIndex) => {
        const milestone = milestoneById.get(milestoneId);
        if (
          milestone !== undefined &&
          !milestone.affectedPartIds.some((partId) => workstream.affectedPartIds.includes(partId))
        ) {
          addIssue(
            context,
            ['workstreams', index, 'milestoneIds', milestoneIndex],
            `Workstream milestone ${milestoneId} must affect a workstream part`,
          );
        }
      });
    });

    manifest.decisionLoops.forEach((loop, index) => {
      requireReferences(
        loop.ownerGroupIds,
        groups,
        ['decisionLoops', index, 'ownerGroupIds'],
        'group',
        context,
      );
      requireReferences(
        loop.sourceSystemIds,
        sources,
        ['decisionLoops', index, 'sourceSystemIds'],
        'source',
        context,
      );
      requireReferences(loop.partIds, parts, ['decisionLoops', index, 'partIds'], 'part', context);
      requireReferences(
        [loop.baselineLatencyMetricId, loop.currentLatencyMetricId, loop.targetLatencyMetricId],
        metrics,
        ['decisionLoops', index],
        'metric',
        context,
      );
      requireReferences(
        loop.sourceRefs,
        sources,
        ['decisionLoops', index, 'sourceRefs'],
        'source',
        context,
      );
      requireUniqueIds(loop.steps, `decisionLoops.${index}.steps`, context);
      requireUniqueIds(loop.manualHandoffs, `decisionLoops.${index}.manualHandoffs`, context);
      const stepIds = idsOf(loop.steps);
      const sequences = new Set<number>();
      loop.steps.forEach((step, stepIndex) => {
        if (sequences.has(step.sequence))
          addIssue(
            context,
            ['decisionLoops', index, 'steps', stepIndex, 'sequence'],
            'Decision step sequence must be unique',
          );
        sequences.add(step.sequence);
      });
      loop.manualHandoffs.forEach((handoff, handoffIndex) => {
        requireReferences(
          [handoff.fromStepId, handoff.toStepId],
          stepIds,
          ['decisionLoops', index, 'manualHandoffs', handoffIndex],
          'decision step',
          context,
        );
        requireStrictlyIncreasing(
          handoff.statusHistory,
          ['decisionLoops', index, 'manualHandoffs', handoffIndex, 'statusHistory'],
          context,
        );
        handoff.statusHistory.forEach((status, statusIndex) =>
          requireReferences(
            [status.sourceRef],
            sources,
            [
              'decisionLoops',
              index,
              'manualHandoffs',
              handoffIndex,
              'statusHistory',
              statusIndex,
              'sourceRef',
            ],
            'source',
            context,
          ),
        );
      });
    });

    manifest.interfaces.forEach((contract, index) => {
      requireReferences(contract.partIds, parts, ['interfaces', index, 'partIds'], 'part', context);
      const expectedId = `seam_${contract.partIds[0]}_${contract.partIds[1]}`;
      if (contract.id !== expectedId)
        addIssue(context, ['interfaces', index, 'id'], `Interface ID must be ${expectedId}`);
      requireReferences(
        contract.evidenceRefs,
        evidence,
        ['interfaces', index, 'evidenceRefs'],
        'evidence',
        context,
      );
      requireReferences(
        contract.sourceRefs,
        sources,
        ['interfaces', index, 'sourceRefs'],
        'source',
        context,
      );
      requireStrictlyIncreasing(
        contract.statusHistory,
        ['interfaces', index, 'statusHistory'],
        context,
      );
      contract.statusHistory.forEach((status, statusIndex) => {
        requireReferences(
          status.evidenceRefs,
          evidence,
          ['interfaces', index, 'statusHistory', statusIndex, 'evidenceRefs'],
          'evidence',
          context,
        );
        requireReferences(
          [status.sourceRef],
          sources,
          ['interfaces', index, 'statusHistory', statusIndex, 'sourceRef'],
          'source',
          context,
        );
      });
    });

    manifest.evidence.forEach((item, index) =>
      requireReferences(
        [item.sourceId],
        sources,
        ['evidence', index, 'sourceId'],
        'source',
        context,
      ),
    );
    manifest.metrics.forEach((metric, index) => {
      requireReferences(
        metric.sourceRefs,
        sources,
        ['metrics', index, 'sourceRefs'],
        'source',
        context,
      );
      requireStrictlyIncreasing(metric.observations, ['metrics', index, 'observations'], context);
      metric.observations.forEach((observation, observationIndex) => {
        requireReferences(
          [observation.sourceRef],
          sources,
          ['metrics', index, 'observations', observationIndex, 'sourceRef'],
          'source',
          context,
        );
        requireReferences(
          observation.evidenceRefs,
          evidence,
          ['metrics', index, 'observations', observationIndex, 'evidenceRefs'],
          'evidence',
          context,
        );
        if (
          (metric.kind === 'percentage' || metric.kind === 'maturity') &&
          (observation.value < 0 || observation.value > 100)
        ) {
          addIssue(
            context,
            ['metrics', index, 'observations', observationIndex, 'value'],
            `${metric.kind} values must be between 0 and 100`,
          );
        }
        if (metric.kind === 'boolean' && ![0, 1].includes(observation.value)) {
          addIssue(
            context,
            ['metrics', index, 'observations', observationIndex, 'value'],
            'Boolean metric values must be 0 or 1',
          );
        }
      });
    });
    if (
      manifest.displayPolicy.factoryMaturityMetricId !== undefined &&
      !metrics.has(manifest.displayPolicy.factoryMaturityMetricId)
    ) {
      addIssue(
        context,
        ['displayPolicy', 'factoryMaturityMetricId'],
        'Unknown factory maturity metric',
      );
    }
  });

export type AimLifecycle = z.infer<typeof aimLifecycleSchema>;
export type AimReadiness = z.infer<typeof aimReadinessSchema>;
export type AimCapabilityLayer = z.infer<typeof aimCapabilityLayerSchema>;
export type AimMakeMethod = z.infer<typeof aimMakeMethodSchema>;
export type AimAgentTier = z.infer<typeof aimAgentTierSchema>;
export type AimAgentCertificationStatus = z.infer<typeof aimAgentCertificationStatusSchema>;
export type AimProgramDefinition = z.infer<typeof aimProgramDefinitionSchema>;
export type AimDisplayPolicy = z.infer<typeof aimDisplayPolicySchema>;
export type AimTimelineDefinition = z.infer<typeof aimTimelineDefinitionSchema>;
export type AimAnchorDefinition = z.infer<typeof aimAnchorDefinitionSchema>;
export type AimGroupDefinition = z.infer<typeof aimGroupDefinitionSchema>;
export type AimAgentConnector = z.infer<typeof aimAgentConnectorSchema>;
export type AimAgentDefinition = z.infer<typeof aimAgentDefinitionSchema>;
export type AimCapabilityDefinition = z.infer<typeof aimCapabilityDefinitionSchema>;
export type AimPartStatusEvent = z.infer<typeof aimPartStatusEventSchema>;
export type AimPartCoverage = z.infer<typeof aimPartCoverageSchema>;
export type AimPartDefinition = z.infer<typeof aimPartDefinitionSchema>;
export type AimGateCriterion = z.infer<typeof aimGateCriterionSchema>;
export type AimMilestoneDefinition = z.infer<typeof aimMilestoneDefinitionSchema>;
export type AimWorkstreamDefinition = z.infer<typeof aimWorkstreamDefinitionSchema>;
export type AimDecisionLoopDefinition = z.infer<typeof aimDecisionLoopDefinitionSchema>;
export type AimInterfaceContractDefinition = z.infer<typeof aimInterfaceContractDefinitionSchema>;
export type AimEvidenceReference = z.infer<typeof aimEvidenceReferenceSchema>;
export type AimSourceDefinition = z.infer<typeof aimSourceDefinitionSchema>;
export type AimMetricSeries = z.infer<typeof aimMetricSeriesSchema>;
export type AimProgramManifest = z.infer<typeof aimProgramManifestSchema>;
