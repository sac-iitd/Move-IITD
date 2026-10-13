import { PrismaClient } from '@prisma/client';

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

export function isSqlite(databaseUrl: string): boolean {
  return databaseUrl.startsWith('file:');
}

/**
 * Applies connection-level settings. For SQLite we enable WAL so readers do not
 * block the single writer. Correctness of seat allocation does not depend on
 * this: it relies on an atomic conditional UPDATE (see bookings/service.ts).
 */
export async function configureDatabase(prisma: PrismaClient, databaseUrl: string): Promise<void> {
  if (isSqlite(databaseUrl)) {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
  }
}
