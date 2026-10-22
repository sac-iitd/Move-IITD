import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** 24 random bytes, base64url. Long enough that a QR cannot be guessed. */
export function newBoardingToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Gives a confirmed booking a boarding token if it was created before passes existed.
 * Safe to call more than once.
 */
export async function ensureBoardingToken<
  T extends { id: string; status: string; boardingToken: string | null },
>(db: Db, booking: T): Promise<T> {
  if (booking.boardingToken || booking.status !== 'CONFIRMED') return booking;
  const boardingToken = newBoardingToken();
  const claimed = await db.booking.updateMany({
    where: { id: booking.id, status: 'CONFIRMED', boardingToken: null },
    data: { boardingToken },
  });
  if (claimed.count === 1) return { ...booking, boardingToken };
  const fresh = await db.booking.findUnique({
    where: { id: booking.id },
    select: { boardingToken: true },
  });
  return { ...booking, boardingToken: fresh?.boardingToken ?? null };
}
