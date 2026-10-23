/**
 * IIT Delhi's authorize.php only accepts a login POST when the Referer starts
 * with the registered Server URI (https://sac.iitd.ac.in). The password form
 * lives on oauth2.iitd.ac.in, so a normal submit sends Referer: oauth2.iitd.ac.in
 * and the provider bounces the browser to the SAC homepage.
 *
 * We show that form on our own origin and forward the POST ourselves, with a
 * Referer the provider accepts. The Kerberos password is not stored or logged.
 */

export interface OAuthForm {
  phpSession: string;
  captchaUrl: string;
}

export interface OAuthSubmitResult {
  /** Absolute callback URL to send the browser to, when the provider accepted the attempt. */
  redirectTo: string | null;
}

const SESSION_COOKIE = /^PHPSESSID=([^;]+)/;

function phpSession(res: Response): string | null {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    const match = SESSION_COOKIE.exec(cookie);
    if (match?.[1]) return match[1];
  }
  return null;
}

function resolveAgainst(base: string, location: string): string {
  return new URL(location, base).toString();
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  referer: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    redirect: 'manual',
    headers: {
      Accept: 'text/html,application/json',
      Referer: referer,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * Opens a provider login session and returns the captcha that belongs to it.
 * `referer` must be the registered Server URI, including the MoveIITD path.
 */
export async function openOAuthForm(
  fetchImpl: typeof fetch,
  authorizeUrl: string,
  referer: string,
  timeoutMs: number,
): Promise<OAuthForm> {
  const started = await request(fetchImpl, authorizeUrl, referer, timeoutMs);
  const php = phpSession(started);
  if (!php) throw new Error('OAuth provider did not start a login session');
  const next = started.headers.get('location');
  if (!next) throw new Error('OAuth provider did not open the login form');
  const loginUrl = resolveAgainst(authorizeUrl, next);
  const form = await request(fetchImpl, loginUrl, referer, timeoutMs, {
    headers: { Cookie: `PHPSESSID=${php}` },
  });
  if (form.status !== 200) throw new Error('OAuth provider refused the login form');
  const phpFromForm = phpSession(form);
  const html = await form.text();
  const img = /<img[^>]*class="captcha-image"[^>]*src="([^"]+)"/i.exec(html);
  const src = img?.[1]?.replace(/&amp;/g, '&');
  if (!src) throw new Error('OAuth provider did not include a captcha');
  const captchaUrl = resolveAgainst(loginUrl, src);
  const allowed = new URL(authorizeUrl).origin;
  if (new URL(captchaUrl).origin !== allowed) throw new Error('Unexpected captcha host');
  return { phpSession: phpFromForm ?? php, captchaUrl };
}

/**
 * Forwards one sign-in attempt. Returns the provider callback when it is our
 * registered redirect URI, and null when the person should try again.
 */
export async function submitOAuthForm(
  fetchImpl: typeof fetch,
  input: {
    authorizeUrl: string;
    referer: string;
    redirectUri: string;
    phpSession: string;
    username: string;
    password: string;
    captcha: string;
    timeoutMs: number;
  },
): Promise<OAuthSubmitResult> {
  const body = new URLSearchParams({
    username: input.username,
    password: input.password,
    captcha: input.captcha,
    submit: 'Login',
  });
  const res = await request(fetchImpl, input.authorizeUrl, input.referer, input.timeoutMs, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: `PHPSESSID=${input.phpSession}`,
    },
    body: body.toString(),
  });
  const location = res.headers.get('location');
  if (!location) return { redirectTo: null };
  const absolute = resolveAgainst(input.authorizeUrl, location);
  if (!absolute.startsWith(input.redirectUri)) return { redirectTo: null };
  // A rejected password or captcha comes back as an error on our callback.
  // Ask the person to try again instead of treating it as a cancelled login.
  if (new URL(absolute).searchParams.has('error')) return { redirectTo: null };
  return { redirectTo: absolute };
}

export function oauthLoginPage(opts: {
  failed: boolean;
  formAction: string;
  captchaSrc: string;
}): string {
  const error = opts.failed
    ? '<p class="error">Kerberos did not accept that sign-in. Check your password and the captcha, then try again.</p>'
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in · MoveIITD</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fbf6ee;font-family:Segoe UI,Roboto,Arial,sans-serif;color:#2a1714}
  form{width:min(22rem,calc(100% - 2rem));background:#fff;border:1px solid #e7cc97;border-radius:12px;padding:1.25rem}
  h1{font-size:1.25rem;margin:0 0 .25rem}
  p{margin:.25rem 0 1rem;color:#6e4a16;font-size:.9rem}
  label{display:block;font-size:.85rem;font-weight:600;margin:.75rem 0 .25rem}
  input{width:100%;box-sizing:border-box;min-height:2.75rem;padding:.4rem .6rem;border:1px solid #c4a574;border-radius:8px;font-size:1rem}
  img{display:block;margin-top:.75rem;border-radius:8px}
  button{margin-top:1rem;width:100%;min-height:2.75rem;border:0;border-radius:8px;background:#2a1714;color:#f3e6cc;font-weight:700;font-size:1rem}
  .error{background:#fde8e8;color:#7f1d1d;padding:.6rem .7rem;border-radius:8px}
</style></head><body>
<form method="post" action="${opts.formAction}" autocomplete="on">
  <h1>Sign in</h1>
  <p>Use your IIT Delhi Kerberos account.</p>
  ${error}
  <label for="username">Kerberos id</label>
  <input id="username" name="username" autocomplete="username" required maxlength="64">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">
  <img src="${opts.captchaSrc}" alt="Captcha" width="180" height="60">
  <label for="captcha">Captcha</label>
  <input id="captcha" name="captcha" autocomplete="off" required maxlength="16">
  <button type="submit">Sign in</button>
</form></body></html>`;
}
