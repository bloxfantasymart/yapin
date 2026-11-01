import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const booleanFlag = (defaultValue = false) =>
  z
    .preprocess((val) => {
      if (val === undefined || val === null || val === '') return defaultValue;
      if (typeof val === 'boolean') return val;
      const normalized = String(val).trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
      return val;
    }, z.boolean())
    .default(defaultValue);

const portNumber = (defaultPort) =>
  z.preprocess(
    (val) => (val === undefined || val === '' ? defaultPort : Number(val)),
    z.number().int().min(1).max(65535),
  );

export const EnvSchema = z
  .object({
    YAPIN_BOT_TOKEN: z
      .string()
      .trim()
      .min(8, 'YAPIN_BOT_TOKEN is required')
      .refine((v) => v.startsWith('yb_'), {
        message: 'YAPIN_BOT_TOKEN must start with "yb_" (generate one in Yapin Settings -> Developer)',
      }),
    YAPIN_API_BASE_URL: z
      .string()
      .trim()
      .url('YAPIN_API_BASE_URL must be a valid HTTP/HTTPS URL')
      .default('https://www.yapin.gg/api/bot/v1')
      .transform((u) => u.replace(/\/+$/, '')),
    YAPIN_SERVER_ID: z
      .string()
      .trim()
      .min(1, 'YAPIN_SERVER_ID is required'),
    // Local crash-safe JSON storage directory (no external database needed!)
    DATA_DIR: z
      .string()
      .trim()
      .min(1, 'DATA_DIR cannot be empty')
      .default('./data'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),

    // Verified optional Yapin Gateway & Event Webhook configuration
    YAPIN_GATEWAY_URL: z
      .string()
      .trim()
      .default('wss://rt.yapper.website/bot'),
    YAPIN_ENABLE_GATEWAY: booleanFlag(true),

    YAPIN_WEBHOOK_ENABLED: booleanFlag(false),
    YAPIN_WEBHOOK_PORT: portNumber(3100),
    YAPIN_WEBHOOK_PATH: z.string().trim().default('/webhooks/yapin'),
    YAPIN_WEBHOOK_SECRET: z.string().trim().optional().default(''),

    // Verified optional Staff Dashboard ("Login with Yapin'" OAuth2)
    DASHBOARD_ENABLED: booleanFlag(false),
    DASHBOARD_HOST: z.string().trim().default('0.0.0.0'),
    DASHBOARD_PORT: portNumber(3200),
    DASHBOARD_SESSION_SECRET: z.string().trim().optional().default(''),
    YAPIN_OAUTH_CLIENT_ID: z.string().trim().optional().default(''),
    YAPIN_OAUTH_CLIENT_SECRET: z.string().trim().optional().default(''),
    YAPIN_OAUTH_REDIRECT_URI: z.string().trim().optional().default(''),
    YAPIN_SITE_URL: z
      .string()
      .trim()
      .url()
      .default('https://www.yapin.gg')
      .transform((u) => u.replace(/\/+$/, '')),
  })
  .superRefine((env, ctx) => {
    if (env.YAPIN_WEBHOOK_ENABLED && env.YAPIN_WEBHOOK_SECRET.length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['YAPIN_WEBHOOK_SECRET'],
        message:
          'YAPIN_WEBHOOK_SECRET (at least 16 characters) is required when YAPIN_WEBHOOK_ENABLED=true',
      });
    }

    if (env.DASHBOARD_ENABLED) {
      if (env.DASHBOARD_SESSION_SECRET.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DASHBOARD_SESSION_SECRET'],
          message:
            'DASHBOARD_SESSION_SECRET must be at least 32 characters when DASHBOARD_ENABLED=true',
        });
      }
      if (!env.YAPIN_OAUTH_CLIENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['YAPIN_OAUTH_CLIENT_ID'],
          message: 'YAPIN_OAUTH_CLIENT_ID is required when DASHBOARD_ENABLED=true',
        });
      }
      if (!env.YAPIN_OAUTH_CLIENT_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['YAPIN_OAUTH_CLIENT_SECRET'],
          message: 'YAPIN_OAUTH_CLIENT_SECRET is required when DASHBOARD_ENABLED=true',
        });
      }
      if (!env.YAPIN_OAUTH_REDIRECT_URI) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['YAPIN_OAUTH_REDIRECT_URI'],
          message: 'YAPIN_OAUTH_REDIRECT_URI is required when DASHBOARD_ENABLED=true',
        });
      }
    }
  });

/**
 * Validates environment configuration. Supports Yapin Bot Hosting's YAPPER_BOT_TOKEN
 * as a documented fallback when YAPIN_BOT_TOKEN is unset.
 *
 * @param {Record<string, string | undefined>} [rawEnv=process.env]
 * @param {{ exitOnError?: boolean }} [options]
 */
export function loadEnv(rawEnv = process.env, { exitOnError = false } = {}) {
  const normalizedInput = {
    ...rawEnv,
    YAPIN_BOT_TOKEN: rawEnv.YAPIN_BOT_TOKEN || rawEnv.YAPPER_BOT_TOKEN || '',
  };

  const parsed = EnvSchema.safeParse(normalizedInput);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('\n');
    const message = `Invalid environment configuration:\n${details}`;
    if (exitOnError) {
      process.stderr.write(`[FATAL] ${message}\n`);
      process.exit(1);
    }
    throw new Error(message);
  }

  return Object.freeze(parsed.data);
}
