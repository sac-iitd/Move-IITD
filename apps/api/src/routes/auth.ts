import { istDateOf } from '@iitd-bus/shared';
import { activeBlockOn } from '../blocks/query';
import { appUrl } from '../config/env';
import { Router } from 'express';
import type { MeResponse } from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { DevMockAuthProvider, devMockAuthorizePage } from '../auth/dev-mock';
import { requireAuth } from '../auth/middleware';
import { AuthProviderError } from '../auth/provider';
import {
  baseCookieOptions,
  clearSessionCookie,
  createSession,
  decodeOAuthState,
  encodeOAuthState,
  hashToken,
  oauthCookieName,
  randomToken,
  safeEqual,
  sanitizeReturnTo,
  sessionCookieName,
  setSessionCookie,
} from '../auth/session';
import { checkEligibility, upsertUserFromIdentity } from '../auth/users';
import { audit } from '../lib/audit';
import { authRateLimit } from '../lib/rate-limit';

const STATE_TTL_MS = 10 * 60_000;
const CALLBACK_PATH = '/api/v1/auth/callback';

export function authRouter(ctx: AppContext) {
  const r = Router();
  const { env } = ctx;
  const loginErrorUrl = (code: string) => `${appUrl(env)}/login?error=${encodeURIComponent(code)}`;

  /** Begins sign-in: issues a signed state cookie and redirects to the identity provider. */
  r.get('/login', authRateLimit(ctx), (req, res) => {
    const state = randomToken(32);
    const returnTo = sanitizeReturnTo(req.query.returnTo);
    const value = encodeOAuthState(env, {
      state,
      returnTo,
      exp: ctx.now().getTime() + STATE_TTL_MS,
    });
    res.cookie(oauthCookieName(env), value, { ...baseCookieOptions(env), maxAge: STATE_TTL_MS });
    // IITD rejects authorize.php unless the browser's Referer starts with the
    // registered Server URI (https://sac.iitd.ac.in). The API's default
    // Referrer-Policy is no-referrer, which strips it on this redirect and
    // sends the user back to the SAC homepage instead of the Kerberos login.
    res.set('Referrer-Policy', 'origin');
    res.redirect(302, ctx.authProvider.authorizationUrl(state));
  });

  /** Provider redirect target (the registered Redirect URI). */
  r.get('/callback', authRateLimit(ctx), async (req, res) => {
    const now = ctx.now();
    const stored = decodeOAuthState(env, req.cookies?.[oauthCookieName(env)], now);
    res.clearCookie(oauthCookieName(env), baseCookieOptions(env));

    const { code, state, error } = req.query;
    if (typeof error === 'string') {
      req.log.info({ providerError: error.slice(0, 60) }, 'Provider returned an error');
      return res.redirect(302, loginErrorUrl('provider_denied'));
    }
    if (!stored) return res.redirect(302, loginErrorUrl('state_expired'));
    if (typeof state !== 'string' || !safeEqual(state, stored.state)) {
      req.log.warn('OAuth state mismatch');
      return res.redirect(302, loginErrorUrl('state_mismatch'));
    }
    if (typeof code !== 'string' || code.length === 0 || code.length > 2048) {
      return res.redirect(302, loginErrorUrl('missing_code'));
    }

    let identity;
    try {
      identity = await ctx.authProvider.exchangeCode(code);
    } catch (err) {
      if (err instanceof AuthProviderError) {
        req.log.warn({ reason: err.reason, detail: err.message }, 'Sign-in failed at provider');
        return res.redirect(
          302,
          loginErrorUrl(
            err.reason === 'PROVIDER_UNREACHABLE' ? 'provider_unavailable' : 'provider_error',
          ),
        );
      }
      throw err;
    }

    const eligibility = checkEligibility(env, identity);
    if (!eligibility.ok) {
      req.log.info({ reason: eligibility.reason }, 'Ineligible sign-in rejected');
      return res.redirect(302, loginErrorUrl('not_eligible'));
    }

    const user = await upsertUserFromIdentity(ctx.prisma, env, ctx.authProvider.key, identity, now);

    // Prevent session fixation: discard any session presented with this request.
    const previous = req.cookies?.[sessionCookieName(env)];
    if (typeof previous === 'string') {
      await ctx.prisma.session.deleteMany({ where: { id: hashToken(previous) } });
    }
    const { token, session } = await createSession(ctx.prisma, env, user.id, now);
    setSessionCookie(res, env, token, session.expiresAt);
    if (user.role === 'ADMIN') {
      await audit(ctx.prisma, {
        actorUserId: user.id,
        action: 'ADMIN_SIGN_IN',
        targetType: 'User',
        targetId: user.id,
      });
    }
    req.log.info({ userId: user.id, provider: ctx.authProvider.key }, 'User signed in');
    res.redirect(302, `${appUrl(env)}${stored.returnTo}`);
  });

  r.post('/logout', async (req, res) => {
    if (req.auth) {
      await ctx.prisma.session.deleteMany({ where: { id: req.auth.session.id } });
    }
    clearSessionCookie(res, env);
    // 200, not 204: some proxies drop Set-Cookie on an empty 204, so the browser stays signed in.
    res.status(200).json({ ok: true });
  });

  r.get('/me', requireAuth, async (req, res) => {
    const { user, session } = req.auth!;
    const [last, block] = await Promise.all([
      ctx.prisma.booking.findFirst({
        where: { userId: user.id, phone: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { phone: true },
      }),
      activeBlockOn(ctx.prisma, user.id, [istDateOf(ctx.now())]),
    ]);
    const body: MeResponse = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role as MeResponse['user']['role'],
        category: user.category,
      },
      csrfToken: session.csrfToken,
      lastPhone: last?.phone ?? null,
      block: block ? { until: block.endsOn, reason: block.reason } : null,
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  // Development-only identity picker. Mounted only when the dev-mock provider is active,
  // which env validation forbids in production.
  if (ctx.authProvider instanceof DevMockAuthProvider) {
    r.get('/dev-mock/authorize', (req, res) => {
      const state = typeof req.query.state === 'string' ? req.query.state : '';
      res
        .set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .type('html')
        .send(devMockAuthorizePage(state, CALLBACK_PATH));
    });
  }

  return r;
}
