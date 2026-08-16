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
    AUTOMATION_SCHEDULER_ENABLED: booleanEnvironmentValue.default(true),
    AUTOMATION_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(30_000),
    AUTOMATION_SCHEDULER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),
    AUTH_BEARER_TOKEN: optionalEnvironmentString(24),
    AUTH_ACTOR_ID: z.string().trim().min(2).max(200).default('local-user'),
    BIGQUERY_ENABLED: booleanEnvironmentValue.default(false),
    CONFLUENCE_ENABLED: booleanEnvironmentValue.default(false),
    JIRA_ENABLED: booleanEnvironmentValue.default(false),
    EMAIL_ENABLED: booleanEnvironmentValue.default(false),
    SLACK_ENABLED: booleanEnvironmentValue.default(false),
    TELEMETRY_ENABLED: booleanEnvironmentValue.default(false),
    MODEL_PROVIDER: z.enum(['deterministic', 'anthropic', 'gateway']).default('deterministic'),
    PROVIDER_POLICY: z.enum(['direct_allowed', 'gateway_only']).default('direct_allowed'),
    MODEL_NAME: optionalEnvironmentString(),
    ANTHROPIC_API_KEY: optionalEnvironmentString(20),
    MODEL_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900_000).default(120_000),
    EXECUTION_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    EXECUTION_LEASE_MS: z.coerce.number().int().min(5000).max(900_000).default(60_000),
    EXECUTION_DISPATCH_MODE: z.enum(['in_process', 'external']).default('in_process'),
    MODEL_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(3),
    MODEL_OUTPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(15),
    MODEL_PRICING_VERSION: z.string().trim().min(1).max(80).default('local-2026-08'),
    REPOSITORY_SOURCE_COMMIT: optionalEnvironmentString(),
    PAUL_OS_PROFILE_PATH: optionalEnvironmentString(),
    ALLOW_UNVERIFIED_REPOSITORY_IMPORTS: booleanEnvironmentValue.default(false),
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
      environment.TELEMETRY_ENABLED;
    if (anyLiveProviderEnabled && environment.AUTH_BEARER_TOKEN === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_BEARER_TOKEN'],
        message: 'AUTH_BEARER_TOKEN is required when any live provider is enabled',
      });
    }
    if (
      environment.MODEL_PROVIDER === 'anthropic' &&
      (environment.ANTHROPIC_API_KEY === undefined || environment.MODEL_NAME === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MODEL_PROVIDER'],
        message: 'ANTHROPIC_API_KEY and MODEL_NAME are required for the Anthropic provider',
      });
    }
    if (
      environment.PROVIDER_POLICY === 'gateway_only' &&
      environment.MODEL_PROVIDER !== 'gateway'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PROVIDER_POLICY'],
        message: 'gateway_only requires MODEL_PROVIDER=gateway and fails closed without an adapter',
      });
    }
    const loopbackHost = ['127.0.0.1', 'localhost', '::1'].includes(environment.HOST);
    if (
      environment.MODEL_PROVIDER !== 'deterministic' &&
      !loopbackHost &&
      environment.AUTH_BEARER_TOKEN === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_BEARER_TOKEN'],
        message: 'AUTH_BEARER_TOKEN is required for non-loopback model execution',
      });
    }
    if (
      environment.EXECUTION_DISPATCH_MODE === 'in_process' &&
      (environment.NODE_ENV === 'production' || environment.MODEL_PROVIDER !== 'deterministic')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EXECUTION_DISPATCH_MODE'],
        message:
          'The in-process dispatcher is fixture-only; production and live model providers require EXECUTION_DISPATCH_MODE=external',
      });
    }
    if (!environment.ALLOW_UNVERIFIED_REPOSITORY_IMPORTS) {
      if (environment.REPOSITORY_SOURCE_COMMIT === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REPOSITORY_SOURCE_COMMIT'],
          message:
            'REPOSITORY_SOURCE_COMMIT is required unless ALLOW_UNVERIFIED_REPOSITORY_IMPORTS=true',
        });
      } else if (!/^[a-f0-9]{7,64}$/i.test(environment.REPOSITORY_SOURCE_COMMIT)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['REPOSITORY_SOURCE_COMMIT'],
          message: 'Verified repository source commits must be hexadecimal Git commit IDs',
        });
      }
    }
  });

export type ProviderName = 'bigquery' | 'confluence' | 'jira' | 'email' | 'slack' | 'telemetry';

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
  automationScheduler: {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
  };
  profilePath: string;
  shutdownTimeoutMs: number;
  auth: {
    enabled: boolean;
    actorId: string;
    bearerToken?: string;
  };
  providers: Record<ProviderName, boolean>;
  model: {
    provider: 'deterministic' | 'anthropic' | 'gateway';
    providerPolicy: 'direct_allowed' | 'gateway_only';
    name: string;
    apiKey?: string;
    timeoutMs: number;
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    pricingVersion: string;
  };
  execution: {
    concurrency: number;
    leaseMs: number;
    dispatchMode: 'in_process' | 'external';
  };
  repositorySourceCommit: string;
  repositorySourceVerified: boolean;
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
  const repositoryRoot = runningFromBackendWorkspace
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
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
    automationScheduler: {
      enabled: parsed.AUTOMATION_SCHEDULER_ENABLED,
      intervalMs: parsed.AUTOMATION_SCHEDULER_INTERVAL_MS,
      batchSize: parsed.AUTOMATION_SCHEDULER_BATCH_SIZE,
    },
    profilePath: path.resolve(
      repositoryRoot,
      parsed.PAUL_OS_PROFILE_PATH ?? '.local/profile/profile.yaml',
    ),
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
      telemetry: parsed.TELEMETRY_ENABLED,
    },
    model: {
      provider: parsed.MODEL_PROVIDER,
      providerPolicy: parsed.PROVIDER_POLICY,
      name: parsed.MODEL_NAME ?? 'daily-brief-fixture',
      ...(parsed.ANTHROPIC_API_KEY === undefined ? {} : { apiKey: parsed.ANTHROPIC_API_KEY }),
      timeoutMs: parsed.MODEL_TIMEOUT_MS,
      inputUsdPerMillionTokens: parsed.MODEL_INPUT_USD_PER_MILLION_TOKENS,
      outputUsdPerMillionTokens: parsed.MODEL_OUTPUT_USD_PER_MILLION_TOKENS,
      pricingVersion: parsed.MODEL_PRICING_VERSION,
    },
    execution: {
      concurrency: parsed.EXECUTION_CONCURRENCY,
      leaseMs: parsed.EXECUTION_LEASE_MS,
      dispatchMode: parsed.EXECUTION_DISPATCH_MODE,
    },
    repositorySourceCommit: parsed.ALLOW_UNVERIFIED_REPOSITORY_IMPORTS
      ? 'local-unverified'
      : (parsed.REPOSITORY_SOURCE_COMMIT as string),
    repositorySourceVerified: !parsed.ALLOW_UNVERIFIED_REPOSITORY_IMPORTS,
    bigQuery: {
      enabled: parsed.BIGQUERY_ENABLED,
      projectId: parsed.GOOGLE_CLOUD_PROJECT ?? null,
      maximumBytesBilled: parsed.BIGQUERY_MAXIMUM_BYTES_BILLED,
      previewRowLimit: parsed.BIGQUERY_PREVIEW_ROW_LIMIT,
    },
  };
}
