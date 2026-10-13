import type { Env } from '../config/env';
import { DevMockAuthProvider } from './dev-mock';
import { KebrosAuthProvider } from './kebros';
import type { AuthProvider } from './provider';

export function createAuthProvider(env: Env): AuthProvider {
  if (env.AUTH_PROVIDER === 'dev-mock') {
    // Env validation already enforces this; re-check defensively.
    if (env.NODE_ENV === 'production' || !env.AUTH_DEV_MOCK_ENABLED) {
      throw new Error('dev-mock auth provider is not permitted in this environment');
    }
    return new DevMockAuthProvider(env.NODE_ENV);
  }
  return new KebrosAuthProvider({
    authorizeUrl: env.KEBROS_AUTHORIZE_URL,
    tokenUrl: env.KEBROS_TOKEN_URL,
    resourceUrl: env.KEBROS_RESOURCE_URL,
    clientId: env.KEBROS_CLIENT_ID!,
    clientSecret: env.KEBROS_CLIENT_SECRET!,
    timeoutMs: env.KEBROS_TIMEOUT_MS,
  });
}
