import { z } from 'zod';
import { AuthProviderError, type AuthProvider, type ProviderIdentity } from './provider';

/**
 * IIT Delhi OAuth 2 client, implemented exactly as documented at
 * https://oauth.iitd.ac.in/client_config.php :
 *
 *  1. Browser → GET {authorize}?response_type=code&client_id=…&state=…
 *     (the Redirect URI is registered with the OAuth administrator, not sent as a parameter)
 *  2. Provider → GET {Redirect URI}?code=…&state=…
 *  3. Server → POST {token} (form) client_id, client_secret, grant_type=authorization_code, code
 *     ← JSON { access_token, … }
 *  4. Server → POST {resource} (form) access_token
 *     ← JSON { user_id, mail, name, uniqueiitdid, category, department }
 *
 * The documentation does not describe PKCE, ID tokens, JWKS, issuer/audience
 * claims or token expiry, so none are assumed. Trust comes from the
 * server-to-server HTTPS exchange using the client secret plus our own
 * `state` check (done by the caller). The access token is used once and
 * discarded; it is never stored or logged.
 */

export interface KebrosConfig {
  authorizeUrl: string;
  tokenUrl: string;
  resourceUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

const optionalText = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v === null || v === undefined ? null : String(v).trim() || null));

const resourceResponseSchema = z.object({
  user_id: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
  mail: optionalText,
  name: optionalText,
  category: optionalText,
});

type FetchLike = typeof fetch;

export class KebrosAuthProvider implements AuthProvider {
  readonly key = 'kebros';

  constructor(
    private readonly config: KebrosConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL(this.config.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<ProviderIdentity> {
    const tokenJson = await this.postForm(
      this.config.tokenUrl,
      {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        grant_type: 'authorization_code',
        code,
      },
      'TOKEN_EXCHANGE_FAILED',
    );
    const token = tokenResponseSchema.safeParse(tokenJson);
    if (!token.success) {
      // Surface only the standard OAuth error code, never the raw body.
      const errCode =
        tokenJson && typeof tokenJson === 'object' && 'error' in tokenJson
          ? String(tokenJson.error)
          : 'no access_token';
      throw new AuthProviderError(
        'TOKEN_EXCHANGE_FAILED',
        `Token exchange rejected (${errCode.slice(0, 60)})`,
      );
    }

    const profileJson = await this.postForm(
      this.config.resourceUrl,
      { access_token: token.data.access_token },
      'PROFILE_FETCH_FAILED',
    );
    const profile = resourceResponseSchema.safeParse(profileJson);
    if (!profile.success || !profile.data.user_id) {
      throw new AuthProviderError('INVALID_PROFILE', 'Resource response missing user_id');
    }
    const subject = profile.data.user_id.toLowerCase();
    return {
      subject,
      name: profile.data.name ?? subject,
      email: profile.data.mail?.toLowerCase() ?? null,
      category: profile.data.category?.toLowerCase() ?? null,
    };
  }

  private async postForm(
    url: string,
    fields: Record<string, string>,
    failure: 'TOKEN_EXCHANGE_FAILED' | 'PROFILE_FETCH_FAILED',
  ): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams(fields).toString(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new AuthProviderError('PROVIDER_UNREACHABLE', `Could not reach ${new URL(url).host}`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AuthProviderError(
        failure,
        `Non-JSON response from ${new URL(url).pathname} (HTTP ${res.status})`,
      );
    }
    if (!res.ok && !(json && typeof json === 'object' && 'error' in json)) {
      throw new AuthProviderError(failure, `HTTP ${res.status} from ${new URL(url).pathname}`);
    }
    return json;
  }
}
