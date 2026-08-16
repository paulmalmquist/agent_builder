import { pino, type Logger } from 'pino';
import type { AppConfig } from './config.js';

export function createLogger(config: Pick<AppConfig, 'logLevel'>): Logger {
  return pino({
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        '*.apiKey',
        '*.credentials',
        '*.password',
        '*.token',
        'req.body',
        'request.body',
        'res.body',
        'response.body',
        'error.response.body',
        'error.cause.response.body',
        'err.response.body',
        'err.cause.response.body',
        '*.rows',
        '*.rowPayload',
        '*.context',
        '*.contextValues',
      ],
      censor: '[REDACTED]',
    },
  });
}
