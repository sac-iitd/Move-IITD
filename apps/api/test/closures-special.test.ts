import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc } from '@iitd-bus/shared';
import { generateTrips } from '../src/trips/generate';
import { seedServiceTemplates } from '../src/trips/templates-seed';
import {
  SELF_BOOKING,
  createTestApp,
  identity,
  signIn,
  type SignedInAgent,
  type TestApp,
} from './app-helpers';
import { resetDb, testPrisma } from './helpers';

const db = testPrisma();
// Wednesday 2026-10-14 09:00 IST
const NOW = istToUtc('2026-10-14', '09:00');
const HOLIDAY = '2026-10-20'; // a Tuesday
let t: TestApp;
let admin: SignedInAgent;

const post = (a: SignedInAgent, url: string, body: object = {}) =>
  a.agent.post(url).set('X-CSRF-Token', a.csrf).send(body);

async function bookAs(subject: string, tripId: string) {
  const s = await signIn(t, identity(subject));
  const res = await post(s, `/api/v1/trips/${tripId}/bookings`, SELF_BOOKING);
  return { s, res };
}

beforeEach(async () => {
  await resetDb();
  await seedServiceTemplates(db, '2026-01-01');
  await generateTrips(db, { now: NOW, horizonDays: 13 });
  t = createTestApp({
    now: NOW,
    env: { ADMIN_ALLOWLIST: 'dgssac@iitd.ac.in', SESSION_TTL_HOURS: '720' },
  });
  admin = await signIn(t, identity('dgssac', { email: 'dgssac@iitd.ac.in' }));
});
afterAll(() => db.$disconnect());

describe('holiday closures', () => {
  it('stops all regular buses on the date, notifies passengers and blocks booking', async () => {
    const trip = await db.trip.findFirstOrThrow({
      where: { travelDate: HOLIDAY, departureTime: '10:00' },
    });
    await bookAs('p1', trip.id);
    await bookAs('p2', trip.id);

    const res = await post(admin, '/api/v1/admin/closures', {
      date: HOLIDAY,
      reason: 'Dussehra holiday',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ cancelledTrips: 6, affectedBookings: 2 });

    const day = await db.trip.findMany({ where: { travelDate: HOLIDAY } });
    expect(day.every((x) => x.status === 'CANCELLED')).toBe(true);
    expect(day[0]!.cancellationReason).toBe('No service: Dussehra holiday');
    expect(await db.notificationOutbox.count({ where: { type: 'TRIP_CANCELLATION' } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: 'SERVICE_CLOSURE_CREATED' } })).toBe(1);

    const { res: late } = await bookAs('p3', trip.id);
    expect(late.body.error.code).toBe('TRIP_CANCELLED');
  });

  it('prevents trips being generated for a closed date', async () => {
    const future = '2026-10-30'; // Friday, beyond the current horizon
    await post(admin, '/api/v1/admin/closures', { date: future, reason: 'Founders day' });
    await generateTrips(db, { now: NOW, horizonDays: 20 });
    expect(await db.trip.count({ where: { travelDate: future } })).toBe(0);
    expect(await db.trip.count({ where: { travelDate: '2026-10-29' } })).toBe(6);
  });

  it('rejects duplicate and past closures', async () => {
    expect(
      (await post(admin, '/api/v1/admin/closures', { date: HOLIDAY, reason: 'Holiday' })).status,
    ).toBe(201);
    expect(
      (await post(admin, '/api/v1/admin/closures', { date: HOLIDAY, reason: 'Again' })).status,
    ).toBe(409);
    expect(
      (await post(admin, '/api/v1/admin/closures', { date: '2026-10-01', reason: 'Past' })).status,
    ).toBe(400);
    expect((await post(admin, '/api/v1/admin/closures', { date: HOLIDAY })).status).toBe(400);
  });

  it('removing a closure restores generation for trips that were never created', async () => {
    const future = '2026-10-30';
    const created = await post(admin, '/api/v1/admin/closures', {
      date: future,
      reason: 'Founders day',
    });
    t.clock.now = istToUtc('2026-10-20', '09:00'); // horizon now covers the 30th
    const del = await admin.agent
      .delete(`/api/v1/admin/closures/${created.body.closure.id}`)
      .set('X-CSRF-Token', admin.csrf);
    expect(del.status).toBe(200);
    expect(del.body.stillCancelled).toBe(0);
    expect(await db.trip.count({ where: { travelDate: future, status: 'SCHEDULED' } })).toBe(6);
    expect(await db.auditLog.count({ where: { action: 'SERVICE_CLOSURE_REMOVED' } })).toBe(1);
  });

  it('lists closures for admins only', async () => {
    await post(admin, '/api/v1/admin/closures', { date: HOLIDAY, reason: 'Holiday' });
    const list = await admin.agent.get('/api/v1/admin/closures');
    expect(list.body.closures).toHaveLength(1);
    const user = await signIn(t, identity('student1'));
    expect((await user.agent.get('/api/v1/admin/closures')).status).toBe(403);
    expect(
      (await post(user, '/api/v1/admin/closures', { date: HOLIDAY, reason: 'x y z' })).status,
    ).toBe(403);
  });
});

describe('special buses', () => {
  const special = {
    travelDate: '2026-10-17', // Saturday
    departureTime: '09:00',
    direction: 'DELHI_TO_SONIPAT',
    capacity: 40,
    serviceLabel: 'Convocation special',
  };

  it('lets admins add a weekend trip that users can see and book', async () => {
    const res = await post(admin, '/api/v1/admin/trips/special', special);
    expect(res.status).toBe(201);
    expect(res.body.trip).toMatchObject({
      isSpecial: true,
      capacity: 40,
      availability: 'OPEN',
      bookingClosesAt: '2026-10-16T10:30:00.000Z', // Friday 16:00 IST, the day before
    });
    expect(await db.auditLog.count({ where: { action: 'SPECIAL_TRIP_CREATED' } })).toBe(1);

    const s = await signIn(t, identity('u1'));
    const list = await s.agent.get('/api/v1/trips?from=2026-10-17&to=2026-10-17');
    expect(list.body.trips).toHaveLength(1);
    expect(list.body.trips[0]).toMatchObject({
      isSpecial: true,
      serviceLabel: 'Convocation special',
    });
    const booked = await post(s, `/api/v1/trips/${res.body.trip.id}/bookings`, SELF_BOOKING);
    expect(booked.status).toBe(201);
  });

  it('can run on a holiday closure date', async () => {
    await post(admin, '/api/v1/admin/closures', { date: HOLIDAY, reason: 'Holiday' });
    const res = await post(admin, '/api/v1/admin/trips/special', {
      ...special,
      travelDate: HOLIDAY,
      serviceLabel: 'Holiday shuttle',
    });
    expect(res.status).toBe(201);
    expect(res.body.trip.availability).toBe('OPEN');
  });

  it('requires a custom deadline when the default one has passed', async () => {
    const tomorrow = { ...special, travelDate: '2026-10-15' };
    t.clock.now = istToUtc('2026-10-14', '17:00');
    const res = await post(admin, '/api/v1/admin/trips/special', tomorrow);
    expect(res.status).toBe(400);
    const ok = await post(admin, '/api/v1/admin/trips/special', {
      ...tomorrow,
      bookingClosesAt: '2026-10-15T06:00:00+05:30',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.trip.availability).toBe('OPEN');
  });

  it('validates input and is admin-only', async () => {
    expect(
      (await post(admin, '/api/v1/admin/trips/special', { ...special, travelDate: '2026-10-01' }))
        .status,
    ).toBe(400);
    expect(
      (await post(admin, '/api/v1/admin/trips/special', { ...special, capacity: 0 })).status,
    ).toBe(400);
    const user = await signIn(t, identity('student1'));
    expect((await post(user, '/api/v1/admin/trips/special', special)).status).toBe(403);
  });
});

describe('analytics', () => {
  it('aggregates occupancy, demand and lead time', async () => {
    const trip = await db.trip.findFirstOrThrow({
      where: { travelDate: '2026-10-19', departureTime: '10:00' },
    });
    await bookAs('a1', trip.id);
    const { s, res } = await bookAs('a2', trip.id);
    await post(s, `/api/v1/bookings/${res.body.booking.reference}/cancel`);

    const r = await admin.agent.get('/api/v1/admin/analytics?from=2026-10-19&to=2026-10-19');
    expect(r.status).toBe(200);
    expect(r.body.totals).toMatchObject({
      bookings: 1,
      cancelled: 1,
      cancellationRate: 50,
      seatsOffered: 24 * 2 + 13 * 4,
      seatsFilled: 1,
      occupancy: 1,
      trips: 6,
    });
    expect(r.body.daily).toEqual([
      { date: '2026-10-19', confirmed: 1, cancelled: 1, capacity: 100, occupancy: 1 },
    ]);
    const dep = r.body.byDeparture.find(
      (d: { departureTime: string }) => d.departureTime === '10:00',
    );
    expect(dep).toMatchObject({
      serviceLabel: 'VAN',
      confirmed: 1,
      capacity: 13,
      occupancy: 7.7,
    });
    expect(r.body.byWeekday).toEqual([{ weekday: 1, confirmed: 1, capacity: 100, occupancy: 1 }]);
    expect(r.body.leadTime.find((b: { bucket: string }) => b.bucket === '4–5 days').bookings).toBe(
      2,
    );
  });

  it('is admin-only and validates the range', async () => {
    const user = await signIn(t, identity('student1'));
    expect((await user.agent.get('/api/v1/admin/analytics')).status).toBe(403);
    expect(
      (await admin.agent.get('/api/v1/admin/analytics?from=2026-10-20&to=2026-10-01')).status,
    ).toBe(400);
  });
});
