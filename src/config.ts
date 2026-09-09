import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8090),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_PATH: z.string().default('./data/gateway.db'),
  APP_MASTER_KEY: z.string().min(64).max(64).regex(/^[0-9a-fA-F]+$/, 'Must be 64-char hex string (32 bytes)'),

  // Gmail & Pub/Sub
  GMAIL_MAILBOX_ID: z.string().default('me'),
  GMAIL_CREDENTIALS_PATH: z.string().default('./credentials/gmail-credentials.json'),
  GMAIL_TOKEN_PATH: z.string().default('./credentials/gmail-token.json'),
  GMAIL_OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  PUBSUB_CREDENTIALS_PATH: z.string().optional(),
  PUBSUB_SUBSCRIPTION_NAME: z.string().optional(),
  PUBSUB_TOPIC_NAME: z.string().optional(),

  // Bank policy
  ALLOWED_BANK_DOMAINS: z.string().default('acb.com.vn'),
  ALLOWED_RECEIVER_ACCOUNTS: z.string().default(''), // comma-separated if any
  INGEST_START_AT: z.string().optional(), // ISO date string cutoff

  // Operational timings
  RECONCILE_INTERVAL_SECONDS: z.coerce.number().min(10).default(60),
  WATCH_RENEW_INTERVAL_HOURS: z.coerce.number().min(1).default(12),
  WEBHOOK_TIMEOUT_MS: z.coerce.number().min(1000).max(60000).default(10000),
  MAX_RETRY_ATTEMPTS: z.coerce.number().min(1).default(20),
  MAX_RETRY_DURATION_HOURS: z.coerce.number().min(1).default(48),

  // Cloudflare Access assertion validation at the tunnel origin.
  CLOUDFLARE_ACCESS_TEAM_NAME: z.string().default(''),
  CLOUDFLARE_ACCESS_AUD: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  for (const key of ['CLOUDFLARE_ACCESS_TEAM_NAME', 'CLOUDFLARE_ACCESS_AUD'] as const) {
    if (!value[key].trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'Required in production for Cloudflare Access JWT validation',
      });
    }
  }
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(overrides?: Partial<Record<string, string>>): Config {
  if (cachedConfig && !overrides) {
    return cachedConfig;
  }

  const rawEnv = {
    ...process.env,
    ...overrides,
  };

  // Provide a test default key if in test env and no key set
  if (rawEnv.NODE_ENV === 'test' && !rawEnv.APP_MASTER_KEY) {
    rawEnv.APP_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  }

  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.format());
    throw new Error('Invalid configuration');
  }

  const config = {
    ...result.data,
    DATABASE_PATH: path.resolve(result.data.DATABASE_PATH),
    GMAIL_CREDENTIALS_PATH: path.resolve(result.data.GMAIL_CREDENTIALS_PATH),
    GMAIL_TOKEN_PATH: path.resolve(result.data.GMAIL_TOKEN_PATH),
    PUBSUB_CREDENTIALS_PATH: result.data.PUBSUB_CREDENTIALS_PATH
      ? path.resolve(result.data.PUBSUB_CREDENTIALS_PATH)
      : undefined,
  };

  if (!overrides) {
    cachedConfig = config;
  }

  return config;
}
