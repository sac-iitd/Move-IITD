import { describe, expect, it } from 'vitest';
import { EnvValidationError, appUrl, parseEnv } from '../src/config/env';

const SECRET = 'x'.repeat(48);
const base = { DATABASE_URL: 'file:./test.db', SESSION_SECRET: SECRET };
const kebros = {
  AUTH_PROVIDER: 'kebros',
  KEBROS_CLIENT_ID: 'client',
  KEBROS_CLIENT_SECRET: 'secret-value',
  KEBROS_REDIRECT_URI: 'https://bus.iitd.ac.in/api/v1/auth/callback',
};
const prod = {
  ...base,
  ...kebros,
  NODE_ENV: 'production',
  WEB_ORIGIN: 'https://bus.iitd.ac.in',
  EMAIL_TRANSPORT: 'smtp',
  SMTP_HOST: 'smtp.iitd.ac.in',
  ID_ENCRYPTION_KEY: 'k'.repeat(40),
};

describe('environment validation', () => {
  it('accepts a complete production configuration', () => {
    const env = parseEnv(prod);
    expect(env.AUTH_PROVIDER).toBe('kebros');
    expect(env.KEBROS_TOKEN_URL).toBe('https://oauth2.iitd.ac.in/token.php');
  });

  it('fails production startup when KEBROS configuration is missing', () => {
    const { KEBROS_CLIENT_ID: _a, KEBROS_CLIENT_SECRET: _b, ...rest } = prod;
    expect(() => parseEnv(rest)).toThrow(/KEBROS_CLIENT_ID[\s\S]*KEBROS_CLIENT_SECRET/);
  });

  it('never permits the dev-mock provider in production, even with the opt-in flag', () => {
    expect(() =>
      parseEnv({ ...prod, AUTH_PROVIDER: 'dev-mock', AUTH_DEV_MOCK_ENABLED: 'true' }),
    ).toThrow(/never allowed in production/);
  });

  it('requires the explicit opt-in flag for dev-mock in development', () => {
    expect(() => parseEnv({ ...base, AUTH_PROVIDER: 'dev-mock' })).toThrow(/AUTH_DEV_MOCK_ENABLED/);
    expect(
      parseEnv({ ...base, AUTH_PROVIDER: 'dev-mock', AUTH_DEV_MOCK_ENABLED: 'true' }).AUTH_PROVIDER,
    ).toBe('dev-mock');
  });

  it('rejects short or placeholder session secrets', () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() =>
      parseEnv({ ...prod, SESSION_SECRET: 'replace-me-with-a-long-random-secret-at-least-32' }),
    ).toThrow(/placeholder/);
  });

  it('requires https and SMTP in production', () => {
    expect(() => parseEnv({ ...prod, WEB_ORIGIN: 'http://bus.iitd.ac.in' })).toThrow(/WEB_ORIGIN/);
    expect(() => parseEnv({ ...prod, EMAIL_TRANSPORT: 'file' })).toThrow(/EMAIL_TRANSPORT/);
  });

  it('requires the redirect URI to target the callback route', () => {
    expect(() =>
      parseEnv({ ...prod, KEBROS_REDIRECT_URI: 'https://bus.iitd.ac.in/oauth' }),
    ).toThrow(/auth\/callback/);
  });

  it('reports variable names but never secret values', () => {
    try {
      parseEnv({
        ...prod,
        KEBROS_CLIENT_SECRET: undefined,
        SESSION_SECRET: 'super-secret-but-short',
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).not.toContain('super-secret-but-short');
    }
  });

  it('treats empty values copied from .env.example as unset', () => {
    const env = parseEnv({ ...prod, EMAIL_REPLY_TO: '', KEBROS_ALLOWED_CATEGORIES: '' });
    expect(env.EMAIL_REPLY_TO).toBeUndefined();
    expect(() => parseEnv({ ...prod, KEBROS_CLIENT_SECRET: '' })).toThrow(/KEBROS_CLIENT_SECRET/);
  });

  it('accepts the registered MoveIITD production configuration', () => {
    const env = parseEnv({
      ...prod,
      WEB_ORIGIN: 'https://sac.iitd.ac.in',
      APP_BASE_PATH: '/MoveIITD',
      KEBROS_REDIRECT_URI: 'https://sac.iitd.ac.in/MoveIITD/api/auth/iitd/callback',
      SMTP_HOST: 'smtp.iitd.ac.in',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
    });
    expect(env.KEBROS_AUTHORIZE_URL).toBe('https://oauth2.iitd.ac.in/authorize.php');
    expect(appUrl(env)).toBe('https://sac.iitd.ac.in/MoveIITD');
    expect(() => parseEnv({ ...prod, APP_BASE_PATH: 'MoveIITD/' })).toThrow(/APP_BASE_PATH/);
  });

  it('parses comma-separated allowlists', () => {
    const env = parseEnv({ ...prod, ADMIN_ALLOWLIST: ' abc123 , def456,,' });
    expect(env.ADMIN_ALLOWLIST).toEqual(['abc123', 'def456']);
  });
});
