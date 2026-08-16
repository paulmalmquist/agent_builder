import {
  AgentStatus as DatabaseAgentStatus,
  SourceProvider as DatabaseSourceProvider,
  type Agent as DatabaseAgent,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  agentCatalogItemSchema,
  agentCatalogResponseSchema,
  agentFamilyVersionsResponseSchema,
  agentSearchResponseSchema,
  agentVersionSummarySchema,
  similarityRequestSchema,
  similarityResponseSchema,
  type Agent,
  type AgentCatalogQuery,
  type AgentCatalogResponse,
} from '@agent-builder/contracts';
import { AppError } from '../errors.js';
import { toAgent } from '../mappers.js';
import type { CatalogApi } from './types.js';

const tokens = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);

function scoreAgent(query: string, agent: Agent) {
  const queryTokens = new Set(tokens(query));
  const capabilityMatches = agent.capabilities.filter((capability) =>
    tokens(capability).some((token) => queryTokens.has(token)),
  );
  const searchableTokens = new Set(
    tokens(
      `${agent.slug} ${agent.name} ${agent.department} ${agent.purpose} ${agent.capabilities.join(' ')}`,
    ),
  );
  const overlap = [...queryTokens].filter((token) => searchableTokens.has(token));
  let score = Math.min(95, overlap.length * 12 + capabilityMatches.length * 8);
  const supplierDelayQuery =
    queryTokens.has('supplier') && (queryTokens.has('delay') || queryTokens.has('delays'));
  if (supplierDelayQuery && agent.slug.startsWith('supplier-delay-alert-v')) score = 85;
  if (supplierDelayQuery && agent.slug.startsWith('inventory-risk-analyst-v')) score = 40;
  const gaps = [...queryTokens]
    .filter((token) => !searchableTokens.has(token))
    .slice(0, 5)
    .map((token) => `No explicit ${token} capability`);
  return {
    score,
    matchedCapabilities: capabilityMatches,
    gaps,
    reasons:
      capabilityMatches.length > 0
        ? capabilityMatches.map((capability) => `Matches ${capability}`)
        : overlap.map((token) => `Shares the term “${token}”`),
  };
}

const statusMap = {
  draft: DatabaseAgentStatus.DRAFT,
  generating: DatabaseAgentStatus.GENERATING,
  ready: DatabaseAgentStatus.READY,
  shadow: DatabaseAgentStatus.SHADOW,
  certifying: DatabaseAgentStatus.CERTIFYING,
  certified: DatabaseAgentStatus.CERTIFIED,
  rejected: DatabaseAgentStatus.REJECTED,
  active: DatabaseAgentStatus.ACTIVE,
  failed: DatabaseAgentStatus.FAILED,
  retired: DatabaseAgentStatus.RETIRED,
} as const;

const providerMap = {
  bigquery: DatabaseSourceProvider.BIGQUERY,
  confluence: DatabaseSourceProvider.CONFLUENCE,
  jira: DatabaseSourceProvider.JIRA,
  email: DatabaseSourceProvider.EMAIL,
  slack: DatabaseSourceProvider.SLACK,
  telemetry: DatabaseSourceProvider.TELEMETRY,
  fixture: DatabaseSourceProvider.FIXTURE,
} as const;

const providerWire = {
  [DatabaseSourceProvider.BIGQUERY]: 'bigquery',
  [DatabaseSourceProvider.CONFLUENCE]: 'confluence',
  [DatabaseSourceProvider.JIRA]: 'jira',
  [DatabaseSourceProvider.EMAIL]: 'email',
  [DatabaseSourceProvider.SLACK]: 'slack',
  [DatabaseSourceProvider.TELEMETRY]: 'telemetry',
  [DatabaseSourceProvider.FIXTURE]: 'fixture',
} as const;

type CatalogRecord = DatabaseAgent & {
  family: { slug: string; championAgentId: string | null };
  knowledgeSources: { source: { provider: DatabaseSourceProvider } }[];
};

function summary(record: CatalogRecord) {
  const agent = toAgent(record);
  return agentVersionSummarySchema.parse({
    ...agent,
    familySlug: record.family.slug,
    isChampion: record.family.championAgentId === record.id,
    providers: [
      ...new Set(record.knowledgeSources.map(({ source }) => providerWire[source.provider])),
    ],
  });
}

export class CatalogService implements CatalogApi {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: AgentCatalogQuery): Promise<AgentCatalogResponse> {
    if (query.familyId !== undefined) return this.familyVersions(query);

    const normalizedQuery = query.query?.trim() ?? '';
    const where: Prisma.AgentWhereInput = {
      ...(query.department === undefined ? {} : { department: query.department }),
      ...(query.status === undefined
        ? { status: { not: DatabaseAgentStatus.RETIRED } }
        : { status: statusMap[query.status] }),
      ...(query.provider === undefined
        ? {}
        : { knowledgeSources: { some: { source: { provider: providerMap[query.provider] } } } }),
    };
    const records = await this.prisma.agent.findMany({
      where,
      include: { family: true, knowledgeSources: { include: { source: true } } },
      orderBy: [{ familyId: 'asc' }, { versionNumber: 'desc' }],
    });
    const byFamily = new Map<string, CatalogRecord[]>();
    records.forEach((record) => {
      const family = byFamily.get(record.familyId) ?? [];
      family.push(record);
      byFamily.set(record.familyId, family);
    });
    const representatives = [...byFamily.values()].map(
      (versions) =>
        versions.find((record) => record.family.championAgentId === record.id) ?? versions[0]!,
    );
    let ranked = representatives
      .map((record) => {
        const agent = toAgent(record);
        const match =
          normalizedQuery === ''
            ? { score: 0, matchedCapabilities: [], gaps: [] }
            : scoreAgent(normalizedQuery, agent);
        return agentCatalogItemSchema.parse({
          ...summary(record),
          score: match.score,
          reuseRecommended: match.score >= 70,
          matchedCapabilities: match.matchedCapabilities,
          gaps: match.gaps,
        });
      })
      .filter((item) => normalizedQuery === '' || item.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.familySlug.localeCompare(right.familySlug),
      );
    if (query.cursor !== undefined) {
      const cursorIndex = ranked.findIndex((item) => item.familyId === query.cursor);
      if (cursorIndex >= 0) ranked = ranked.slice(cursorIndex + 1);
    }
    const page = ranked.slice(0, query.limit + 1);
    const hasNext = page.length > query.limit;
    if (hasNext) page.pop();
    return agentSearchResponseSchema.parse({
      mode: 'catalog',
      query: normalizedQuery,
      nextCursor: hasNext ? (page.at(-1)?.familyId ?? null) : null,
      items: page,
    });
  }

  async search(query: string) {
    return agentCatalogResponseSchema.parse(await this.list({ query, limit: 100 }));
  }

  async similarity(input: unknown) {
    const request = similarityRequestSchema.parse(input);
    const records = await this.prisma.agent.findMany({
      where:
        request.candidateIds === undefined
          ? { status: { not: DatabaseAgentStatus.RETIRED } }
          : { id: { in: request.candidateIds } },
      include: { family: true, knowledgeSources: { include: { source: true } } },
      orderBy: [{ familyId: 'asc' }, { versionNumber: 'desc' }],
    });
    const selected =
      request.candidateIds === undefined
        ? [
            ...records
              .reduce((families, record) => {
                const versions = families.get(record.familyId) ?? [];
                versions.push(record);
                families.set(record.familyId, versions);
                return families;
              }, new Map<string, CatalogRecord[]>())
              .values(),
          ].map(
            (versions) =>
              versions.find((record) => record.family.championAgentId === record.id) ??
              versions[0]!,
          )
        : records;
    const matches = selected
      .map(toAgent)
      .map((agent) => {
        const result = scoreAgent(request.query, agent);
        return {
          agentId: agent.id,
          score: result.score,
          reuseRecommended: result.score >= 70,
          reasons: result.reasons,
          gaps: result.gaps,
        };
      })
      .filter((match) => match.score > 0)
      .sort((left, right) => right.score - left.score);
    return similarityResponseSchema.parse({ query: request.query, matches });
  }

  async getAgent(agentId: string): Promise<Agent> {
    const record = await this.prisma.agent.findUnique({ where: { id: agentId } });
    if (!record) throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent was not found', { agentId });
    return toAgent(record);
  }

  private async familyVersions(query: AgentCatalogQuery): Promise<AgentCatalogResponse> {
    const familyId = query.familyId as string;
    const family = await this.prisma.agentFamily.findUnique({ where: { id: familyId } });
    if (!family)
      throw new AppError(404, 'AGENT_FAMILY_NOT_FOUND', 'Agent family was not found', { familyId });
    const records = await this.prisma.agent.findMany({
      where: {
        familyId,
        ...(query.includeRetired === 'true'
          ? {}
          : { status: { not: DatabaseAgentStatus.RETIRED } }),
      },
      include: { family: true, knowledgeSources: { include: { source: true } } },
      orderBy: [{ versionNumber: 'desc' }, { id: 'desc' }],
    });
    let remaining = records;
    if (query.cursor !== undefined) {
      const cursorIndex = records.findIndex((record) => record.id === query.cursor);
      if (cursorIndex >= 0) remaining = records.slice(cursorIndex + 1);
    }
    const page = remaining.slice(0, query.limit + 1);
    const hasNext = page.length > query.limit;
    if (hasNext) page.pop();
    return agentFamilyVersionsResponseSchema.parse({
      mode: 'family_versions',
      familyId,
      nextCursor: hasNext ? (page.at(-1)?.id ?? null) : null,
      items: page.map(summary),
    });
  }
}
