import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import {
  EnvironmentPluginSecretResolver,
  HttpPluginTransportAdapter,
  PluginTransportRegistry,
  UnavailablePluginTransportAdapter,
} from '@paul-os/runtime';
import { loadWorkerConfig } from './config.js';
import { WorkerDaemon } from './daemon.js';
import { ExecutionEngine } from './engine.js';
import { createModelProvider } from './provider.js';
import { PrismaWorkerStore } from './store.js';
import { WorkerPluginExecutor } from './plugin-execution.js';
import { WorkerPluginPlanCoordinator } from './plugin-plan.js';
import { PrismaWorkerPluginExecutionStore } from './plugin-store.js';

const config = loadWorkerConfig();
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      '*.apiKey',
      '*.token',
      '*.credentials',
      '*.input',
      '*.output',
      '*.prompt',
      '*.response',
      '*.context',
      '*.contextValues',
    ],
    censor: '[REDACTED]',
  },
});
const prisma = new PrismaClient();
const provider = createModelProvider(config);
const store = new PrismaWorkerStore(prisma);
const pluginStore = new PrismaWorkerPluginExecutionStore(prisma);
const pluginRuntime = new PluginTransportRegistry([
  new HttpPluginTransportAdapter(new EnvironmentPluginSecretResolver(process.env)),
  new UnavailablePluginTransportAdapter('mcp'),
  new UnavailablePluginTransportAdapter('cli'),
  new UnavailablePluginTransportAdapter('db'),
]);
const pluginExecutor = new WorkerPluginExecutor(pluginStore, pluginRuntime);
const pluginPlans = new WorkerPluginPlanCoordinator(pluginStore, pluginExecutor);
const engine = new ExecutionEngine(store, provider, config, logger, pluginPlans);
const daemon = new WorkerDaemon(engine, config, logger);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Worker shutdown requested');
  await daemon.stop();
  await prisma.$disconnect();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

daemon.start().catch(async (error: unknown) => {
  logger.fatal({ error }, 'Worker failed to start');
  await prisma.$disconnect();
  process.exitCode = 1;
});

export { loadWorkerConfig } from './config.js';
export { WorkerDaemon } from './daemon.js';
export { ExecutionEngine } from './engine.js';
export { createModelProvider } from './provider.js';
export { PrismaWorkerStore } from './store.js';
export { WorkerPluginExecutor } from './plugin-execution.js';
export { WorkerPluginPlanCoordinator } from './plugin-plan.js';
export { PrismaWorkerPluginExecutionStore } from './plugin-store.js';
export type * from './types.js';
