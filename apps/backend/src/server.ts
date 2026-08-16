import { createServer, type Server } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { prisma } from './prisma.js';
import { createServices } from './services/create-services.js';

export async function startServer(): Promise<Server> {
  const config = loadConfig();
  const logger = createLogger(config);
  const services = createServices(prisma, config, logger);
  await services.dispatcher.recoverAndResume();
  await services.certificationDispatcher.recoverAndResume();
  if (services.platform.dispatchMode === 'in_process') {
    await services.platform.executionDispatcher.recoverAndResume();
  }
  await services.maintenance.start();
  await services.automationScheduler.start();

  const server = createServer(createApp(services, logger, config));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ host: config.host, port: config.port }, 'Agent Builder backend listening');

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    services.maintenance.stop();
    logger.info({ signal }, 'Shutting down Agent Builder backend');
    const forceExit = setTimeout(() => {
      logger.error(
        { signal, timeoutMs: config.shutdownTimeoutMs },
        'Graceful shutdown timed out; in-flight generation will be reaped on restart',
      );
      server.closeAllConnections();
      void prisma.$disconnect().finally(() => process.exit(1));
    }, config.shutdownTimeoutMs);
    forceExit.unref();
    const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.all([serverClosed, services.automationScheduler.stop()]).then(() => {
      clearTimeout(forceExit);
      void prisma.$disconnect().finally(() => {
        process.exitCode = 0;
      });
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (process.env['NODE_ENV'] !== 'test') {
  void startServer().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
