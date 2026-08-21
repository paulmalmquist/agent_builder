import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config.js';
import {
  createKnowledgeConnectorRegistry,
  type BigQueryClientLike,
} from '../connectors/knowledge.js';
import { GenerationDispatcher } from '../generation/dispatcher.js';
import { CliGeneratorRunner, type GeneratorRunner } from '../generation/runner.js';
import { CertificationDispatcher } from '../certification/dispatcher.js';
import { ManifestFixtureExecutor, type AgentExecutor } from '../certification/executor.js';
import { MaintenanceScheduler } from '../maintenance/scheduler.js';
import { CatalogService } from './catalog-service.js';
import { CertificationService } from './certification-service.js';
import { CorpusService } from './corpus-service.js';
import { DeploymentService } from './deployment-service.js';
import { GateConfigService } from './gate-config-service.js';
import { GenerationService } from './generation-service.js';
import { HealthService } from './health-service.js';
import { BrowserSelfTestService } from './selftest-service.js';
import { SourceService } from './source-service.js';
import { SpecService } from './spec-service.js';
import { InterpretationService } from './interpretation-service.js';
import { MaintenanceService } from './maintenance-service.js';
import { PromotionService } from './promotion-service.js';
import type { CompleteServiceBundle } from './types.js';
import {
  AnthropicModelProvider,
  DeterministicDailyBriefProvider,
  EnvironmentPluginSecretResolver,
  HttpPluginTransportAdapter,
  PluginTransportRegistry,
  UnavailablePluginTransportAdapter,
  type ModelProvider,
  type PluginHealthProbe,
} from '@paul-os/runtime';
import {
  DeterministicFeatureHashEmbeddingProvider,
  type EmbeddingProvider,
} from '@agent-builder/contracts';
import { RegistryService } from './registry-service.js';
import { RoadmapService } from './roadmap-service.js';
import { ReleaseGovernanceService } from './release-governance-service.js';
import { ExecutionService } from './execution-service.js';
import { AutomationLearningService } from './automation-learning-service.js';
import { ExecutionDispatcher } from '../execution/dispatcher.js';
import { AutomationScheduler } from '../automation/scheduler.js';
import { AttentionService } from './attention-service.js';
import { PluginService } from './plugin-service.js';
import { PluginHealthScheduler } from '../plugins/health-scheduler.js';
import { ReuseService } from './reuse-service.js';
import { CatalogIndexScheduler } from '../catalog/index-scheduler.js';
import { PrismaIdentityDirectory } from './identity-directory.js';

export function createServices(
  prisma: PrismaClient,
  config: AppConfig,
  logger: Logger,
  overrides: {
    runner?: GeneratorRunner;
    bigQueryClient?: BigQueryClientLike;
    certificationExecutor?: AgentExecutor;
    modelProvider?: ModelProvider;
    pluginHealthProbe?: PluginHealthProbe;
    embeddingProvider?: EmbeddingProvider;
  } = {},
): CompleteServiceBundle {
  const connectors = createKnowledgeConnectorRegistry(config, overrides.bigQueryClient);
  const generation = new GenerationService(prisma, config);
  const runner = overrides.runner ?? new CliGeneratorRunner(config);
  const dispatcher = new GenerationDispatcher(
    config.generatorConcurrency,
    generation,
    runner,
    logger,
  );
  const interpretation = new InterpretationService(prisma, config.interpretationTtlHours);
  const certification = new CertificationService(
    prisma,
    overrides.certificationExecutor ??
      new ManifestFixtureExecutor(config.certificationExecutorVersion),
  );
  const certificationDispatcher = new CertificationDispatcher(
    config.certificationConcurrency,
    certification,
    logger,
    config.certificationRunTimeoutMs,
  );
  const maintenanceTask = new MaintenanceService(
    prisma,
    certification,
    interpretation,
    (runId) => certificationDispatcher.enqueue(runId),
    config.certificationFullRunRetention,
    logger,
  );
  const maintenance = new MaintenanceScheduler(
    maintenanceTask,
    logger,
    config.maintenance.enabled,
    config.maintenance.hourUtc,
  );
  let modelProvider = overrides.modelProvider;
  if (modelProvider === undefined) {
    if (config.model.provider === 'deterministic') {
      modelProvider = new DeterministicDailyBriefProvider();
    } else if (config.model.provider === 'anthropic') {
      if (config.model.apiKey === undefined) {
        throw new Error('Anthropic model provider is missing its API key');
      }
      modelProvider = new AnthropicModelProvider({
        apiKey: config.model.apiKey,
        model: config.model.name,
      });
    } else {
      throw new Error(
        'MODEL_PROVIDER=gateway is configured but no approved gateway adapter is installed',
      );
    }
  }
  const execution = new ExecutionService(prisma, config, modelProvider);
  const attention = new AttentionService(prisma);
  const pluginHealthProbe =
    overrides.pluginHealthProbe ??
    new PluginTransportRegistry([
      new HttpPluginTransportAdapter(new EnvironmentPluginSecretResolver(process.env)),
      new UnavailablePluginTransportAdapter('mcp'),
      new UnavailablePluginTransportAdapter('cli'),
      new UnavailablePluginTransportAdapter('db'),
    ]);
  const plugins = new PluginService(prisma, config, pluginHealthProbe);
  const embeddingProvider =
    overrides.embeddingProvider ??
    (config.model.provider === 'deterministic'
      ? new DeterministicFeatureHashEmbeddingProvider()
      : undefined);
  const reuse = new ReuseService(prisma, config.model.providerPolicy, embeddingProvider);
  const catalogIndexScheduler = new CatalogIndexScheduler(
    reuse.indexer,
    logger,
    config.environment !== 'test',
  );
  const pluginHealthScheduler = new PluginHealthScheduler(
    plugins,
    logger,
    config.environment !== 'test',
  );
  const executionDispatcher = new ExecutionDispatcher(
    config.execution.concurrency,
    execution,
    logger,
    config.execution.leaseMs,
  );
  const automationLearning = new AutomationLearningService(prisma, execution, attention);
  const automationScheduler = new AutomationScheduler(
    automationLearning,
    (runId) => executionDispatcher.enqueue(runId),
    config.execution.dispatchMode,
    logger,
    config.automationScheduler.enabled,
    config.automationScheduler.intervalMs,
    config.automationScheduler.batchSize,
  );

  return {
    catalog: new CatalogService(prisma),
    sources: new SourceService(prisma),
    specs: new SpecService(prisma, connectors),
    interpretations: interpretation,
    generation,
    deployment: new DeploymentService(prisma),
    certification,
    promotion: new PromotionService(prisma),
    corpus: new CorpusService(prisma),
    gateConfigs: new GateConfigService(prisma),
    health: new HealthService(prisma, config.buildIdentity),
    selfTest: new BrowserSelfTestService(config.selfTest),
    dispatcher,
    certificationDispatcher,
    maintenance,
    automationScheduler,
    pluginHealthScheduler,
    catalogIndexScheduler,
    platform: {
      identityDirectory: new PrismaIdentityDirectory(prisma),
      attention,
      plugins,
      reuse,
      registry: new RegistryService(prisma, config.repositorySourceCommit),
      roadmaps: new RoadmapService(prisma),
      releaseGovernance: new ReleaseGovernanceService(prisma),
      execution,
      automationLearning,
      executionDispatcher,
      dispatchMode: config.execution.dispatchMode,
    },
  };
}
