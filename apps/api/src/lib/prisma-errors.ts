import { Prisma } from '@prisma/client';

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
  return fields.some((f) => f.includes(field));
}

/** Lock timeouts, write conflicts and deadlocks that are safe to retry from the start. */
export function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict / deadlock; P2028: transaction API error (e.g. could not start in time)
    if (err.code === 'P2034' || err.code === 'P2028') return true;
  }
  const msg = err instanceof Error ? err.message : '';
  return /database is locked|SQLITE_BUSY|Deadlock found|Lock wait timeout/i.test(msg);
}

export async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isTransientDbError(err)) throw err;
      await new Promise((r) => setTimeout(r, 20 * i + Math.random() * 30));
    }
  }
}

/** Options for interactive transactions: tolerate queueing under contention. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
