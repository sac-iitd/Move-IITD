/**
 * Seeds the six recurring weekday service templates (idempotent) and generates
 * upcoming trips. Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { istDateOf } from '@iitd-bus/shared';
import { seedServiceTemplates } from '../apps/api/src/trips/templates-seed';
import { generateTrips } from '../apps/api/src/trips/generate';

const prisma = new PrismaClient();

async function main() {
  const now = new Date();
  const templates = await seedServiceTemplates(prisma, istDateOf(now));
  console.log(`Service templates: ${templates.created} created, ${templates.total} defined.`);
  const horizon = Number(process.env.TRIP_GENERATION_HORIZON_DAYS ?? 14);
  const trips = await generateTrips(prisma, { now, horizonDays: horizon });
  console.log(
    `Trips ${trips.from} → ${trips.to}: ${trips.created} created, ${trips.existing} already existed.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
