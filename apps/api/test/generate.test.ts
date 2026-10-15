import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc, weekdayOf } from '@iitd-bus/shared';
import { generateTrips } from '../src/trips/generate';
import { SERVICE_TEMPLATE_SEED, seedServiceTemplates } from '../src/trips/templates-seed';
import { toMysqlSchema } from '../../../scripts/build-mysql-schema';
import { resetDb, testPrisma } from './helpers';

const db = testPrisma();
// Wednesday 2026-10-14, 09:00 IST
const NOW = istToUtc('2026-10-14', '09:00');

beforeEach(async () => {
  await resetDb();
  await seedServiceTemplates(db, '2026-01-01');
});
afterAll(() => db.$disconnect());

describe('service templates', () => {
  it('seeds exactly six recurring weekday departures', async () => {
    const templates = await db.serviceTemplate.findMany({ orderBy: { code: 'asc' } });
    expect(templates).toHaveLength(6);
    expect(
      templates.map(
        (t) => `${t.serviceLabel} ${t.departureTime} ${t.origin}>${t.destination} ${t.capacity}`,
      ),
    ).toEqual([
      'BUS 07:30 DELHI>SONIPAT 24',
      'BUS 17:30 SONIPAT>DELHI 24',
      'VAN 07:30 SONIPAT>DELHI 13',
      'VAN 10:00 DELHI>SONIPAT 13',
      'VAN 13:30 SONIPAT>DELHI 13',
      'VAN 17:00 DELHI>SONIPAT 13',
    ]);
  });

  it('seeds the confirmed 1:30 PM time and the Friday-4-PM Monday cutoff', async () => {
    expect(await db.serviceTemplate.count({ where: { timeProvisional: true } })).toBe(0);
    const all = await db.serviceTemplate.findMany();
    expect(all.every((t) => t.cutoffRule === 'PREVIOUS_OPERATIONAL_DAY')).toBe(true);
  });

  it('re-seeding is idempotent and does not overwrite admin edits', async () => {
    await db.serviceTemplate.update({
      where: { code: 'BUS1-0730-DEL-SNP' },
      data: { capacity: 30 },
    });
    const r = await seedServiceTemplates(db, '2026-01-01');
    expect(r.created).toBe(0);
    expect(
      (await db.serviceTemplate.findUnique({ where: { code: 'BUS1-0730-DEL-SNP' } }))!.capacity,
    ).toBe(30);
    expect(SERVICE_TEMPLATE_SEED).toHaveLength(6);
  });
});

describe('trip generation', () => {
  it('creates trips only on weekdays within the horizon', async () => {
    const r = await generateTrips(db, { now: NOW, horizonDays: 13 });
    expect(r.from).toBe('2026-10-14');
    expect(r.to).toBe('2026-10-27');
    const trips = await db.trip.findMany();
    // Weekdays 14–27 Oct = 10 days × 6 departures, minus today's two 07:30 trips (already left at 09:00)
    expect(trips).toHaveLength(58);
    expect(trips.every((t) => weekdayOf(t.travelDate) >= 1 && weekdayOf(t.travelDate) <= 5)).toBe(
      true,
    );
    expect(trips.some((t) => ['2026-10-17', '2026-10-18'].includes(t.travelDate))).toBe(false);
  });

  it('skips departures that have already left today', async () => {
    await generateTrips(db, { now: NOW, horizonDays: 0 });
    const today = await db.trip.findMany({ where: { travelDate: '2026-10-14' } });
    // 07:30 departures have left at 09:00; four remain
    expect(today.map((t) => t.departureTime).sort()).toEqual(['10:00', '13:30', '17:00', '17:30']);
  });

  it('is idempotent', async () => {
    await generateTrips(db, { now: NOW, horizonDays: 13 });
    const second = await generateTrips(db, { now: NOW, horizonDays: 13 });
    expect(second.created).toBe(0);
    expect(await db.trip.count()).toBe(58);
  });

  it('is safe when two generators race', async () => {
    await Promise.all([
      generateTrips(db, { now: NOW, horizonDays: 6 }),
      generateTrips(db, { now: NOW, horizonDays: 6 }),
    ]);
    // Weekdays 14–20 Oct = 5 days; today's two 07:30 departures already left.
    expect(await db.trip.count()).toBe(5 * 6 - 2);
  });

  it('snapshots the schedule and computes windows in IST', async () => {
    await generateTrips(db, { now: NOW, horizonDays: 13 });
    const t = await db.trip.findFirstOrThrow({
      where: { travelDate: '2026-10-19', departureTime: '07:30', origin: 'DELHI' },
    });
    expect(t.capacity).toBe(24);
    expect(t.departureAt.toISOString()).toBe('2026-10-19T02:00:00.000Z');
    expect(t.bookingOpensAt.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(t.bookingClosesAt.toISOString()).toBe('2026-10-16T10:30:00.000Z'); // Friday 16:00 IST
    expect(t.cancellationClosesAt.toISOString()).toBe('2026-10-16T08:30:00.000Z'); // Friday 14:00 IST
  });

  it('template changes affect only trips generated afterwards', async () => {
    await generateTrips(db, { now: NOW, horizonDays: 6 });
    await db.serviceTemplate.update({
      where: { code: 'BUS1-0730-DEL-SNP' },
      data: { capacity: 40 },
    });
    await generateTrips(db, { now: NOW, horizonDays: 13 });
    const early = await db.trip.findFirstOrThrow({
      where: { travelDate: '2026-10-19', origin: 'DELHI', departureTime: '07:30' },
    });
    const late = await db.trip.findFirstOrThrow({
      where: { travelDate: '2026-10-26', origin: 'DELHI', departureTime: '07:30' },
    });
    expect(early.capacity).toBe(24);
    expect(late.capacity).toBe(40);
  });

  it('skips inactive templates and respects effective dates', async () => {
    await db.serviceTemplate.update({
      where: { code: 'BUS2-1000-DEL-SNP' },
      data: { active: false },
    });
    await db.serviceTemplate.update({
      where: { code: 'BUS2-1700-DEL-SNP' },
      data: { effectiveUntil: '2026-10-16' },
    });
    await generateTrips(db, { now: NOW, horizonDays: 13 });
    expect(await db.trip.count({ where: { departureTime: '10:00' } })).toBe(0);
    const late = await db.trip.findMany({ where: { departureTime: '17:00' } });
    expect(late.every((t) => t.travelDate <= '2026-10-16')).toBe(true);
  });

  it('marks departed trips completed', async () => {
    await generateTrips(db, { now: NOW, horizonDays: 2 });
    const r = await generateTrips(db, { now: istToUtc('2026-10-14', '11:00'), horizonDays: 2 });
    expect(r.completed).toBe(1); // the 10:00 departure
  });
});

describe('MySQL schema', () => {
  it('generated prisma/mysql/schema.prisma is in sync with the primary schema', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const src = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const committed = fs.readFileSync(path.join(root, 'prisma/mysql/schema.prisma'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(toMysqlSchema(src).replace(/\r\n/g, '\n'));
  });
});
