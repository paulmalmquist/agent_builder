import type { Query } from '@google-cloud/bigquery';
import { sourceDescriptorSchema } from '@agent-builder/contracts';
import {
  BIGQUERY_READONLY_SCOPE,
  BigQueryKnowledgeConnector,
  FixtureKnowledgeConnector,
  bigQueryClientOptions,
  createKnowledgeConnectorRegistry,
  type BigQueryClientLike,
  type BigQueryJobLike,
} from '../src/connectors/knowledge.js';

const descriptor = sourceDescriptorSchema.parse({
  id: 'bq-builds',
  role: 'knowledge',
  provider: 'bigquery',
  displayName: 'Builds',
  uri: 'bigquery://project/dataset/builds',
  authority: 'system_of_record',
  owner: 'Data Platform',
  region: 'US',
  lastRefreshed: null,
  citationRequired: true,
  readOnly: true,
  synthetic: false,
  metadata: {
    project: 'project',
    dataset: 'dataset',
    table: 'builds',
    location: 'US',
    columns: ['build_id', 'status'],
  },
});

const liveConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 3000,
  logLevel: 'silent',
  generatorCliPath: '/fixed/generator.js',
  repositoryRoot: process.cwd(),
  generatorVersion: '0.2.0',
  generatorConcurrency: 2,
  certificationConcurrency: 2,
  certificationRunTimeoutMs: 120_000,
  certificationExecutorVersion: '1.0.0',
  certificationFullRunRetention: 20,
  interpretationTtlHours: 24,
  maintenance: { enabled: false, hourUtc: 2 },
  automationScheduler: { enabled: false, intervalMs: 30_000, batchSize: 25 },
  profilePath: '.local/profile/profile.yaml',
  generatorTimeoutMs: 10_000,
  generatorMaxOutputBytes: 1_000_000,
  shutdownTimeoutMs: 15_000,
  auth: { enabled: true, actorId: 'connector-test', bearerToken: 'x'.repeat(24) },
  providers: {
    bigquery: true,
    confluence: false,
    jira: false,
    email: false,
    slack: false,
    telemetry: false,
  },
  model: {
    provider: 'deterministic',
    providerPolicy: 'direct_allowed',
    name: 'daily-brief-fixture',
    timeoutMs: 10_000,
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    pricingVersion: 'connector-test',
  },
  execution: { concurrency: 2, leaseMs: 60_000, dispatchMode: 'in_process' },
  repositorySourceCommit: 'connector-test',
  repositorySourceVerified: false,
  buildIdentity: { commit: null, buildTimestamp: null },
  selfTest: { frontendUrl: 'http://127.0.0.1:5173/selftest', timeoutMs: 240_000 },
  bigQuery: {
    enabled: true,
    projectId: 'project',
    maximumBytesBilled: 1000,
    previewRowLimit: 25,
  },
} as const;

class FakeJob implements BigQueryJobLike {
  constructor(
    private readonly bytes: number,
    private readonly rows: unknown[] = [],
  ) {}

  getMetadata(): Promise<[Record<string, unknown>]> {
    return Promise.resolve([
      { statistics: { query: { totalBytesProcessed: String(this.bytes) } } },
    ]);
  }

  getQueryResults(): Promise<[unknown[]]> {
    return Promise.resolve([this.rows]);
  }
}

class FakeClient implements BigQueryClientLike {
  readonly calls: Query[] = [];

  constructor(private readonly bytes: number) {}

  createQueryJob(options: Query): Promise<BigQueryJobLike> {
    this.calls.push(options);
    return Promise.resolve(new FakeJob(this.bytes, [{ buildId: 'B-100' }]));
  }
}

describe('knowledge connectors', () => {
  it('uses fixtures safely while live BigQuery is disabled', async () => {
    const connector = new FixtureKnowledgeConnector();
    await expect(connector.validateSource(descriptor)).resolves.toBeUndefined();
    await expect(connector.previewRows(descriptor)).resolves.toEqual([
      expect.objectContaining({ descriptorId: descriptor.id, synthetic: true }),
    ]);
  });

  it('dry-runs before query execution and uses only the fixed descriptor identifiers', async () => {
    const client = new FakeClient(100);
    const connector = new BigQueryKnowledgeConnector(client, {
      maximumBytesBilled: 1000,
      previewRowLimit: 25,
      projectId: 'project',
    });
    await expect(connector.previewRows(descriptor, 10)).resolves.toEqual([{ buildId: 'B-100' }]);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]).toMatchObject({ dryRun: true, location: 'US' });
    expect(client.calls[1]).not.toHaveProperty('dryRun', true);
    expect(client.calls[0]?.query).toContain('`project.dataset.builds`');
    expect(client.calls[0]?.query).toContain('SELECT `build_id`, `status`');
    expect(client.calls[0]?.query).not.toContain('SELECT *');
    expect(client.calls[0]?.params).toEqual({ limit: 10 });
  });

  it('fails closed when the dry-run estimate exceeds the byte budget', async () => {
    const connector = new BigQueryKnowledgeConnector(new FakeClient(1001), {
      maximumBytesBilled: 1000,
      previewRowLimit: 25,
      projectId: 'project',
    });
    await expect(connector.previewRows(descriptor)).rejects.toMatchObject({
      status: 400,
      code: 'QUERY_BUDGET_EXCEEDED',
    });
  });

  it('configures application-default credentials with the read-only OAuth scope', () => {
    expect(bigQueryClientOptions('governed-project')).toEqual({
      projectId: 'governed-project',
      scopes: [BIGQUERY_READONLY_SCOPE],
    });
  });

  it('rejects inconsistent source regions before issuing a query', async () => {
    const client = new FakeClient(100);
    const connector = new BigQueryKnowledgeConnector(client, {
      maximumBytesBilled: 1000,
      previewRowLimit: 25,
      projectId: 'project',
    });
    const mismatched = sourceDescriptorSchema.parse({
      ...descriptor,
      region: 'EU',
    });

    await expect(connector.validateSource(mismatched)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(client.calls).toHaveLength(0);
  });

  it('fails closed on live authentication errors and never falls back to fixtures', async () => {
    const createQueryJob = jest.fn(() =>
      Promise.reject<never>(new Error('ADC authentication failed')),
    );
    const failingClient: BigQueryClientLike = { createQueryJob };
    const registry = createKnowledgeConnectorRegistry(liveConfig, failingClient);

    await expect(registry.validateSources([descriptor])).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      details: {
        dependency: 'bigquery',
        retryable: true,
      },
    });
    expect(createQueryJob).toHaveBeenCalledTimes(3);
  });

  it('caches successful live validation by versioned descriptor key', async () => {
    const client = new FakeClient(100);
    const registry = createKnowledgeConnectorRegistry(liveConfig, client);

    await registry.validateSources([descriptor]);
    await registry.validateSources([descriptor]);

    expect(client.calls).toHaveLength(1);
  });

  it('rejects descriptors outside the configured project before issuing a query', async () => {
    const client = new FakeClient(100);
    const connector = new BigQueryKnowledgeConnector(client, {
      maximumBytesBilled: 1000,
      previewRowLimit: 25,
      projectId: 'different-project',
    });
    await expect(connector.validateSource(descriptor)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
    expect(client.calls).toHaveLength(0);
  });
});
