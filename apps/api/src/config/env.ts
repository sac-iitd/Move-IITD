import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

/** Loads the nearest .env walking up from the working directory (repo root in a workspace). */
function loadDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return;
    }
    dir = path.dirname(dir);
  }
}

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const PLACEHOLDER_RE = /change[-_ ]?me|replace[-_ ]?me|placeholder|example/i;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    /** Sub-path the app is served under, e.g. "/MoveIITD" for https://sac.iitd.ac.in/MoveIITD/. Empty = root. */
    APP_BASE_PATH: z
      .string()
      .regex(
        /^(\/[A-Za-z0-9._-]+)*$/,
        'Must look like /MoveIITD (leading slash, no trailing slash)',
      )
      .default(''),
    /** Number of reverse-proxy hops to trust for client IP / protocol (e.g. 1 behind nginx). */
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_ENABLED: bool(true),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_TTL_HOURS: z.coerce
      .number()
      .min(1)
      .max(24 * 30)
      .default(12),

    AUTH_PROVIDER: z.enum(['kebros', 'dev-mock']).default('kebros'),
    AUTH_DEV_MOCK_ENABLED: bool(false),

    // IIT Delhi OAuth 2 ("KEBROS" / Kerberos login). Endpoints per https://oauth.iitd.ac.in/client_config.php
    KEBROS_AUTHORIZE_URL: z.string().url().default('https://oauth2.iitd.ac.in/authorize.php'),
    KEBROS_TOKEN_URL: z.string().url().default('https://oauth2.iitd.ac.in/token.php'),
    KEBROS_RESOURCE_URL: z.string().url().default('https://oauth2.iitd.ac.in/resource.php'),
    KEBROS_CLIENT_ID: z.string().optional(),
    KEBROS_CLIENT_SECRET: z.string().optional(),
    /**
     * The Redirect URI registered with the IIT Delhi OAuth administrator. Its path must end in
     * /api/auth/iitd/callback (alias) or /api/v1/auth/callback; the reverse proxy strips APP_BASE_PATH.
     */
    KEBROS_REDIRECT_URI: z.string().url().optional(),
    KEBROS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
    /** Optional eligibility filters applied to identity claims. Empty = no restriction. */
    KEBROS_ALLOWED_EMAIL_DOMAINS: csv,
    KEBROS_ALLOWED_CATEGORIES: csv,

    /** Identities granted ADMIN on sign-in: entries with "@" match the verified email, others the Kerberos user_id. */
    ADMIN_ALLOWLIST: csv,

    EMAIL_TRANSPORT: z.enum(['smtp', 'file']).default('file'),
    EMAIL_FILE_DIR: z.string().default('.mail'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** Optional PEM file of extra CA certificates for the SMTP server (IITD uses an Entrust chain). */
    SMTP_CA_FILE: z.string().optional(),
    EMAIL_FROM_NAME: z.string().default("MoveIITD Institute's Intercampus Vehicle Service"),
    EMAIL_FROM_ADDRESS: z.string().email().default('no-reply@localhost.test'),
    EMAIL_REPLY_TO: z.string().email().optional(),

    ENABLE_BACKGROUND_JOBS: bool(true),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),
    TRIP_GENERATION_HORIZON_DAYS: z.coerce.number().int().min(1).max(60).default(14),
    TRIP_GENERATION_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),

    /** Optional: absolute or relative path to the built web app (apps/web/dist) to serve from the API. */
    SERVE_WEB_DIR: z.string().optional(),

    /** Key for encrypting guest ID-proof numbers at rest (>= 32 chars). Required once guest booking ships. */
    ID_ENCRYPTION_KEY: z
      .string()
      .min(32, 'ID_ENCRYPTION_KEY must be at least 32 characters')
      .optional(),
    /** Phone numbers and ID-proof numbers are erased this many days after the trip. */
    PII_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (env.AUTH_PROVIDER === 'dev-mock') {
      if (env.NODE_ENV === 'production') {
        issue('AUTH_PROVIDER', 'The dev-mock auth provider is never allowed in production');
      } else if (!env.AUTH_DEV_MOCK_ENABLED) {
        issue(
          'AUTH_DEV_MOCK_ENABLED',
          'Set AUTH_DEV_MOCK_ENABLED=true to explicitly opt in to the dev-mock provider',
        );
      }
    }
    if (env.AUTH_PROVIDER === 'kebros') {
      if (!env.KEBROS_CLIENT_ID) issue('KEBROS_CLIENT_ID', 'Required when AUTH_PROVIDER=kebros');
      if (!env.KEBROS_CLIENT_SECRET)
        issue('KEBROS_CLIENT_SECRET', 'Required when AUTH_PROVIDER=kebros');
      if (!env.KEBROS_REDIRECT_URI)
        issue('KEBROS_REDIRECT_URI', 'Required when AUTH_PROVIDER=kebros');
      else if (
        !/\/api\/(v1\/auth|auth\/iitd)\/callback$/.test(new URL(env.KEBROS_REDIRECT_URI).pathname)
      ) {
        issue(
          'KEBROS_REDIRECT_URI',
          'Path must end in /api/auth/iitd/callback or /api/v1/auth/callback',
        );
      }
    }
    if (env.NODE_ENV === 'production') {
      if (PLACEHOLDER_RE.test(env.SESSION_SECRET))
        issue('SESSION_SECRET', 'Looks like a placeholder value');
      if (!env.WEB_ORIGIN.startsWith('https://'))
        issue('WEB_ORIGIN', 'Must use https:// in production');
      if (env.KEBROS_REDIRECT_URI && !env.KEBROS_REDIRECT_URI.startsWith('https://')) {
        issue('KEBROS_REDIRECT_URI', 'Must use https:// in production');
      }
      if (!env.ID_ENCRYPTION_KEY)
        issue('ID_ENCRYPTION_KEY', 'Required in production (encrypts guest ID numbers)');
      if (env.EMAIL_TRANSPORT !== 'smtp') issue('EMAIL_TRANSPORT', 'Must be "smtp" in production');
    }
    if (env.EMAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST)
      issue('SMTP_HOST', 'Required when EMAIL_TRANSPORT=smtp');
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {}

/**
 * Parses and validates configuration. Error messages name the offending
 * variables but never echo their values (they may be secrets).
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // Treat empty values (e.g. `SMTP_HOST=` copied from .env.example) as unset.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new EnvValidationError(
      `Invalid configuration:\n${lines.join('\n')}\nSee .env.example for documentation.`,
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function loadEnv(): Env {
  if (!cached) {
    loadDotenv();
    cached = parseEnv(process.env);
  }
  return cached;
}

/** Public URL of the web app including any sub-path, e.g. https://sac.iitd.ac.in/MoveIITD */
export function appUrl(env: Pick<Env, 'WEB_ORIGIN' | 'APP_BASE_PATH'>): string {
  return env.WEB_ORIGIN.replace(/\/+$/, '') + env.APP_BASE_PATH;
}
