/**
 * Generates weekday trips for the rolling horizon (idempotent).
 * Usage: npm run trips:generate [-- --days 21]
 * The API also does this automatically every TRIP_GENERATION_INTERVAL_MINUTES.
 */
import { PrismaClient } from '@prisma/client';
import { generateTrips } from '../apps/api/src/trips/generate';

const prisma = new PrismaClient();

async function main() {
  const idx = process.argv.indexOf('--days');
  const days =
    idx > -1
      ? Number(process.argv[idx + 1])
      : Number(process.env.TRIP_GENERATION_HORIZON_DAYS ?? 14);
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new Error('--days must be 1–60');
  const r = await generateTrips(prisma, { now: new Date(), horizonDays: days });
  console.log(
    `Trips ${r.from} → ${r.to}: ${r.created} created, ${r.existing} existing, ${r.completed} marked completed.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
