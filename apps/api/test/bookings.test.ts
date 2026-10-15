import request from 'supertest';
import { PrismaClient, type Trip } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc } from '@iitd-bus/shared';
import { createBooking } from '../src/bookings/service';
import { HttpError } from '../src/lib/errors';
import { generateTrips } from '../src/trips/generate';
import { seedServiceTemplates } from '../src/trips/templates-seed';
import { SELF_BOOKING, createTestApp, identity, signIn, type TestApp } from './app-helpers';
import { resetDb, testPrisma, TEST_DATABASE_URL } from './helpers';

const db = testPrisma();
// Wednesday 2026-10-14 09:00 IST
const NOW = istToUtc('2026-10-14', '09:00');
const MON = '2026-10-19';

let t: TestApp;

async function trip(travelDate: string, departureTime: string, origin = 'DELHI'): Promise<Trip> {
  return db.trip.findFirstOrThrow({ where: { travelDate, departureTime, origin } });
}

function book(
  s: { agent: ReturnType<typeof request.agent>; csrf: string },
  tripId: string,
  key?: string,
) {
  const req = s.agent
    .post(`/api/v1/trips/${tripId}/bookings`)
    .set('X-CSRF-Token', s.csrf)
    .send(SELF_BOOKING);
  return key ? req.set('Idempotency-Key', key) : req;
}

beforeEach(async () => {
  await resetDb();
  await seedServiceTemplates(db, '2026-01-01');
  await generateTrips(db, { now: NOW, horizonDays: 13 });
  // Long session TTL: several tests move the clock days ahead.
  t = createTestApp({ now: NOW, env: { SESSION_TTL_HOURS: '720' } });
});
afterAll(() => db.$disconnect());

describe('trip listing', () => {
  it('requires authentication', async () => {
    const res = await request(t.app).get('/api/v1/trips');
    expect(res.status).toBe(401);
  });

  it('lists upcoming weekday trips with availability and filters by direction', async () => {
    const s = await signIn(t, identity('u1'));
    const all = await s.agent.get(`/api/v1/trips?from=${MON}&to=${MON}`);
    expect(all.status).toBe(200);
    expect(all.body.trips).toHaveLength(6);
    expect(all.body.trips[0]).toMatchObject({
      availability: 'OPEN',
      seatsRemaining: expect.any(Number),
    });

    const toSonipat = await s.agent.get(
      `/api/v1/trips?from=${MON}&to=${MON}&direction=DELHI_TO_SONIPAT`,
    );
    expect(toSonipat.body.trips.map((x: { departureTime: string }) => x.departureTime)).toEqual([
      '07:45',
      '10:00',
      '17:00',
    ]);

    const weekend = await s.agent.get('/api/v1/trips?from=2026-10-17&to=2026-10-18');
    expect(weekend.body.trips).toHaveLength(0);

    const later = await s.agent.get('/api/v1/trips?from=2026-10-26&to=2026-10-26');
    expect(
      later.body.trips.every((x: { availability: string }) => x.availability === 'NOT_OPEN'),
    ).toBe(true);
  });

  it('validates query parameters', async () => {
    const s = await signIn(t, identity('u1'));
    expect((await s.agent.get('/api/v1/trips?from=2026-13-01')).status).toBe(400);
    expect((await s.agent.get('/api/v1/trips?direction=UP')).status).toBe(400);
  });
});

describe('booking', () => {
  it('rejects unauthenticated and CSRF-less requests', async () => {
    const target = await trip(MON, '07:45');
    expect((await request(t.app).post(`/api/v1/trips/${target.id}/bookings`)).status).toBe(401);
    const s = await signIn(t, identity('u1'));
    const res = await s.agent.post(`/api/v1/trips/${target.id}/bookings`);
    expect(res.status).toBe(403);
    expect(await db.booking.count()).toBe(0);
  });

  it('confirms a booking, decrements availability and queues one confirmation email', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('u1'));
    const res = await book(s, target.id);
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.booking.reference).toMatch(/^SNP-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(res.body.booking).toMatchObject({
      status: 'CONFIRMED',
      canCancel: true,
      emailStatus: 'PENDING',
    });
    expect(res.body.booking.trip).toMatchObject({
      seatsRemaining: 23,
      myBookings: [
        {
          reference: res.body.booking.reference,
          status: 'CONFIRMED',
          passengerType: 'SELF',
          passengerName: 'User u1',
        },
      ],
    });
    expect(res.body.booking.passenger).toMatchObject({
      type: 'SELF',
      phone: '9876543210',
      purpose: 'ACADEMIC',
      idType: 'IITD_ID',
      idNumberMasked: 'u1',
    });

    const outbox = await db.notificationOutbox.findMany();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      type: 'BOOKING_CONFIRMATION',
      recipient: 'u1@iitd.ac.in',
      status: 'PENDING',
    });
    expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).bookedCount).toBe(1);
  });

  it('allows only one active booking per user per trip', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('u1'));
    const first = await book(s, target.id);
    const second = await book(s, target.id);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_BOOKED');
    expect(second.body.error.details.reference).toBe(first.body.booking.reference);
    // Different trips on the same day are allowed.
    expect((await book(s, (await trip(MON, '17:30', 'SONIPAT')).id)).status).toBe(201);
  });

  it('replays idempotent retries without duplicating the booking or the email', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('u1'));
    const a = await book(s, target.id, 'retry-key-0001');
    const b = await book(s, target.id, 'retry-key-0001');
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.created).toBe(false);
    expect(b.body.booking.reference).toBe(a.body.booking.reference);
    expect(await db.booking.count()).toBe(1);
    expect(await db.notificationOutbox.count()).toBe(1);
  });

  it('ignores client-supplied identity, capacity and status fields', async () => {
    const target = await trip(MON, '07:45');
    const victim = await signIn(t, identity('victim'));
    const s = await signIn(t, identity('u1'));
    const res = await book(s, target.id).send({
      userId: victim.userId,
      capacity: 999,
      status: 'CANCELLED',
    });
    expect(res.status).toBe(201);
    const row = await db.booking.findFirstOrThrow();
    expect(row.userId).toBe(s.userId);
    expect(row.status).toBe('CONFIRMED');
    expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).capacity).toBe(24);
  });

  it('rejects bookings before the seven-day window opens and accepts exactly at opening', async () => {
    const target = await trip('2026-10-26', '07:45'); // opens Mon 2026-10-19 00:00 IST
    const s = await signIn(t, identity('u1'));
    t.clock.now = new Date(target.bookingOpensAt.getTime() - 1);
    const early = await book(s, target.id);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('BOOKING_NOT_OPEN');
    t.clock.now = target.bookingOpensAt;
    expect((await book(s, target.id)).status).toBe(201);
  });

  it('closes Monday trips at 4 PM IST on the preceding Friday', async () => {
    const target = await trip(MON, '07:45');
    const s1 = await signIn(t, identity('u1'));
    const s2 = await signIn(t, identity('u2'));
    const s3 = await signIn(t, identity('u3'));
    const s4 = await signIn(t, identity('u4'));
    t.clock.now = istToUtc('2026-10-15', '11:00'); // Thursday
    expect((await book(s1, target.id)).status).toBe(201);
    t.clock.now = new Date(istToUtc('2026-10-16', '16:00').getTime() - 1); // Friday 15:59:59.999
    expect((await book(s2, target.id)).status).toBe(201);
    t.clock.now = istToUtc('2026-10-16', '16:00');
    const late = await book(s3, target.id);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('BOOKING_CLOSED');
    t.clock.now = istToUtc('2026-10-18', '11:00'); // Sunday
    expect((await book(s4, target.id)).body.error.code).toBe('BOOKING_CLOSED');
  });

  it('closes Tuesday trips at 4 PM IST on Monday', async () => {
    const target = await trip('2026-10-20', '10:00');
    const s = await signIn(t, identity('u1'));
    t.clock.now = istToUtc('2026-10-19', '16:00');
    expect((await book(s, target.id)).body.error.code).toBe('BOOKING_CLOSED');
  });

  it('rejects bookings on full trips', async () => {
    const target = await trip(MON, '10:00');
    await db.trip.update({ where: { id: target.id }, data: { capacity: 2 } });
    for (const u of ['a1', 'a2'])
      expect((await book(await signIn(t, identity(u)), target.id)).status).toBe(201);
    const res = await book(await signIn(t, identity('a3')), target.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRIP_FULL');
  });

  it('rejects bookings on cancelled trips', async () => {
    const target = await trip(MON, '10:00');
    await db.trip.update({ where: { id: target.id }, data: { status: 'CANCELLED' } });
    const res = await book(await signIn(t, identity('u1')), target.id);
    expect(res.body.error.code).toBe('TRIP_CANCELLED');
  });

  it('rejects Saturday/Sunday trips even if one exists in the database', async () => {
    const template = await trip(MON, '10:00');
    const { id: _id, createdAt: _c, updatedAt: _u, serviceTemplateId: _s, ...rest } = template;
    const saturday = await db.trip.create({
      data: { ...rest, travelDate: '2026-10-17', departureAt: istToUtc('2026-10-17', '10:00') },
    });
    const res = await book(await signIn(t, identity('u1')), saturday.id);
    expect(res.body.error.code).toBe('TRIP_NOT_OPERATIONAL');
  });

  it('returns 404 for unknown trips', async () => {
    const res = await book(await signIn(t, identity('u1')), 'does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('concurrency', () => {
  it('never exceeds capacity when many users race for the last seats (HTTP)', async () => {
    const target = await trip(MON, '13:00', 'SONIPAT');
    await db.trip.update({ where: { id: target.id }, data: { capacity: 3 } });
    const users = await Promise.all(
      Array.from({ length: 15 }, (_, i) => signIn(t, identity(`racer${i}`))),
    );
    const results = await Promise.all(users.map((s) => book(s, target.id)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'TRIP_FULL'),
    ).toBe(true);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    expect(await db.booking.count({ where: { tripId: target.id, status: 'CONFIRMED' } })).toBe(3);
    expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).bookedCount).toBe(3);
    expect(await db.notificationOutbox.count()).toBe(3);
  });

  it('a double-clicking user gets exactly one booking', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('clicker'));
    const results = await Promise.all(Array.from({ length: 8 }, () => book(s, target.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.booking.count()).toBe(1);
    expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).bookedCount).toBe(1);
  });

  it('holds under real parallel database connections (service level)', async () => {
    // A separate client with several connections so transactions genuinely overlap in the DB.
    const url = TEST_DATABASE_URL.startsWith('file:')
      ? TEST_DATABASE_URL.replace('connection_limit=1', 'connection_limit=8&socket_timeout=20')
      : TEST_DATABASE_URL;
    const parallel = new PrismaClient({ datasources: { db: { url } } });
    try {
      const target = await trip(MON, '17:00');
      await db.trip.update({ where: { id: target.id }, data: { capacity: 5 } });
      const users = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          db.user.create({
            data: {
              authProvider: 'dev-mock',
              providerSubject: `p${i}`,
              name: `P${i}`,
              email: `p${i}@iitd.ac.in`,
            },
          }),
        ),
      );
      const outcomes = await Promise.allSettled(
        users.map((user) =>
          createBooking(parallel, { user, tripId: target.id, request: SELF_BOOKING, now: NOW }),
        ),
      );
      const ok = outcomes.filter((o) => o.status === 'fulfilled');
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(ok).toHaveLength(5);
      for (const r of rejected) {
        expect(r.reason).toBeInstanceOf(HttpError);
        expect((r.reason as HttpError).code).toBe('TRIP_FULL');
      }
      expect(await db.booking.count({ where: { tripId: target.id, status: 'CONFIRMED' } })).toBe(5);
      expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).bookedCount).toBe(5);
    } finally {
      await parallel.$disconnect();
    }
  });
});

describe('cancellation and access control', () => {
  it('releases the seat, keeps history and allows rebooking', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('u1'));
    const first = await book(s, target.id);
    const ref = first.body.booking.reference;

    const cancel = await s.agent
      .post(`/api/v1/bookings/${ref}/cancel`)
      .set('X-CSRF-Token', s.csrf)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.booking).toMatchObject({
      status: 'CANCELLED',
      canCancel: false,
      cancelledByAdmin: false,
    });
    expect((await db.trip.findUniqueOrThrow({ where: { id: target.id } })).bookedCount).toBe(0);

    const again = await s.agent.post(`/api/v1/bookings/${ref}/cancel`).set('X-CSRF-Token', s.csrf);
    expect(again.body.error.code).toBe('BOOKING_ALREADY_CANCELLED');

    const rebook = await book(s, target.id);
    expect(rebook.status).toBe(201);
    expect(rebook.body.booking.reference).not.toBe(ref);

    const mine = await s.agent.get('/api/v1/bookings/mine');
    expect(mine.body.upcoming.map((b: { status: string }) => b.status).sort()).toEqual([
      'CANCELLED',
      'CONFIRMED',
    ]);
    const types = (await db.notificationOutbox.findMany()).map((n) => n.type).sort();
    expect(types).toEqual(['BOOKING_CANCELLATION', 'BOOKING_CONFIRMATION', 'BOOKING_CONFIRMATION']);
  });

  it('blocks self-cancellation after the cutoff', async () => {
    const target = await trip(MON, '07:45');
    const s = await signIn(t, identity('u1'));
    const ref = (await book(s, target.id)).body.booking.reference;
    t.clock.now = target.cancellationClosesAt;
    const res = await s.agent.post(`/api/v1/bookings/${ref}/cancel`).set('X-CSRF-Token', s.csrf);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANCELLATION_CLOSED');
    expect((await s.agent.get(`/api/v1/bookings/${ref}`)).body.booking.canCancel).toBe(false);
  });

  it("hides other users' bookings (404) and prevents cancelling them", async () => {
    const target = await trip(MON, '07:45');
    const owner = await signIn(t, identity('owner'));
    const other = await signIn(t, identity('other'));
    const ref = (await book(owner, target.id)).body.booking.reference;
    expect((await owner.agent.get(`/api/v1/bookings/${ref}`)).status).toBe(200);
    expect((await other.agent.get(`/api/v1/bookings/${ref}`)).status).toBe(404);
    const res = await other.agent
      .post(`/api/v1/bookings/${ref}/cancel`)
      .set('X-CSRF-Token', other.csrf);
    expect(res.status).toBe(404);
    expect((await db.booking.findFirstOrThrow()).status).toBe('CONFIRMED');
    const otherList = await other.agent.get('/api/v1/bookings/mine');
    expect(otherList.body.upcoming).toHaveLength(0);
  });

  it('separates upcoming and past bookings', async () => {
    const target = await trip('2026-10-15', '10:00');
    const s = await signIn(t, identity('u1'));
    t.clock.now = istToUtc('2026-10-14', '12:00');
    await book(s, target.id);
    t.clock.now = istToUtc('2026-10-15', '11:00');
    const mine = await s.agent.get('/api/v1/bookings/mine');
    expect(mine.body.upcoming).toHaveLength(0);
    expect(mine.body.past).toHaveLength(1);
    expect(mine.body.past[0].canCancel).toBe(false);
  });

  it('validates booking references', async () => {
    const s = await signIn(t, identity('u1'));
    expect((await s.agent.get('/api/v1/bookings/not-a-ref')).status).toBe(400);
  });
});
