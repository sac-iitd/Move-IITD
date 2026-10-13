import { Prisma, type PrismaClient, type ServiceTemplate } from '@prisma/client';
import {
  addDays,
  computeTripWindows,
  dateRange,
  istDateOf,
  isOperationalDay,
  type CutoffRule,
} from '@iitd-bus/shared';

export interface GenerateResult {
  from: string;
  to: string;
  created: number;
  existing: number;
  completed: number;
}

export function templateRules(t: ServiceTemplate) {
  return {
    departureTime: t.departureTime,
    bookingOpenDaysBefore: t.bookingOpenDaysBefore,
    bookingOpenTime: t.bookingOpenTime,
    bookingCloseTime: t.bookingCloseTime,
    cancellationCloseTime: t.cancellationCloseTime,
    cutoffRule: t.cutoffRule as CutoffRule,
  };
}

/** Builds the snapshot stored on a generated trip. */
export function tripDataFromTemplate(t: ServiceTemplate, travelDate: string) {
  const w = computeTripWindows(travelDate, templateRules(t));
  return {
    serviceTemplateId: t.id,
    serviceLabel: t.serviceLabel,
    travelDate,
    origin: t.origin,
    destination: t.destination,
    departureTime: t.departureTime,
    departureAt: w.departureAt,
    capacity: t.capacity,
    timeProvisional: t.timeProvisional,
    bookingOpensAt: w.bookingOpensAt,
    bookingClosesAt: w.bookingClosesAt,
    cancellationClosesAt: w.cancellationClosesAt,
  };
}

/**
 * Idempotently materialises trips for active templates on Monday–Friday dates in
 * [today, today + horizonDays] (IST). Existing trips are never modified, so
 * template edits only affect trips generated afterwards. Also marks departed
 * trips COMPLETED. Safe to run concurrently: the (template, date) unique
 * constraint rejects duplicates.
 */
export async function generateTrips(
  prisma: PrismaClient,
  opts: { now: Date; horizonDays: number },
): Promise<GenerateResult> {
  const from = istDateOf(opts.now);
  const to = addDays(from, opts.horizonDays);
  const templates = await prisma.serviceTemplate.findMany({ where: { active: true } });

  const existingRows = await prisma.trip.findMany({
    where: { travelDate: { gte: from, lte: to }, serviceTemplateId: { not: null } },
    select: { serviceTemplateId: true, travelDate: true },
  });
  const existing = new Set(existingRows.map((r) => `${r.serviceTemplateId}|${r.travelDate}`));
  const closures = await prisma.serviceClosure.findMany({
    where: { date: { gte: from, lte: to } },
    select: { date: true },
  });
  const closed = new Set(closures.map((c) => c.date));

  let created = 0;
  let skipped = 0;
  for (const date of dateRange(from, to)) {
    if (!isOperationalDay(date) || closed.has(date)) continue; // weekends and holiday closures
    for (const t of templates) {
      if (date < t.effectiveFrom || (t.effectiveUntil && date > t.effectiveUntil)) continue;
      if (existing.has(`${t.id}|${date}`)) {
        skipped++;
        continue;
      }
      const data = tripDataFromTemplate(t, date);
      if (data.departureAt <= opts.now) continue; // never create trips that already left
      try {
        await prisma.trip.create({ data });
        created++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped++; // created concurrently by another worker
        } else {
          throw err;
        }
      }
    }
  }

  const completed = await prisma.trip.updateMany({
    where: { status: 'SCHEDULED', departureAt: { lte: opts.now } },
    data: { status: 'COMPLETED' },
  });

  return { from, to, created, existing: skipped, completed: completed.count };
}
