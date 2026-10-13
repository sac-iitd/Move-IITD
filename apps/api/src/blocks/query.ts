import type { Prisma, PrismaClient, UserBlock } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** The un-revoked block covering any of the given IST dates, if one exists. */
export async function activeBlockOn(
  db: Db,
  userId: string,
  dates: string[],
): Promise<UserBlock | null> {
  if (dates.length === 0) return null;
  return db.userBlock.findFirst({
    where: {
      userId,
      revokedAt: null,
      OR: dates.map((d) => ({ startsOn: { lte: d }, endsOn: { gte: d } })),
    },
    orderBy: { endsOn: 'desc' },
  });
}
