import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevMockAuthProvider } from '../src/auth/dev-mock';
import { KebrosAuthProvider } from '../src/auth/kebros';
import { AuthProviderError } from '../src/auth/provider';
import { hashToken, sanitizeReturnTo } from '../src/auth/session';
import { createTestApp, identity, signIn } from './app-helpers';
import { resetDb, testPrisma } from './helpers';

const db = testPrisma();
beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

function stateFrom(location: string) {
  return new URL(location, 'http://x').searchParams.get('state')!;
}

describe('IIT Delhi OAuth (KEBROS) client', () => {
  const config = {
    authorizeUrl: 'https://oauth.iitd.ac.in/authorize.php',
    tokenUrl: 'https://oauth.iitd.ac.in/token.php',
    resourceUrl: 'https://oauth.iitd.ac.in/resource.php',
    clientId: 'bus-client',
    clientSecret: 's3cret',
    timeoutMs: 5000,
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('builds the documented authorize link', () => {
    const url = new URL(new KebrosAuthProvider(config).authorizationUrl('abc123'));
    expect(url.origin + url.pathname).toBe('https://oauth.iitd.ac.in/authorize.php');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'bus-client',
      state: 'abc123',
    });
  });

  it('exchanges the code at token.php and reads the profile from resource.php', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'AT-1', expires_in: 3600, token_type: 'Bearer' }))
      .mockResolvedValueOnce(
        json({
          user_id: 'CS1200123',
          mail: 'CS1200123@iitd.ac.in',
          name: 'Asha Kumar',
          uniqueiitdid: 1234567,
          category: 'Student',
          department: 'CSE',
        }),
      );
    const provider = new KebrosAuthProvider(config, fetchMock as unknown as typeof fetch);
    const who = await provider.exchangeCode('CODE-9');

    expect(who).toEqual({
      subject: 'cs1200123',
      name: 'Asha Kumar',
      email: 'cs1200123@iitd.ac.in',
      category: 'student',
    });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://oauth.iitd.ac.in/token.php');
    expect(tokenInit.method).toBe('POST');
    expect(Object.fromEntries(new URLSearchParams(tokenInit.body))).toEqual({
      client_id: 'bus-client',
      client_secret: 's3cret',
      grant_type: 'authorization_code',
      code: 'CODE-9',
    });
    const [resUrl, resInit] = fetchMock.mock.calls[1]!;
    expect(resUrl).toBe('https://oauth.iitd.ac.in/resource.php');
    expect(Object.fromEntries(new URLSearchParams(resInit.body))).toEqual({ access_token: 'AT-1' });
  });

  it('rejects a token response without access_token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ error: 'invalid_grant', error_description: 'expired' }, 400));
    const provider = new KebrosAuthProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.exchangeCode('bad')).rejects.toMatchObject({
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a profile without user_id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: 'AT' }))
      .mockResolvedValueOnce(json({ name: 'No Id' }));
    const provider = new KebrosAuthProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.exchangeCode('c')).rejects.toMatchObject({ reason: 'INVALID_PROFILE' });
  });

  it('reports network failures as provider unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const provider = new KebrosAuthProvider(config, fetchMock as unknown as typeof fetch);
    const err = await provider.exchangeCode('c').catch((e) => e);
    expect(err).toBeInstanceOf(AuthProviderError);
    expect(err.reason).toBe('PROVIDER_UNREACHABLE');
  });

  it('reports non-JSON responses as failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>oops</html>', { status: 500 }));
    const provider = new KebrosAuthProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.exchangeCode('c')).rejects.toMatchObject({
      reason: 'TOKEN_EXCHANGE_FAILED',
    });
  });
});

describe('sign-in flow', () => {
  it('redirects to the provider with a state bound to a signed cookie', async () => {
    const t = createTestApp();
    const res = await request(t.app).get('/api/v1/auth/login');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/api\/v1\/auth\/dev-mock\/authorize\?state=/);
    const cookie = res.headers['set-cookie']![0]!;
    expect(cookie).toMatch(/^bus_oauth=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('creates a session, user record and CSRF token on a valid callback', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('cs1200001', { name: 'Ravi' }));
    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.body.user).toMatchObject({
      name: 'Ravi',
      email: 'cs1200001@iitd.ac.in',
      role: 'USER',
    });
    expect(me.body.csrfToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const user = await db.user.findFirstOrThrow({ where: { providerSubject: 'cs1200001' } });
    expect(user.authProvider).toBe('dev-mock');
    expect(user.lastLoginAt).not.toBeNull();
    const sessions = await db.session.findMany();
    expect(sessions).toHaveLength(1);
  });

  it('stores only the SHA-256 hash of the session token', async () => {
    const t = createTestApp();
    const agent = request.agent(t.app);
    const login = await agent.get('/api/v1/auth/login');
    const cb = await agent.get(
      `/api/v1/auth/callback?state=${stateFrom(login.headers.location!)}&code=${DevMockAuthProvider.encodeCode(identity('h1'))}`,
    );
    const setCookie = ([] as string[]).concat(cb.headers['set-cookie'] ?? []);
    const sid = setCookie.find((c) => c.startsWith('bus_sid='))!;
    expect(sid).toMatch(/HttpOnly/i);
    const token = decodeURIComponent(sid.split(';')[0]!.slice('bus_sid='.length));
    const [session] = await db.session.findMany();
    expect(session!.id).toBe(hashToken(token));
    expect(session!.id).not.toBe(token);
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const t = createTestApp();
    const agent = request.agent(t.app);
    await agent.get('/api/v1/auth/login');
    const res = await agent.get(
      `/api/v1/auth/callback?state=forged&code=${DevMockAuthProvider.encodeCode(identity('x1'))}`,
    );
    expect(res.headers.location).toBe('http://localhost:5173/login?error=state_mismatch');
    expect(await db.user.count()).toBe(0);
  });

  it('rejects a callback without the state cookie (e.g. CSRF login)', async () => {
    const t = createTestApp();
    const login = await request(t.app).get('/api/v1/auth/login');
    const res = await request(t.app).get(
      `/api/v1/auth/callback?state=${stateFrom(login.headers.location!)}&code=${DevMockAuthProvider.encodeCode(identity('x1'))}`,
    );
    expect(res.headers.location).toContain('error=state_expired');
  });

  it('rejects an expired state cookie', async () => {
    const t = createTestApp();
    const agent = request.agent(t.app);
    const login = await agent.get('/api/v1/auth/login');
    t.clock.now = new Date(t.clock.now.getTime() + 11 * 60_000);
    const res = await agent.get(
      `/api/v1/auth/callback?state=${stateFrom(login.headers.location!)}&code=${DevMockAuthProvider.encodeCode(identity('x1'))}`,
    );
    expect(res.headers.location).toContain('error=state_expired');
  });

  it('handles provider errors and denied consent', async () => {
    const t = createTestApp();
    const agent = request.agent(t.app);
    await agent.get('/api/v1/auth/login');
    const denied = await agent.get('/api/v1/auth/callback?error=access_denied&state=x');
    expect(denied.headers.location).toContain('error=provider_denied');

    const login = await agent.get('/api/v1/auth/login');
    const bad = await agent.get(
      `/api/v1/auth/callback?state=${stateFrom(login.headers.location!)}&code=not-valid`,
    );
    expect(bad.headers.location).toContain('error=provider_error');
  });

  it('enforces configured eligibility rules', async () => {
    const t = createTestApp({
      env: {
        KEBROS_ALLOWED_EMAIL_DOMAINS: 'iitd.ac.in',
        KEBROS_ALLOWED_CATEGORIES: 'student,staff',
      },
    });
    await expect(signIn(t, identity('ok1'))).resolves.toBeDefined();
    await expect(signIn(t, identity('ext1', { email: 'someone@gmail.com' }))).rejects.toThrow(
      /not_eligible/,
    );
    await expect(signIn(t, identity('alum1', { category: 'alumni' }))).rejects.toThrow(
      /not_eligible/,
    );
  });

  it('only allows safe relative returnTo destinations', () => {
    expect(sanitizeReturnTo('/bookings')).toBe('/bookings');
    expect(sanitizeReturnTo('/dashboard?date=2026-10-19')).toBe('/dashboard?date=2026-10-19');
    expect(sanitizeReturnTo('//evil.example')).toBe('/dashboard');
    expect(sanitizeReturnTo('/\\evil.example')).toBe('/dashboard');
    expect(sanitizeReturnTo('https://evil.example')).toBe('/dashboard');
    expect(sanitizeReturnTo(undefined)).toBe('/dashboard');
  });
});

describe('registered MoveIITD callback path', () => {
  it('accepts /api/auth/iitd/callback and redirects back under the app sub-path', async () => {
    const t = createTestApp({
      env: { WEB_ORIGIN: 'https://sac.iitd.ac.in', APP_BASE_PATH: '/MoveIITD' },
    });
    const agent = request.agent(t.app);
    const login = await agent.get('/api/v1/auth/login?returnTo=/bookings');
    const cb = await agent.get(
      `/api/auth/iitd/callback?state=${stateFrom(login.headers.location!)}&code=${DevMockAuthProvider.encodeCode(identity('m1'))}`,
    );
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('https://sac.iitd.ac.in/MoveIITD/bookings');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    // Same route when the proxy forwards the /MoveIITD prefix unchanged.
    const prefixed = await agent.get('/MoveIITD/api/v1/auth/me');
    expect(prefixed.status).toBe(200);
    const bad = await agent.get('/MoveIITD/api/auth/iitd/callback?state=x&code=y');
    expect(bad.headers.location).toBe('https://sac.iitd.ac.in/MoveIITD/login?error=state_expired');
  });
});

describe('sessions', () => {
  it('returns 401 without a session', async () => {
    const t = createTestApp();
    const res = await request(t.app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expires sessions after the TTL', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    t.clock.now = new Date(t.clock.now.getTime() + 13 * 3_600_000);
    const res = await s.agent.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logout requires the CSRF token and invalidates the session', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    const noToken = await s.agent.post('/api/v1/auth/logout');
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');

    const ok = await s.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', s.csrf);
    expect(ok.status).toBe(204);
    expect(await db.session.count()).toBe(0);
    expect((await s.agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects state-changing requests from a foreign Origin', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    const res = await s.agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', s.csrf);
    expect(res.status).toBe(403);
  });

  it('replaces any existing session on re-login (no fixation)', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    const login = await s.agent.get('/api/v1/auth/login');
    await s.agent.get(
      `/api/v1/auth/callback?state=${stateFrom(login.headers.location!)}&code=${DevMockAuthProvider.encodeCode(identity('u1'))}`,
    );
    expect(await db.session.count()).toBe(1);
  });
});

describe('admin provisioning', () => {
  it('promotes allowlisted identities on sign-in and audits the grant', async () => {
    const t = createTestApp({ env: { ADMIN_ALLOWLIST: 'boss1' } });
    const s = await signIn(t, identity('boss1'));
    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.body.user.role).toBe('ADMIN');
    const actions = (await db.auditLog.findMany()).map((a) => a.action).sort();
    expect(actions).toEqual(['ADMIN_SIGN_IN', 'ROLE_GRANTED']);
  });

  it('promotes the institute admins by verified email', async () => {
    const t = createTestApp({
      env: { ADMIN_ALLOWLIST: 'dgssac@iitd.ac.in,sec_officer@iitd.ac.in' },
    });
    for (const subject of ['dgssac', 'sec_officer']) {
      const s = await signIn(t, identity(subject, { email: `${subject}@iitd.ac.in` }));
      expect((await s.agent.get('/api/v1/auth/me')).body.user.role).toBe('ADMIN');
    }
    const other = await signIn(t, identity('cs1200001'));
    expect((await other.agent.get('/api/v1/auth/me')).body.user.role).toBe('USER');
  });

  it('does not promote other users', async () => {
    const t = createTestApp({ env: { ADMIN_ALLOWLIST: 'boss1' } });
    const s = await signIn(t, identity('student9', { name: 'boss1' }));
    expect((await s.agent.get('/api/v1/auth/me')).body.user.role).toBe('USER');
  });
});
