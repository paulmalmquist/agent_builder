import {
  capabilityDeltaSchema,
  catalogIndexOutboxEventSchema,
  catalogIndexResourceSchema,
  catalogPublicationSchema,
  compositionSuggestionsSchema,
  configurationRevisionSchema,
  matchScoreSchema,
  resourceLineageSchema,
  type CapabilityDelta,
  type CapabilityProfile,
  type CatalogIndexOutboxEvent,
  type CatalogIndexResource,
  type CatalogPublication,
  type CompositionSuggestion,
  type ConfigurationRevision,
  type EmbeddingProvenance,
  type MatchScore,
  type ResourceLineage,
} from './reuse-schemas.js';

export const STRUCTURED_MATCH_FIELDS = [
  'businessDomain',
  'tasks',
  'inputs',
  'outputs',
  'tools',
] as const;

type StructuredMatchField = (typeof STRUCTURED_MATCH_FIELDS)[number];

export interface CapabilityFeature {
  key: string;
  label: string;
  field: StructuredMatchField;
}

function normalizeFeature(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function fieldValues(profile: CapabilityProfile, field: StructuredMatchField): readonly string[] {
  return field === 'businessDomain' ? [profile.businessDomain] : profile[field];
}

export function capabilityFeatures(profile: CapabilityProfile): CapabilityFeature[] {
  const features = STRUCTURED_MATCH_FIELDS.flatMap((field) =>
    fieldValues(profile, field).map((value) => ({
      key: `${field}:${normalizeFeature(value)}`,
      label: `${field}:${value.trim()}`,
      field,
    })),
  );
  return [...new Map(features.map((feature) => [feature.key, feature])).values()].sort(
    (left, right) => left.key.localeCompare(right.key),
  );
}

function deltaFromFeatures(
  requestedFeatures: readonly CapabilityFeature[],
  offeredFeatures: readonly CapabilityFeature[],
): CapabilityDelta {
  const requested = new Map(requestedFeatures.map((feature) => [feature.key, feature.label]));
  const offered = new Map(offeredFeatures.map((feature) => [feature.key, feature.label]));
  const has = [...requested.entries()]
    .filter(([key]) => offered.has(key))
    .map(([, label]) => label)
    .sort((left, right) => left.localeCompare(right));
  const lacks = [...requested.entries()]
    .filter(([key]) => !offered.has(key))
    .map(([, label]) => label)
    .sort((left, right) => left.localeCompare(right));
  const offers = [...offered.entries()]
    .filter(([key]) => !requested.has(key))
    .map(([, label]) => label)
    .sort((left, right) => left.localeCompare(right));
  return capabilityDeltaSchema.parse({ has, lacks, offers });
}

export function capabilityDelta(
  requestedProfile: CapabilityProfile,
  offeredProfile: CapabilityProfile,
): CapabilityDelta {
  return deltaFromFeatures(
    capabilityFeatures(requestedProfile),
    capabilityFeatures(offeredProfile),
  );
}

export function structuredCapabilityCoverage(
  requestedProfile: CapabilityProfile,
  offeredProfile: CapabilityProfile,
): number {
  const requested = capabilityFeatures(requestedProfile);
  const offered = new Set(capabilityFeatures(offeredProfile).map(({ key }) => key));
  const matched = requested.filter(({ key }) => offered.has(key)).length;
  return (matched / requested.length) * 100;
}

function assertFiniteVector(vector: readonly number[], label: string): void {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} must be a non-empty finite vector`);
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  assertFiniteVector(left, 'left');
  assertFiniteVector(right, 'right');
  if (left.length !== right.length) {
    throw new RangeError('Embedding vectors must have identical dimensions');
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    throw new RangeError('Cosine similarity is undefined for a zero vector');
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export interface CapabilityMatch {
  delta: CapabilityDelta;
  match: MatchScore;
}

export function scoreCapabilityMatch(
  requestedProfile: CapabilityProfile,
  offeredProfile: CapabilityProfile,
  embeddings?: {
    requested: readonly number[];
    offered: readonly number[];
  },
): CapabilityMatch {
  const structuredCoverage = structuredCapabilityCoverage(requestedProfile, offeredProfile);
  const delta = capabilityDelta(requestedProfile, offeredProfile);
  if (embeddings === undefined) {
    return {
      delta,
      match: matchScoreSchema.parse({
        score: structuredCoverage,
        structuredCoverage,
        embeddingCosine: null,
        mode: 'structured_only_fallback',
        label: 'Structured-only fallback',
      }),
    };
  }
  const embeddingCosine = Math.max(
    0,
    Math.min(1, cosineSimilarity(embeddings.requested, embeddings.offered)),
  );
  return {
    delta,
    match: matchScoreSchema.parse({
      score: 0.7 * structuredCoverage + 0.3 * embeddingCosine * 100,
      structuredCoverage,
      embeddingCosine,
      mode: 'hybrid_70_30',
      label: '70% capability coverage + 30% embedding cosine',
    }),
  };
}

export type ProviderPolicy = 'direct_allowed' | 'gateway_only';
export type EmbeddingProviderKind = 'deterministic' | 'direct' | 'gateway';

export interface EmbeddingInput {
  text: string;
  featureKeys: readonly string[];
}

export interface EmbeddingProvider {
  readonly kind: EmbeddingProviderKind;
  readonly version: string;
  readonly model: string;
  readonly dimensions: number;
  embed(input: EmbeddingInput, signal?: AbortSignal): Promise<readonly number[]>;
}

export class EmbeddingProviderPolicyError extends Error {
  readonly code = 'EMBEDDING_PROVIDER_POLICY_DENIED';

  constructor(providerKind: EmbeddingProviderKind) {
    super(`gateway_only denies the ${providerKind} embedding provider`);
    this.name = 'EmbeddingProviderPolicyError';
  }
}

export function embeddingProviderAllowed(
  policy: ProviderPolicy,
  provider: Pick<EmbeddingProvider, 'kind'>,
): boolean {
  return (
    policy === 'direct_allowed' || provider.kind === 'gateway' || provider.kind === 'deterministic'
  );
}

export async function embedWithProviderPolicy(
  provider: EmbeddingProvider,
  policy: ProviderPolicy,
  input: EmbeddingInput,
  signal?: AbortSignal,
): Promise<readonly number[]> {
  if (!embeddingProviderAllowed(policy, provider)) {
    throw new EmbeddingProviderPolicyError(provider.kind);
  }
  const vector = await provider.embed(input, signal);
  assertFiniteVector(vector, 'embedding provider result');
  if (vector.length !== provider.dimensions) {
    throw new RangeError('Embedding provider returned unexpected dimensions');
  }
  return vector;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizedVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

/** Pure, deterministic CI/local fallback. It is not represented as semantic evidence. */
export function deterministicFeatureHashEmbedding(
  input: EmbeddingInput,
  dimensions = 256,
): number[] {
  if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 4096) {
    throw new RangeError('Feature-hash dimensions must be an integer between 8 and 4096');
  }
  const tokens = [
    ...input.featureKeys.map((feature) => `feature:${normalizeFeature(feature)}`),
    ...(input.text
      .normalize('NFKC')
      .toLocaleLowerCase('en-US')
      .match(/[\p{L}\p{N}_-]+/gu) ?? []),
  ].sort((left, right) => left.localeCompare(right));
  const vector = Array.from<number>({ length: dimensions }).fill(0);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const bucket = hash % dimensions;
    const sign = (fnv1a(`sign:${token}`) & 1) === 0 ? 1 : -1;
    vector[bucket] = vector[bucket]! + sign;
  }
  return normalizedVector(vector);
}

export class DeterministicFeatureHashEmbeddingProvider implements EmbeddingProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'feature-hash-v1';
  readonly dimensions: number;

  constructor(dimensions = 256) {
    if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 4096) {
      throw new RangeError('Feature-hash dimensions must be an integer between 8 and 4096');
    }
    this.dimensions = dimensions;
  }

  embed(input: EmbeddingInput, signal?: AbortSignal): Promise<readonly number[]> {
    if (signal?.aborted === true) {
      return Promise.reject(
        signal.reason instanceof Error ? signal.reason : new Error('Embedding request aborted'),
      );
    }
    return Promise.resolve(deterministicFeatureHashEmbedding(input, this.dimensions));
  }
}

export function canonicalCapabilityText(publication: CatalogPublication): string {
  const profile = publication.capabilityProfile;
  return [
    publication.name,
    publication.subjectKind,
    ...capabilityFeatures(profile).map(({ label }) => label),
    ...profile.triggers.map((value) => `triggers:${value}`),
    ...profile.knowledgeClasses.map((value) => `knowledgeClasses:${value}`),
    ...profile.potentialActions.map((value) => `potentialActions:${value}`),
    ...profile.successCriteria.map((value) => `successCriteria:${value}`),
    `riskLevel:${profile.riskLevel}`,
  ].join('\n');
}

export interface IndexEmbedding {
  vector: readonly number[];
  provenance: EmbeddingProvenance;
}

export function buildCatalogIndexResource(
  untrustedPublication: CatalogPublication,
  indexedAt: string,
  embedding: IndexEmbedding | null,
): CatalogIndexResource {
  const publication = catalogPublicationSchema.parse(untrustedPublication);
  return catalogIndexResourceSchema.parse({
    publicationId: publication.id,
    publicationRevision: publication.revision,
    subjectKind: publication.subjectKind,
    resourceVersionId: publication.resourceVersionId,
    releaseDigest: publication.releaseDigest,
    catalogVisibility: publication.catalogVisibility,
    department: publication.department,
    featureKeys: capabilityFeatures(publication.capabilityProfile).map(({ key }) => key),
    canonicalText: canonicalCapabilityText(publication),
    embedding: embedding === null ? null : [...embedding.vector],
    embeddingProvenance: embedding?.provenance ?? null,
    retired: publication.retiredAt !== null,
    indexedAt,
  });
}

export interface NewCatalogIndexOutboxEvent {
  id: string;
  operation: 'upsert' | 'remove';
  resource: CatalogIndexResource;
  occurredAt: string;
}

export function createCatalogIndexOutboxEvent(
  input: NewCatalogIndexOutboxEvent,
): CatalogIndexOutboxEvent {
  return catalogIndexOutboxEventSchema.parse({
    id: input.id,
    idempotencyKey: `catalog-index:${input.resource.publicationId}:${input.resource.publicationRevision}:${input.operation}`,
    aggregateType: 'catalog_publication',
    aggregateId: input.resource.publicationId,
    aggregateRevision: input.resource.publicationRevision,
    eventType:
      input.operation === 'upsert'
        ? 'catalog.index.upsert_requested'
        : 'catalog.index.remove_requested',
    operation: input.operation,
    resource: input.resource,
    state: 'pending',
    attempts: 0,
    occurredAt: input.occurredAt,
    availableAt: input.occurredAt,
    claimedAt: null,
    publishedAt: null,
    lastError: null,
  });
}

function combinedFeatures(publications: readonly CatalogPublication[]): CapabilityFeature[] {
  const features = publications.flatMap((publication) =>
    capabilityFeatures(publication.capabilityProfile),
  );
  return [...new Map(features.map((feature) => [feature.key, feature])).values()].sort(
    (left, right) => left.key.localeCompare(right.key),
  );
}

export function suggestSkillCompositions(
  requestedProfile: CapabilityProfile,
  untrustedPublications: readonly CatalogPublication[],
  options: { maxSuggestions?: number; maxSkills?: number } = {},
): CompositionSuggestion[] {
  const maxSuggestions = Math.max(0, Math.min(5, options.maxSuggestions ?? 5));
  const maxSkills = Math.max(2, Math.min(5, options.maxSkills ?? 4));
  if (maxSuggestions === 0) return [];
  const requestedFeatures = capabilityFeatures(requestedProfile);
  const requestedKeys = new Set(requestedFeatures.map(({ key }) => key));
  const publications = untrustedPublications
    .map((publication) => catalogPublicationSchema.parse(publication))
    .filter((publication) => publication.subjectKind === 'skill' && publication.retiredAt === null)
    .map((publication) => ({
      publication,
      features: capabilityFeatures(publication.capabilityProfile),
    }))
    .filter(({ features }) => features.some(({ key }) => requestedKeys.has(key)))
    .sort((left, right) => {
      const leftMatches = left.features.filter(({ key }) => requestedKeys.has(key)).length;
      const rightMatches = right.features.filter(({ key }) => requestedKeys.has(key)).length;
      return rightMatches - leftMatches || left.publication.id.localeCompare(right.publication.id);
    });

  const suggestions = new Map<string, CompositionSuggestion>();
  for (const seed of publications) {
    const selected = [seed];
    const covered = new Set(
      seed.features.filter(({ key }) => requestedKeys.has(key)).map(({ key }) => key),
    );
    while (selected.length < maxSkills && covered.size < requestedKeys.size) {
      const next = publications
        .filter((candidate) => !selected.includes(candidate))
        .map((candidate) => ({
          candidate,
          gain: candidate.features.filter(({ key }) => requestedKeys.has(key) && !covered.has(key))
            .length,
        }))
        .filter(({ gain }) => gain > 0)
        .sort(
          (left, right) =>
            right.gain - left.gain ||
            left.candidate.publication.id.localeCompare(right.candidate.publication.id),
        )[0];
      if (next === undefined) break;
      selected.push(next.candidate);
      for (const { key } of next.candidate.features) {
        if (requestedKeys.has(key)) covered.add(key);
      }
    }
    if (selected.length < 2) continue;
    const ordered = [...selected].sort((left, right) =>
      left.publication.id.localeCompare(right.publication.id),
    );
    const key = `composition:${ordered.map(({ publication }) => publication.id).join('+')}`;
    if (suggestions.has(key)) continue;
    const features = combinedFeatures(ordered.map(({ publication }) => publication));
    suggestions.set(key, {
      key,
      skills: ordered.map(({ publication }) => ({
        publicationId: publication.id,
        resourceVersionId: publication.resourceVersionId,
        name: publication.name,
        version: publication.version,
        trustChip: publication.trustChip,
      })),
      coveragePercent:
        (features.filter(({ key: featureKey }) => requestedKeys.has(featureKey)).length /
          requestedFeatures.length) *
        100,
      delta: deltaFromFeatures(requestedFeatures, features),
    });
  }
  const ranked = [...suggestions.values()]
    .sort(
      (left, right) =>
        right.coveragePercent - left.coveragePercent ||
        left.skills.length - right.skills.length ||
        left.key.localeCompare(right.key),
    )
    .slice(0, maxSuggestions);
  return compositionSuggestionsSchema.parse(ranked);
}

export function assertConfigurationRevisionAppendOnly(
  previous: ConfigurationRevision,
  next: ConfigurationRevision,
): void {
  const validPrevious = configurationRevisionSchema.parse(previous);
  const validNext = configurationRevisionSchema.parse(next);
  if (validNext.deploymentId !== validPrevious.deploymentId) {
    throw new Error('Configuration revisions cannot change deployment');
  }
  if (validNext.revision !== validPrevious.revision + 1) {
    throw new Error('Configuration revisions must increment by exactly one');
  }
  if (validNext.previousRevisionId !== validPrevious.id) {
    throw new Error(
      'Configuration revisions must link to the immediately previous immutable revision',
    );
  }
}

export function assertAcyclicResourceLineage(untrustedEdges: readonly ResourceLineage[]): void {
  const edges = untrustedEdges.map((edge) => resourceLineageSchema.parse(edge));
  const adjacency = new Map<string, Set<string>>();
  const identities = new Set<string>();
  const compositionOrdinals = new Set<string>();
  for (const edge of edges) {
    const identity = `${edge.childResourceVersionId}:${edge.relationship}:${edge.parentResourceVersionId}`;
    if (identities.has(identity)) throw new Error(`Duplicate resource lineage edge: ${identity}`);
    identities.add(identity);
    const parents = adjacency.get(edge.childResourceVersionId) ?? new Set<string>();
    parents.add(edge.parentResourceVersionId);
    adjacency.set(edge.childResourceVersionId, parents);
    if (edge.relationship === 'composed_of') {
      const ordinalIdentity = `${edge.childResourceVersionId}:${edge.ordinal}`;
      if (compositionOrdinals.has(ordinalIdentity)) {
        throw new Error(`Duplicate composition ordinal: ${ordinalIdentity}`);
      }
      compositionOrdinals.add(ordinalIdentity);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (resourceVersionId: string): void => {
    if (visiting.has(resourceVersionId)) throw new Error('Resource lineage must be acyclic');
    if (visited.has(resourceVersionId)) return;
    visiting.add(resourceVersionId);
    for (const parent of adjacency.get(resourceVersionId) ?? []) visit(parent);
    visiting.delete(resourceVersionId);
    visited.add(resourceVersionId);
  };
  for (const child of adjacency.keys()) visit(child);
}
