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
import { SourceService } from './source-service.js';
import { SpecService } from './spec-service.js';
import { InterpretationService } from './interpretation-service.js';
import { MaintenanceService } from './maintenance-service.js';
import { PromotionService } from './promotion-service.js';
import type { ServiceBundle } from './types.js';

export function createServices(
  prisma: PrismaClient,
  config: AppConfig,
  logger: Logger,
  overrides: {
    runner?: GeneratorRunner;
    bigQueryClient?: BigQueryClientLike;
    certificationExecutor?: AgentExecutor;
  } = {},
): ServiceBundle {
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
    health: new HealthService(prisma),
    dispatcher,
    certificationDispatcher,
    maintenance,
  };
}
