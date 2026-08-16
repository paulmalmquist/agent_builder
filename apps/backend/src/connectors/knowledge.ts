import { BigQuery, type Query } from '@google-cloud/bigquery';
import {
  jsonObjectSchema,
  jsonValueSchema,
  type JsonValue,
  type SourceDescriptor,
} from '@agent-builder/contracts';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError, errorMessage } from '../errors.js';
import { OutboundHttpPolicy } from './outbound-policy.js';

const bigQueryMetadataSchema = jsonObjectSchema.and(
  z.object({
    project: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/),
    dataset: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,1023}$/),
    table: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,1023}$/),
    location: z.string().min(1).max(80),
    columns: z
      .array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/))
      .min(1)
      .max(200),
  }),
);

export const BIGQUERY_READONLY_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';

export function bigQueryClientOptions(projectId: string): {
  projectId: string;
  scopes: string[];
} {
  return {
    projectId,
    scopes: [BIGQUERY_READONLY_SCOPE],
  };
}

export interface SourceValidationCapability {
  validateSource(descriptor: SourceDescriptor): Promise<void>;
}

export interface TabularPreviewCapability {
  previewRows(descriptor: SourceDescriptor, limit?: number): Promise<JsonValue[]>;
}

export interface DocumentSearchCapability {
  searchDocuments(
    descriptor: SourceDescriptor,
    query: string,
    limit?: number,
  ): Promise<JsonValue[]>;
}

export interface ProviderConnector extends SourceValidationCapability {
  tabularPreview?: TabularPreviewCapability;
  documentSearch?: DocumentSearchCapability;
}

export interface BigQueryJobLike {
  getMetadata(): Promise<[Record<string, unknown>]>;
  getQueryResults(): Promise<[unknown[]]>;
}

export interface BigQueryClientLike {
  createQueryJob(options: Query): Promise<BigQueryJobLike>;
}

class GoogleBigQueryClient implements BigQueryClientLike {
  constructor(private readonly client: BigQuery) {}

  async createQueryJob(options: Query): Promise<BigQueryJobLike> {
    const [job] = await this.client.createQueryJob(options);
    return {
      getMetadata: async () => {
        const result: unknown = await job.getMetadata();
        if (!Array.isArray(result) || typeof result[0] !== 'object' || result[0] === null) {
          throw new Error('BigQuery returned invalid job metadata');
        }
        return [result[0] as Record<string, unknown>];
      },
      getQueryResults: async () => {
        const result: unknown = await job.getQueryResults();
        if (!Array.isArray(result) || !Array.isArray(result[0])) {
          throw new Error('BigQuery returned invalid query rows');
        }
        return [result[0] as unknown[]];
      },
    };
  }
}

export class FixtureKnowledgeConnector
  implements ProviderConnector, TabularPreviewCapability, DocumentSearchCapability
{
  readonly tabularPreview: TabularPreviewCapability = this;
  readonly documentSearch: DocumentSearchCapability = this;

  validateSource(descriptor: SourceDescriptor): Promise<void> {
    if (!descriptor.readOnly) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Source ${descriptor.id} is not approved for read-only access`,
      );
    }
    return Promise.resolve();
  }

  async previewRows(descriptor: SourceDescriptor, limit = 25): Promise<JsonValue[]> {
    await this.validateSource(descriptor);
    return [
      {
        descriptorId: descriptor.id,
        synthetic: true,
        preview: `Fixture preview capped at ${Math.max(1, Math.min(limit, 1000))} rows`,
      },
    ];
  }

  async searchDocuments(
    descriptor: SourceDescriptor,
    query: string,
    limit = 10,
  ): Promise<JsonValue[]> {
    await this.validateSource(descriptor);
    return [
      {
        descriptorId: descriptor.id,
        query: query.slice(0, 200),
        limit: Math.max(1, Math.min(limit, 100)),
        synthetic: true,
      },
    ];
  }
}

export class BigQueryKnowledgeConnector implements ProviderConnector, TabularPreviewCapability {
  readonly tabularPreview: TabularPreviewCapability = this;
  private readonly maxBytes: number;
  private readonly defaultLimit: number;
  private readonly projectId: string;

  constructor(
    private readonly client: BigQueryClientLike,
    config: Pick<AppConfig['bigQuery'], 'maximumBytesBilled' | 'previewRowLimit' | 'projectId'>,
  ) {
    this.maxBytes = config.maximumBytesBilled;
    this.defaultLimit = config.previewRowLimit;
    if (config.projectId === null) {
      throw new Error('BigQuery connector requires an explicit project ID');
    }
    this.projectId = config.projectId;
  }

  async validateSource(descriptor: SourceDescriptor): Promise<void> {
    await this.dryRun(descriptor, 1);
  }

  async previewRows(
    descriptor: SourceDescriptor,
    requestedLimit = this.defaultLimit,
  ): Promise<JsonValue[]> {
    const limit = Math.max(1, Math.min(requestedLimit, this.defaultLimit));
    const { query, location } = this.queryFor(descriptor);
    await this.dryRun(descriptor, limit);

    try {
      const job = await this.client.createQueryJob({
        query,
        location,
        params: { limit },
        maximumBytesBilled: String(this.maxBytes),
        useLegacySql: false,
      });
      const [rows] = await job.getQueryResults();
      return rows.map((row, index) => {
        const parsed = jsonValueSchema.safeParse(row);
        if (!parsed.success) {
          throw new AppError(
            503,
            'DEPENDENCY_UNAVAILABLE',
            `BigQuery preview row ${index} was not JSON serializable`,
          );
        }
        return parsed.data;
      });
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'BigQuery preview failed', {
        dependency: 'bigquery',
        reason: errorMessage(error),
      });
    }
  }

  private async dryRun(descriptor: SourceDescriptor, limit: number): Promise<void> {
    const { query, location } = this.queryFor(descriptor);
    try {
      const job = await this.client.createQueryJob({
        query,
        location,
        params: { limit },
        dryRun: true,
        maximumBytesBilled: String(this.maxBytes),
        useLegacySql: false,
      });
      const [metadata] = await job.getMetadata();
      const statistics = metadata['statistics'];
      const queryStatistics =
        typeof statistics === 'object' && statistics !== null
          ? (statistics as Record<string, unknown>)['query']
          : undefined;
      const rawBytes =
        typeof queryStatistics === 'object' && queryStatistics !== null
          ? (queryStatistics as Record<string, unknown>)['totalBytesProcessed']
          : undefined;
      const estimatedBytes =
        typeof rawBytes === 'string' || typeof rawBytes === 'number' ? Number(rawBytes) : 0;

      if (!Number.isFinite(estimatedBytes) || estimatedBytes > this.maxBytes) {
        throw new AppError(
          400,
          'QUERY_BUDGET_EXCEEDED',
          'BigQuery dry run exceeded the configured byte budget',
          { estimatedBytes, maximumBytesBilled: this.maxBytes },
        );
      }
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'BigQuery validation failed', {
        dependency: 'bigquery',
        reason: errorMessage(error),
      });
    }
  }

  private queryFor(descriptor: SourceDescriptor): { query: string; location: string } {
    if (descriptor.provider !== 'bigquery' || !descriptor.readOnly) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Source ${descriptor.id} is not an approved read-only BigQuery source`,
      );
    }
    const metadata = bigQueryMetadataSchema.parse(descriptor.metadata);
    if (metadata.project !== this.projectId) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Source ${descriptor.id} is outside the configured BigQuery project`,
      );
    }
    if (descriptor.region !== null && descriptor.region !== metadata.location) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Source ${descriptor.id} has inconsistent location metadata`,
      );
    }

    // Identifiers originate exclusively in the server-owned descriptor registry.
    const projection = metadata.columns.map((column) => `\`${column}\``).join(', ');
    const query =
      `SELECT ${projection} FROM \`${metadata.project}.${metadata.dataset}.${metadata.table}\` ` +
      'LIMIT @limit';
    return { query, location: metadata.location };
  }
}

export class KnowledgeConnectorRegistry {
  constructor(
    private readonly fixture: ProviderConnector,
    private readonly liveConnectors: Partial<
      Record<SourceDescriptor['provider'], ProviderConnector>
    >,
    private readonly enabledProviders: Partial<Record<SourceDescriptor['provider'], boolean>>,
    private readonly outboundPolicy: OutboundHttpPolicy,
  ) {}

  async validateSources(descriptors: SourceDescriptor[]): Promise<void> {
    for (const descriptor of descriptors) {
      const liveEnabled = this.enabledProviders[descriptor.provider] === true;
      const connector = liveEnabled ? this.liveConnectors[descriptor.provider] : this.fixture;
      if (!connector) {
        throw new AppError(
          503,
          'DEPENDENCY_UNAVAILABLE',
          `Live ${descriptor.provider} connector is enabled but not configured`,
          { dependency: descriptor.provider },
        );
      }
      if (!liveEnabled) {
        await connector.validateSource(descriptor);
        continue;
      }
      const cacheKey = `${descriptor.id}:${descriptor.lastRefreshed ?? 'unversioned'}`;
      await this.outboundPolicy.execute(descriptor.provider, cacheKey, async () => {
        await connector.validateSource(descriptor);
      });
    }
  }
}

export function createKnowledgeConnectorRegistry(
  config: AppConfig,
  client?: BigQueryClientLike,
): KnowledgeConnectorRegistry {
  const fixture = new FixtureKnowledgeConnector();
  const liveConnectors: Partial<Record<SourceDescriptor['provider'], ProviderConnector>> = {};
  if (config.providers.bigquery || client !== undefined) {
    if (config.bigQuery.projectId === null) {
      throw new Error('GOOGLE_CLOUD_PROJECT is required for the live BigQuery connector');
    }
    const bigQueryClient =
      client ??
      new GoogleBigQueryClient(new BigQuery(bigQueryClientOptions(config.bigQuery.projectId)));
    liveConnectors.bigquery = new BigQueryKnowledgeConnector(bigQueryClient, config.bigQuery);
  }
  const outboundPolicy = new OutboundHttpPolicy({
    timeoutMs: 10_000,
    maxRetries: 2,
    baseDelayMs: 200,
    cacheTtlMs: 30_000,
    circuitFailureThreshold: 3,
    circuitResetMs: 30_000,
  });
  return new KnowledgeConnectorRegistry(fixture, liveConnectors, config.providers, outboundPolicy);
}
