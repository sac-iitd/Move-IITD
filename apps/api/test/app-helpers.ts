import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { createApp } from '../src/app';
import { DevMockAuthProvider } from '../src/auth/dev-mock';
import type { AuthProvider, ProviderIdentity } from '../src/auth/provider';
import type { AppContext } from '../src/context';
import { MemoryMailer } from '../src/email/mailer';
import { createLogger } from '../src/lib/logger';
import { testEnv, testPrisma } from './helpers';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  ctx: AppContext;
  mailer: MemoryMailer;
  clock: { now: Date };
}

export function createTestApp(
  opts: { env?: Record<string, string>; now?: Date; authProvider?: AuthProvider } = {},
): TestApp {
  const env = testEnv(opts.env);
  const mailer = new MemoryMailer();
  const clock = { now: opts.now ?? new Date() };
  const ctx: AppContext = {
    env,
    prisma: testPrisma(),
    logger: createLogger('silent'),
    authProvider: opts.authProvider ?? new DevMockAuthProvider('test'),
    mailer,
    now: () => clock.now,
  };
  return { app: createApp(ctx), ctx, mailer, clock };
}

export function identity(subject: string, extra: Partial<ProviderIdentity> = {}): ProviderIdentity {
  return {
    subject,
    name: `User ${subject}`,
    email: `${subject}@iitd.ac.in`,
    category: 'student',
    ...extra,
  };
}

export interface SignedInAgent {
  agent: TestAgent;
  csrf: string;
  userId: string;
}

/** Runs the full login → callback → /me flow with the dev-mock provider. */
export async function signIn(t: TestApp, who: ProviderIdentity): Promise<SignedInAgent> {
  const agent = request.agent(t.app);
  const login = await agent.get('/api/v1/auth/login');
  const state = new URL(login.headers.location!, 'http://x').searchParams.get('state')!;
  const cb = await agent.get(
    `/api/v1/auth/callback?state=${encodeURIComponent(state)}&code=${DevMockAuthProvider.encodeCode(who)}`,
  );
  if (cb.status !== 302 || cb.headers.location?.includes('error')) {
    throw new Error(`Sign-in failed: ${cb.status} ${cb.headers.location}`);
  }
  const me = await agent.get('/api/v1/auth/me');
  if (me.status !== 200) throw new Error(`/me failed: ${me.status}`);
  return { agent, csrf: me.body.csrfToken, userId: me.body.user.id };
}

/** A valid booking for the signed-in user. */
export const SELF_BOOKING = {
  passengerType: 'SELF',
  phone: '9876543210',
  purpose: 'ACADEMIC',
} as const;

/** A valid guest booking (Aadhaar). */
export function guestBooking(overrides: Record<string, unknown> = {}) {
  return {
    passengerType: 'GUEST',
    phone: '9876543210',
    purpose: 'ADMINISTRATIVE',
    guest: {
      name: 'Guest Person',
      email: 'guest@example.com',
      idType: 'AADHAAR',
      idNumber: '2345 6789 0123',
    },
    ...overrides,
  };
}
