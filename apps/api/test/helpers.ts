import { PrismaClient } from '@prisma/client';
import { parseEnv, type Env } from '../src/config/env';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'file:./test.db?connection_limit=1';

let prisma: PrismaClient | undefined;

export function testPrisma(): PrismaClient {
  prisma ??= new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  return prisma;
}

/** Deletes all rows in dependency order. */
export async function resetDb(db = testPrisma()): Promise<void> {
  await db.notificationOutbox.deleteMany();
  await db.auditLog.deleteMany();
  await db.boardingScan.deleteMany();
  await db.conductorGrant.deleteMany();
  await db.booking.deleteMany();
  await db.session.deleteMany();
  await db.trip.deleteMany();
  await db.serviceClosure.deleteMany();
  await db.serviceTemplate.deleteMany();
  await db.user.deleteMany();
}

export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-that-is-long-enough-123456',
    AUTH_PROVIDER: 'dev-mock',
    AUTH_DEV_MOCK_ENABLED: 'true',
    ENABLE_BACKGROUND_JOBS: 'false',
    RATE_LIMIT_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    WEB_ORIGIN: 'http://localhost:5173',
    ...overrides,
  });
}
