import { describe, expect, it, vi } from 'vitest';
import { openOAuthForm, submitOAuthForm } from '../src/auth/oauth-broker';

const authorize =
  'https://oauth2.iitd.ac.in/authorize.php?response_type=code&client_id=abc&state=xyz';
const referer = 'https://sac.iitd.ac.in/MoveIITD/';
const redirectUri = 'https://sac.iitd.ac.in/MoveIITD/api/auth/iitd/callback';

function jsonResponse(status: number, headers: Record<string, string>, body = '') {
  return new Response(body, { status, headers });
}

describe('Kerberos login broker', () => {
  it('loads the captcha with a referer the provider accepts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(302, {
          location: 'login.php?response_type=code&client_id=abc&state=xyz',
          'set-cookie': 'PHPSESSID=sess1; path=/',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          200,
          { 'set-cookie': 'PHPSESSID=sess2; path=/' },
          '<img class="captcha-image" src="/captcha.php?_CAPTCHA&amp;t=1">',
        ),
      );
    const form = await openOAuthForm(
      fetchMock as unknown as typeof fetch,
      authorize,
      referer,
      1000,
    );
    expect(form.phpSession).toBe('sess2');
    expect(form.captchaUrl).toBe('https://oauth2.iitd.ac.in/captcha.php?_CAPTCHA&t=1');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Referer: referer } });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Referer: referer, Cookie: 'PHPSESSID=sess1' },
    });
  });

  it('sends the password to the provider and only follows our callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(302, {
        location: `${redirectUri}?code=good&state=xyz`,
      }),
    );
    const ok = await submitOAuthForm(fetchMock as unknown as typeof fetch, {
      authorizeUrl: authorize,
      referer,
      redirectUri,
      phpSession: 'sess',
      username: 'ada',
      password: 'secret-value',
      captcha: 'AB12',
      timeoutMs: 1000,
    });
    expect(ok.redirectTo).toBe(`${redirectUri}?code=good&state=xyz`);
    const sent = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(sent.body).toContain('password=secret-value');
    expect(String(sent.headers && (sent.headers as Record<string, string>).Referer)).toBe(referer);

    fetchMock.mockResolvedValue(jsonResponse(302, { location: 'https://sac.iitd.ac.in' }));
    const bounced = await submitOAuthForm(fetchMock as unknown as typeof fetch, {
      authorizeUrl: authorize,
      referer,
      redirectUri,
      phpSession: 'sess',
      username: 'ada',
      password: 'secret-value',
      captcha: 'AB12',
      timeoutMs: 1000,
    });
    expect(bounced.redirectTo).toBeNull();

    fetchMock.mockResolvedValue(
      jsonResponse(302, { location: `${redirectUri}?error=access_denied&state=xyz` }),
    );
    const denied = await submitOAuthForm(fetchMock as unknown as typeof fetch, {
      authorizeUrl: authorize,
      referer,
      redirectUri,
      phpSession: 'sess',
      username: 'ada',
      password: 'secret-value',
      captcha: 'nope',
      timeoutMs: 1000,
    });
    expect(denied.redirectTo).toBeNull();
  });
});
