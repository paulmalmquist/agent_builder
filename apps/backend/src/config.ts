import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const booleanEnvironmentValue = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  return value;
}, z.boolean());

const optionalEnvironmentString = (minimumLength = 1) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(minimumLength).optional(),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().trim().min(1).max(253).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    GENERATOR_CLI_PATH: z.string().min(1).optional(),
    GENERATOR_VERSION: z.string().min(1).default('0.2.0'),
    GENERATOR_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    GENERATOR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900_000).default(120_000),
    GENERATOR_MAX_OUTPUT_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(100_000_000)
      .default(1_000_000),
    CERTIFICATION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    CERTIFICATION_RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900_000).default(120_000),
    CERTIFICATION_EXECUTOR_VERSION: z.string().trim().min(1).max(80).default('1.0.0'),
    CERTIFICATION_FULL_RUN_RETENTION: z.coerce.number().int().min(1).max(1000).default(20),
    INTERPRETATION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(24),
    MAINTENANCE_ENABLED: booleanEnvironmentValue.default(true),
    MAINTENANCE_HOUR_UTC: z.coerce.number().int().min(0).max(23).default(2),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
    AUTH_BEARER_TOKEN: optionalEnvironmentString(24),
    AUTH_ACTOR_ID: z.string().trim().min(2).max(200).default('local-user'),
    BIGQUERY_ENABLED: booleanEnvironmentValue.default(false),
    CONFLUENCE_ENABLED: booleanEnvironmentValue.default(false),
    JIRA_ENABLED: booleanEnvironmentValue.default(false),
    EMAIL_ENABLED: booleanEnvironmentValue.default(false),
    SLACK_ENABLED: booleanEnvironmentValue.default(false),
    INTERSTELLAR_ENABLED: booleanEnvironmentValue.default(false),
    GOOGLE_CLOUD_PROJECT: optionalEnvironmentString(),
    BIGQUERY_MAXIMUM_BYTES_BILLED: z.coerce.number().int().positive().default(100_000_000),
    BIGQUERY_PREVIEW_ROW_LIMIT: z.coerce.number().int().min(1).max(1000).default(25),
  })
  .superRefine((environment, context) => {
    if (environment.BIGQUERY_ENABLED && environment.GOOGLE_CLOUD_PROJECT === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GOOGLE_CLOUD_PROJECT'],
        message: 'GOOGLE_CLOUD_PROJECT is required when BIGQUERY_ENABLED=true',
      });
    }
    const anyLiveProviderEnabled =
      environment.BIGQUERY_ENABLED ||
      environment.CONFLUENCE_ENABLED ||
      environment.JIRA_ENABLED ||
      environment.EMAIL_ENABLED ||
      environment.SLACK_ENABLED ||
      environment.INTERSTELLAR_ENABLED;
    if (anyLiveProviderEnabled && environment.AUTH_BEARER_TOKEN === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_BEARER_TOKEN'],
        message: 'AUTH_BEARER_TOKEN is required when any live provider is enabled',
      });
    }
  });

export type ProviderName = 'bigquery' | 'confluence' | 'jira' | 'email' | 'slack' | 'interstellar';

export type AppConfig = {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  generatorCliPath: string;
  generatorVersion: string;
  generatorConcurrency: number;
  generatorTimeoutMs: number;
  generatorMaxOutputBytes: number;
  certificationConcurrency: number;
  certificationRunTimeoutMs: number;
  certificationExecutorVersion: string;
  certificationFullRunRetention: number;
  interpretationTtlHours: number;
  maintenance: {
    enabled: boolean;
    hourUtc: number;
  };
  shutdownTimeoutMs: number;
  auth: {
    enabled: boolean;
    actorId: string;
    bearerToken?: string;
  };
  providers: Record<ProviderName, boolean>;
  bigQuery: {
    enabled: boolean;
    projectId: string | null;
    maximumBytesBilled: number;
    previewRowLimit: number;
  };
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const runningFromBackendWorkspace = process.cwd().endsWith(path.join('apps', 'backend'));
  const defaultCliPath = path.resolve(
    process.cwd(),
    runningFromBackendWorkspace
      ? path.join('..', 'generator-cli', 'dist', 'index.js')
      : path.join('apps', 'generator-cli', 'dist', 'index.js'),
  );

  return {
    environment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    generatorCliPath: parsed.GENERATOR_CLI_PATH ?? defaultCliPath,
    generatorVersion: parsed.GENERATOR_VERSION,
    generatorConcurrency: parsed.GENERATOR_CONCURRENCY,
    generatorTimeoutMs: parsed.GENERATOR_TIMEOUT_MS,
    generatorMaxOutputBytes: parsed.GENERATOR_MAX_OUTPUT_BYTES,
    certificationConcurrency: parsed.CERTIFICATION_CONCURRENCY,
    certificationRunTimeoutMs: parsed.CERTIFICATION_RUN_TIMEOUT_MS,
    certificationExecutorVersion: parsed.CERTIFICATION_EXECUTOR_VERSION,
    certificationFullRunRetention: parsed.CERTIFICATION_FULL_RUN_RETENTION,
    interpretationTtlHours: parsed.INTERPRETATION_TTL_HOURS,
    maintenance: {
      enabled: parsed.MAINTENANCE_ENABLED,
      hourUtc: parsed.MAINTENANCE_HOUR_UTC,
    },
    shutdownTimeoutMs: parsed.SHUTDOWN_TIMEOUT_MS,
    auth: {
      enabled: parsed.AUTH_BEARER_TOKEN !== undefined,
      actorId: parsed.AUTH_ACTOR_ID,
      ...(parsed.AUTH_BEARER_TOKEN === undefined ? {} : { bearerToken: parsed.AUTH_BEARER_TOKEN }),
    },
    providers: {
      bigquery: parsed.BIGQUERY_ENABLED,
      confluence: parsed.CONFLUENCE_ENABLED,
      jira: parsed.JIRA_ENABLED,
      email: parsed.EMAIL_ENABLED,
      slack: parsed.SLACK_ENABLED,
      interstellar: parsed.INTERSTELLAR_ENABLED,
    },
    bigQuery: {
      enabled: parsed.BIGQUERY_ENABLED,
      projectId: parsed.GOOGLE_CLOUD_PROJECT ?? null,
      maximumBytesBilled: parsed.BIGQUERY_MAXIMUM_BYTES_BILLED,
      previewRowLimit: parsed.BIGQUERY_PREVIEW_ROW_LIMIT,
    },
  };
}
