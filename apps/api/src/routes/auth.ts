import { istDateOf } from '@iitd-bus/shared';
import { activeBlockOn } from '../blocks/query';
import { appUrl } from '../config/env';
import express, { Router } from 'express';
import type { MeResponse } from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { DevMockAuthProvider, devMockAuthorizePage } from '../auth/dev-mock';
import { KebrosAuthProvider } from '../auth/kebros';
import { oauthLoginPage, openOAuthForm, submitOAuthForm } from '../auth/oauth-broker';
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

  const setOAuthCookie = (
    res: express.Response,
    payload: { state: string; returnTo: string; oauthSession?: string; captchaUrl?: string },
  ) => {
    res.cookie(
      oauthCookieName(env),
      encodeOAuthState(env, { ...payload, exp: ctx.now().getTime() + STATE_TTL_MS }),
      { ...baseCookieOptions(env), maxAge: STATE_TTL_MS },
    );
  };

  /**
   * Begins sign-in. The dev provider redirects to its own page. Kerberos is shown
   * here: IIT Delhi rejects the password form unless the POST Referer is the SAC
   * site, and their form lives on oauth2.iitd.ac.in.
   */
  r.get('/login', authRateLimit(ctx), async (req, res) => {
    const state = randomToken(32);
    const returnTo = sanitizeReturnTo(req.query.returnTo);
    if (!(ctx.authProvider instanceof KebrosAuthProvider) || !env.KEBROS_REDIRECT_URI) {
      setOAuthCookie(res, { state, returnTo });
      res.set('Referrer-Policy', 'origin');
      res.redirect(302, ctx.authProvider.authorizationUrl(state));
      return;
    }
    try {
      const form = await openOAuthForm(
        fetch,
        ctx.authProvider.authorizationUrl(state),
        `${appUrl(env)}/`,
        env.KEBROS_TIMEOUT_MS,
      );
      setOAuthCookie(res, {
        state,
        returnTo,
        oauthSession: form.phpSession,
        captchaUrl: form.captchaUrl,
      });
      res
        .set(
          'Content-Security-Policy',
          "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        )
        .set('Referrer-Policy', 'origin')
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(
          oauthLoginPage({
            failed: req.query.again === '1',
            formAction: 'oauth-submit',
            captchaSrc: 'oauth-captcha',
          }),
        );
    } catch (err) {
      req.log.warn(
        { detail: err instanceof Error ? err.message : 'unavailable' },
        'Could not open Kerberos sign-in',
      );
      res.redirect(302, loginErrorUrl('provider_unavailable'));
    }
  });

  r.get('/oauth-captcha', authRateLimit(ctx), async (req, res) => {
    const stored = decodeOAuthState(env, req.cookies?.[oauthCookieName(env)], ctx.now());
    if (!stored?.oauthSession || !stored.captchaUrl) {
      res.status(400).type('text').send('Sign-in expired. Go back and try again.');
      return;
    }
    const image = await fetch(stored.captchaUrl, {
      headers: { Cookie: `PHPSESSID=${stored.oauthSession}`, Accept: 'image/*' },
      signal: AbortSignal.timeout(env.KEBROS_TIMEOUT_MS),
    });
    if (!image.ok) {
      res.status(502).type('text').send('Captcha could not be loaded.');
      return;
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .type(image.headers.get('content-type') ?? 'image/png')
      .send(bytes);
  });

  r.post(
    '/oauth-submit',
    authRateLimit(ctx),
    express.urlencoded({ extended: false, limit: '1kb' }),
    async (req, res) => {
      const stored = decodeOAuthState(env, req.cookies?.[oauthCookieName(env)], ctx.now());
      const retry = () => {
        const back = stored?.returnTo ?? '/dashboard';
        res.redirect(302, `login?returnTo=${encodeURIComponent(back)}&again=1`);
      };
      if (
        !(ctx.authProvider instanceof KebrosAuthProvider) ||
        !env.KEBROS_REDIRECT_URI ||
        !stored?.oauthSession
      ) {
        retry();
        return;
      }
      const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const captcha = typeof req.body?.captcha === 'string' ? req.body.captcha.trim() : '';
      if (!username || !password || !captcha) {
        retry();
        return;
      }
      try {
        const result = await submitOAuthForm(fetch, {
          authorizeUrl: ctx.authProvider.authorizationUrl(stored.state),
          referer: `${appUrl(env)}/`,
          redirectUri: env.KEBROS_REDIRECT_URI,
          phpSession: stored.oauthSession,
          username,
          password,
          captcha,
          timeoutMs: env.KEBROS_TIMEOUT_MS,
        });
        if (!result.redirectTo) {
          retry();
          return;
        }
        res.redirect(302, result.redirectTo);
      } catch (err) {
        req.log.warn(
          { detail: err instanceof Error ? err.message : 'unavailable' },
          'Kerberos sign-in could not be forwarded',
        );
        retry();
      }
    },
  );

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
