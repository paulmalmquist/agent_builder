import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const optionalString = (minimum = 1) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(minimum).optional(),
  );

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    WORKER_ID: optionalString(3),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
    WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
    WORKER_LEASE_MS: z.coerce.number().int().min(5_000).max(900_000).default(60_000),
    WORKER_HEARTBEAT_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
    WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(20_000),
    MODEL_PROVIDER: z.enum(['deterministic', 'anthropic', 'gateway']).default('deterministic'),
    PROVIDER_POLICY: z.enum(['direct_allowed', 'gateway_only']).default('direct_allowed'),
    MODEL_NAME: optionalString(),
    ANTHROPIC_API_KEY: optionalString(20),
    MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(120_000),
    MODEL_INPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(3),
    MODEL_OUTPUT_USD_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(15),
    MODEL_PRICING_VERSION: z.string().trim().min(1).max(80).default('local-2026-08'),
    PAUL_OS_PROFILE_PATH: optionalString(),
  })
  .superRefine((environment, context) => {
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
    if (environment.WORKER_HEARTBEAT_MS * 2 >= environment.WORKER_LEASE_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WORKER_HEARTBEAT_MS'],
        message: 'Heartbeat interval must be less than half the lease duration',
      });
    }
  });

export interface WorkerConfig {
  environment: 'development' | 'test' | 'production';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  workerId?: string;
  concurrency: number;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  shutdownTimeoutMs: number;
  profilePath: string;
  provider: {
    kind: 'deterministic' | 'anthropic' | 'gateway';
    policy: 'direct_allowed' | 'gateway_only';
    model: string;
    apiKey?: string;
    timeoutMs: number;
  };
  pricing: {
    inputUsdPerMillionTokens: number;
    outputUsdPerMillionTokens: number;
    version: string;
  };
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = environmentSchema.parse(environment);
  const runningFromWorkerWorkspace = process.cwd().endsWith(path.join('apps', 'worker'));
  const repositoryRoot = runningFromWorkerWorkspace
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
  return {
    environment: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.WORKER_ID === undefined ? {} : { workerId: parsed.WORKER_ID }),
    concurrency: parsed.WORKER_CONCURRENCY,
    pollMs: parsed.WORKER_POLL_MS,
    leaseMs: parsed.WORKER_LEASE_MS,
    heartbeatMs: parsed.WORKER_HEARTBEAT_MS,
    shutdownTimeoutMs: parsed.WORKER_SHUTDOWN_TIMEOUT_MS,
    profilePath: path.resolve(
      repositoryRoot,
      parsed.PAUL_OS_PROFILE_PATH ?? '.local/profile/profile.yaml',
    ),
    provider: {
      kind: parsed.MODEL_PROVIDER,
      policy: parsed.PROVIDER_POLICY,
      model: parsed.MODEL_NAME ?? 'daily-brief-fixture',
      ...(parsed.ANTHROPIC_API_KEY === undefined ? {} : { apiKey: parsed.ANTHROPIC_API_KEY }),
      timeoutMs: parsed.MODEL_TIMEOUT_MS,
    },
    pricing: {
      inputUsdPerMillionTokens: parsed.MODEL_INPUT_USD_PER_MILLION_TOKENS,
      outputUsdPerMillionTokens: parsed.MODEL_OUTPUT_USD_PER_MILLION_TOKENS,
      version: parsed.MODEL_PRICING_VERSION,
    },
  };
}
