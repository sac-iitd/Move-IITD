/**
 * Isolated identity-provider boundary. The production implementation is the
 * IIT Delhi OAuth 2 server ("KEBROS" / Kerberos login, see kebros.ts). A
 * development-only mock exists for local work without institute credentials.
 */

export interface ProviderIdentity {
  /** Stable external identifier. For IIT Delhi OAuth this is `user_id` (Kerberos ID), lower-cased. */
  subject: string;
  name: string;
  email: string | null;
  category: string | null;
}

export interface AuthProvider {
  /** Value stored in User.authProvider. */
  readonly key: string;
  /** Where to send the browser to begin sign-in. */
  authorizationUrl(state: string): string;
  /** Server-side exchange of the authorization code for a verified identity. */
  exchangeCode(code: string): Promise<ProviderIdentity>;
}

export type AuthProviderFailure =
  'TOKEN_EXCHANGE_FAILED' | 'PROFILE_FETCH_FAILED' | 'INVALID_PROFILE' | 'PROVIDER_UNREACHABLE';

export class AuthProviderError extends Error {
  constructor(
    readonly reason: AuthProviderFailure,
    message: string,
  ) {
    super(message);
  }
}
