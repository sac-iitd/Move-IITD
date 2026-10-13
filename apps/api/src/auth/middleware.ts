import type { RequestHandler } from 'express';
import type { AppContext } from '../context';
import { HttpError } from '../lib/errors';
import { resolveSession, safeEqual } from './session';

/** Attaches req.auth when a valid session cookie is present. */
export function sessionMiddleware(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const { auth, expired } = await resolveSession(ctx.prisma, ctx.env, req, ctx.now());
    req.auth = auth;
    req.sessionExpired = expired;
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) {
    throw new HttpError(
      req.sessionExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
      req.sessionExpired
        ? 'Your session has expired. Please sign in again.'
        : 'Please sign in to continue.',
    );
  }
  next();
};

/** Role is read from the database on every request, so revocation takes effect immediately. */
export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError('UNAUTHENTICATED', 'Please sign in to continue.');
  if (req.auth.user.role !== 'ADMIN') {
    throw new HttpError('FORBIDDEN', 'Administrator access is required.');
  }
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated, state-changing requests:
 *  1. If the browser sends Origin, it must be the web app's origin.
 *  2. The per-session CSRF token (from GET /auth/me) must be echoed in X-CSRF-Token.
 * Cross-site pages cannot read the token, and SameSite=Lax blocks cross-site POST cookies.
 */
export function csrfProtection(ctx: AppContext): RequestHandler {
  const allowedOrigin = new URL(ctx.env.WEB_ORIGIN).origin;
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && origin !== allowedOrigin) {
      throw new HttpError('CSRF_INVALID', 'Request origin not allowed.');
    }
    if (!req.auth) return next(); // requireAuth will reject unauthenticated mutations
    const token = req.get('x-csrf-token');
    if (!token || !safeEqual(token, req.auth.session.csrfToken)) {
      throw new HttpError(
        'CSRF_INVALID',
        'Security token missing or invalid. Please reload the page.',
      );
    }
    next();
  };
}
