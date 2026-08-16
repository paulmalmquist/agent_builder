import { PrismaClient } from '@prisma/client';
import { pino } from 'pino';
import { loadWorkerConfig } from './config.js';
import { WorkerDaemon } from './daemon.js';
import { ExecutionEngine } from './engine.js';
import { createModelProvider } from './provider.js';
import { PrismaWorkerStore } from './store.js';

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
const engine = new ExecutionEngine(store, provider, config, logger);
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
export type * from './types.js';
