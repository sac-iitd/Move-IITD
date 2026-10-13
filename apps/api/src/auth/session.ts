import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';

const TOUCH_INTERVAL_MS = 5 * 60_000;

export function sessionCookieName(env: Env): string {
  // The __Host- prefix forces Secure, Path=/ and no Domain attribute in browsers.
  return env.NODE_ENV === 'production' ? '__Host-bus_sid' : 'bus_sid';
}

export function oauthCookieName(env: Env): string {
  return env.NODE_ENV === 'production' ? '__Host-bus_oauth' : 'bus_oauth';
}

export function baseCookieOptions(env: Env): CookieOptions {
  return { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Creates a server-side session; only the token hash is stored. */
export async function createSession(prisma: PrismaClient, env: Env, userId: string, now: Date) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_HOURS * 3_600_000);
  const session = await prisma.session.create({
    data: {
      id: hashToken(token),
      userId,
      csrfToken: randomToken(24),
      expiresAt,
      createdAt: now,
      lastSeenAt: now,
    },
  });
  return { token, session };
}

export function setSessionCookie(res: Response, env: Env, token: string, expiresAt: Date) {
  res.cookie(sessionCookieName(env), token, { ...baseCookieOptions(env), expires: expiresAt });
}

export function clearSessionCookie(res: Response, env: Env) {
  const name = sessionCookieName(env);
  const options = baseCookieOptions(env);
  // __Host- cookies are only replaced when Path=/ and Secure match and Domain is absent.
  // Set an expired cookie explicitly; clearCookie alone is dropped on some 204 responses.
  res.cookie(name, '', { ...options, maxAge: 0, expires: new Date(0) });
  res.clearCookie(name, options);
}

/** Resolves the session cookie (if any) to a user. Never throws for bad cookies. */
export async function resolveSession(prisma: PrismaClient, env: Env, req: Request, now: Date) {
  const token: unknown = req.cookies?.[sessionCookieName(env)];
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    return { auth: undefined, expired: false };
  }
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: true },
  });
  if (!session) return { auth: undefined, expired: true };
  if (session.expiresAt <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return { auth: undefined, expired: true };
  }
  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: now } })
      .catch(() => undefined);
  }
  const { user, ...rest } = session;
  return { auth: { user, session: rest }, expired: false };
}

// ---- Signed, short-lived OAuth state cookie ----

interface OAuthStatePayload {
  state: string;
  returnTo: string;
  exp: number;
}

function sign(env: Env, data: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(data).digest('base64url');
}

export function encodeOAuthState(env: Env, payload: OAuthStatePayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(env, data)}`;
}

export function decodeOAuthState(
  env: Env,
  value: unknown,
  now: Date,
): OAuthStatePayload | undefined {
  if (typeof value !== 'string') return undefined;
  const [data, sig] = value.split('.');
  if (!data || !sig || !safeEqual(sig, sign(env, data))) return undefined;
  try {
    const payload = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8'),
    ) as OAuthStatePayload;
    if (typeof payload.state !== 'string' || typeof payload.exp !== 'number') return undefined;
    if (payload.exp < now.getTime()) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

/** Only allow same-app relative paths as post-login destinations (prevents open redirects). */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/dashboard';
  if (!/^\/(?![/\\])[A-Za-z0-9\-._~/?=&%]*$/.test(value) || value.length > 200) return '/dashboard';
  return value;
}
