import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import type { ApiErrorBody } from '@iitd-bus/shared';
import type { AppContext } from '../context';

function limiter(
  ctx: AppContext,
  opts: { windowMs: number; limit: number; key?: (req: Request) => string },
): RequestHandler {
  if (!ctx.env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: opts.key ?? ((req) => ipKeyGenerator(req.ip ?? 'unknown')),
    handler: (_req, res) => {
      const body: ApiErrorBody = {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' },
      };
      res.status(429).json(body);
    },
  });
}

/** Sign-in initiation and callback: per IP. */
export const authRateLimit = (ctx: AppContext) =>
  limiter(ctx, { windowMs: 15 * 60_000, limit: 40 });

/** Booking and cancellation: per signed-in user (falls back to IP). */
export const bookingRateLimit = (ctx: AppContext) =>
  limiter(ctx, {
    windowMs: 60_000,
    limit: 20,
    key: (req) => req.auth?.user.id ?? ipKeyGenerator(req.ip ?? 'unknown'),
  });

/** General API ceiling per IP. */
export const apiRateLimit = (ctx: AppContext) => limiter(ctx, { windowMs: 60_000, limit: 300 });
