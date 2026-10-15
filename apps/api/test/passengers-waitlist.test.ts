import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc } from '@iitd-bus/shared';
import { expireWaitlists } from '../src/bookings/service';
import { purgePersonalData } from '../src/lib/retention';
import { generateTrips } from '../src/trips/generate';
import { seedServiceTemplates } from '../src/trips/templates-seed';
import {
  SELF_BOOKING,
  createTestApp,
  guestBooking,
  identity,
  signIn,
  type SignedInAgent,
  type TestApp,
} from './app-helpers';
import { resetDb, testPrisma } from './helpers';

const db = testPrisma();
// Wednesday 2026-10-14 09:00 IST
const NOW = istToUtc('2026-10-14', '09:00');
const MON = '2026-10-19';
let t: TestApp;
let admin: SignedInAgent;

const post = (a: SignedInAgent, url: string, body: object = {}) =>
  a.agent.post(url).set('X-CSRF-Token', a.csrf).send(body);
const book = (a: SignedInAgent, tripId: string, body: object = SELF_BOOKING) =>
  post(a, `/api/v1/trips/${tripId}/bookings`, body);
const tripOn = (date: string, time: string) =>
  db.trip.findFirstOrThrow({ where: { travelDate: date, departureTime: time, origin: 'DELHI' } });
async function smallTrip(capacity = 1) {
  const trip = await tripOn(MON, '10:00');
  return db.trip.update({ where: { id: trip.id }, data: { capacity } });
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

describe('booking details and guests', () => {
  it('validates phone, purpose and guest ID numbers', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    const bad = async (body: object) => (await book(s, trip.id, body)).status;
    expect(await bad({ passengerType: 'SELF', purpose: 'ACADEMIC' })).toBe(400);
    expect(await bad({ ...SELF_BOOKING, phone: '12345' })).toBe(400);
    expect(await bad({ ...SELF_BOOKING, purpose: 'OTHER' })).toBe(400);
    expect(await bad({ ...SELF_BOOKING, passengerType: 'GUEST' })).toBe(400);
    expect(
      await bad(
        guestBooking({
          guest: { name: 'G', email: 'g@x.com', idType: 'AADHAAR', idNumber: '1234' },
        }),
      ),
    ).toBe(400);
    expect(
      await bad(
        guestBooking({
          guest: { name: 'Gg', email: 'g@x.com', idType: 'PAN', idNumber: '1234567890' },
        }),
      ),
    ).toBe(400);
    expect(await db.booking.count()).toBe(0);
    const ok = await book(s, trip.id, {
      ...SELF_BOOKING,
      phone: '+91 98765-43210',
      purpose: 'OTHER',
      purposeDetail: 'Sports meet',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.booking.passenger).toMatchObject({
      phone: '9876543210',
      purpose: 'OTHER',
      purposeDetail: 'Sports meet',
    });
  });

  it('encrypts guest ID numbers, masks them for users and shows them to admins (audited)', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    const res = await book(s, trip.id, guestBooking());
    expect(res.status).toBe(201);
    expect(res.body.booking.passenger).toMatchObject({
      type: 'GUEST',
      name: 'Guest Person',
      idType: 'AADHAAR',
      idNumberMasked: 'XXXX XXXX 0123',
    });
    const row = await db.booking.findFirstOrThrow();
    expect(row.idNumberEnc).not.toContain('234567890123');
    expect(row.idNumberEnc).toMatch(/^v1\./);

    const detail = await admin.agent.get(`/api/v1/admin/bookings/${res.body.booking.reference}`);
    expect(detail.body.booking).toMatchObject({
      idType: 'AADHAAR',
      idNumber: '234567890123',
      passengerName: 'Guest Person',
    });
    expect(await db.auditLog.count({ where: { action: 'ID_NUMBER_VIEWED' } })).toBe(1);
  });

  it('sends the guest a copy of the confirmation', async () => {
    const s = await signIn(t, identity('u1'));
    await book(s, (await tripOn(MON, '10:00')).id, guestBooking());
    const rows = await db.notificationOutbox.findMany({ orderBy: { recipient: 'asc' } });
    expect(rows.map((r) => r.recipient)).toEqual(['guest@example.com', 'u1@iitd.ac.in']);
    expect(rows.every((r) => r.type === 'BOOKING_CONFIRMATION')).toBe(true);
  });

  it('books yourself and a guest, or two guests, from one form', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    const party = {
      bookerName: 'User u1',
      phone: '9876543210',
      passengers: [
        { passengerType: 'SELF', purpose: 'ACADEMIC' },
        {
          passengerType: 'GUEST',
          purpose: 'ADMINISTRATIVE',
          guest: {
            name: 'Meera Sharma',
            email: 'meera@example.com',
            phone: '9123456789',
            idType: 'PASSPORT',
            idNumber: 'Z1234567',
          },
        },
      ],
    };
    const res = await s.agent
      .post(`/api/v1/trips/${trip.id}/bookings`)
      .set('X-CSRF-Token', s.csrf)
      .set('Idempotency-Key', 'party-0001')
      .send(party);
    expect(res.status).toBe(201);
    expect(res.body.bookings).toHaveLength(2);
    expect(res.body.bookings[0].passenger).toMatchObject({ type: 'SELF', name: 'User u1' });
    expect(res.body.bookings[1].passenger).toMatchObject({
      type: 'GUEST',
      name: 'Meera Sharma',
      idType: 'PASSPORT',
      guestPhone: '9123456789',
    });
    const recipients = (await db.notificationOutbox.findMany()).map((r) => r.recipient).sort();
    expect(recipients).toEqual(['meera@example.com', 'u1@iitd.ac.in', 'u1@iitd.ac.in']);

    const replay = await s.agent
      .post(`/api/v1/trips/${trip.id}/bookings`)
      .set('X-CSRF-Token', s.csrf)
      .set('Idempotency-Key', 'party-0001')
      .send(party);
    expect(replay.status).toBe(200);
    expect(await db.booking.count()).toBe(2);

    const other = await book(s, (await tripOn(MON, '07:45')).id, {
      bookerName: 'User u1',
      phone: '9876543210',
      passengers: [
        {
          passengerType: 'GUEST',
          purpose: 'OTHER',
          purposeDetail: 'Campus visit',
          guest: {
            name: 'Arun Das',
            email: 'arun@example.com',
            phone: '9988776655',
            idType: 'OTHER',
            idTypeDetail: 'Voter ID',
            idNumber: 'ABC1234567',
          },
        },
        {
          passengerType: 'GUEST',
          purpose: 'ACADEMIC',
          guest: {
            name: 'Leela Das',
            email: 'leela@example.com',
            phone: '9988776644',
            idType: 'DRIVING_LICENCE',
            idNumber: 'MH0120190012345',
          },
        },
      ],
    });
    expect(other.status).toBe(201);
    expect(other.body.bookings.map((b: { passenger: { name: string } }) => b.passenger.name)).toEqual([
      'Arun Das',
      'Leela Das',
    ]);
    const stored = await db.booking.findFirstOrThrow({ where: { passengerName: 'Arun Das' } });
    expect(stored.idTypeDetail).toBe('Voter ID');
    const copies = await db.notificationOutbox.findMany({
      where: { tripId: (await tripOn(MON, '07:45')).id },
    });
    expect(copies.map((r) => r.recipient).sort()).toEqual([
      'arun@example.com',
      'leela@example.com',
      'u1@iitd.ac.in',
      'u1@iitd.ac.in',
    ]);

    const tiny = await tripOn(MON, '17:00');
    await db.trip.update({ where: { id: tiny.id }, data: { capacity: 1, bookedCount: 0 } });
    const tooMany = await book(s, tiny.id, party);
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('TRIP_FULL');
    expect(await db.booking.count({ where: { tripId: tiny.id } })).toBe(0);
  });
});

describe('two seats per account per trip', () => {
  it('allows self + guest or two guests, never a third seat or a second self', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    expect((await book(s, trip.id)).status).toBe(201);
    expect((await book(s, trip.id)).body.error.code).toBe('ALREADY_BOOKED');
    expect((await book(s, trip.id, guestBooking())).status).toBe(201);
    const third = await book(s, trip.id, guestBooking());
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('SEAT_LIMIT');

    const s2 = await signIn(t, identity('u2'));
    expect((await book(s2, trip.id, guestBooking())).status).toBe(201);
    expect((await book(s2, trip.id, guestBooking())).status).toBe(201);
    expect((await book(s2, trip.id, SELF_BOOKING)).body.error.code).toBe('SEAT_LIMIT');
  });

  it('holds the limit under parallel requests', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => book(s, trip.id, guestBooking())),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await db.booking.count({ where: { status: 'CONFIRMED' } })).toBe(2);
  });

  it('frees the slot after a cancellation', async () => {
    const s = await signIn(t, identity('u1'));
    const trip = await tripOn(MON, '10:00');
    const a = await book(s, trip.id);
    await book(s, trip.id, guestBooking());
    await post(s, `/api/v1/bookings/${a.body.booking.reference}/cancel`);
    expect((await book(s, trip.id)).status).toBe(201);
  });
});

describe('waiting list', () => {
  it('offers the waitlist when full and auto-confirms the first person when a seat frees up', async () => {
    const trip = await smallTrip(1);
    const a = await signIn(t, identity('a1'));
    const b = await signIn(t, identity('b1'));
    const c = await signIn(t, identity('c1'));
    const first = await book(a, trip.id);

    const full = await book(b, trip.id);
    expect(full.body.error).toMatchObject({ code: 'TRIP_FULL', details: { canWaitlist: true } });

    const wb = await book(b, trip.id, { ...SELF_BOOKING, joinWaitlist: true });
    expect(wb.status).toBe(201);
    expect(wb.body.booking).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });
    const wc = await book(c, trip.id, { ...SELF_BOOKING, joinWaitlist: true });
    expect(wc.body.booking.waitlistPosition).toBe(2);
    expect(await db.notificationOutbox.count({ where: { type: 'WAITLIST_JOINED' } })).toBe(2);

    const list = await b.agent.get(`/api/v1/trips?from=${MON}&to=${MON}`);
    expect(list.body.trips.find((x: { id: string }) => x.id === trip.id)).toMatchObject({
      availability: 'FULL',
      waitlistCount: 2,
      myBookings: [{ status: 'WAITLISTED' }],
    });

    await post(a, `/api/v1/bookings/${first.body.booking.reference}/cancel`);
    const promoted = await db.booking.findUniqueOrThrow({
      where: { bookingReference: wb.body.booking.reference },
    });
    expect(promoted.status).toBe('CONFIRMED');
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).bookedCount).toBe(1);
    expect(await db.notificationOutbox.count({ where: { type: 'WAITLIST_PROMOTED' } })).toBe(1);
    const cNow = await c.agent.get(`/api/v1/bookings/${wc.body.booking.reference}`);
    expect(cNow.body.booking).toMatchObject({ status: 'WAITLISTED', waitlistPosition: 1 });
  });

  it('lets people leave the waitlist without affecting seats', async () => {
    const trip = await smallTrip(1);
    const a = await signIn(t, identity('a1'));
    const b = await signIn(t, identity('b1'));
    await book(a, trip.id);
    const w = await book(b, trip.id, { ...SELF_BOOKING, joinWaitlist: true });
    const leave = await post(b, `/api/v1/bookings/${w.body.booking.reference}/cancel`);
    expect(leave.body.booking.status).toBe('CANCELLED');
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).bookedCount).toBe(1);
  });

  it('stops promoting at the 4 PM booking close and expires remaining entries', async () => {
    const trip = await smallTrip(1);
    const a = await signIn(t, identity('a1'));
    const b = await signIn(t, identity('b1'));
    const first = await book(a, trip.id);
    await book(b, trip.id, { ...SELF_BOOKING, joinWaitlist: true });

    t.clock.now = istToUtc('2026-10-16', '16:30'); // after booking closed (Friday 4 PM)
    await post(admin, `/api/v1/admin/bookings/${first.body.booking.reference}/cancel`, {
      reason: 'Unwell',
    });
    expect(await db.booking.count({ where: { status: 'WAITLISTED' } })).toBe(1);

    expect(await expireWaitlists(db, t.clock.now)).toBe(1);
    expect(await db.booking.count({ where: { status: 'WAITLISTED' } })).toBe(0);
    expect(await db.notificationOutbox.count({ where: { type: 'WAITLIST_EXPIRED' } })).toBe(1);
  });

  it('promotes when an admin raises capacity', async () => {
    const trip = await smallTrip(1);
    const a = await signIn(t, identity('a1'));
    const b = await signIn(t, identity('b1'));
    await book(a, trip.id);
    await book(b, trip.id, { ...SELF_BOOKING, joinWaitlist: true });
    const res = await admin.agent
      .patch(`/api/v1/admin/trips/${trip.id}`)
      .set('X-CSRF-Token', admin.csrf)
      .send({ capacity: 2 });
    expect(res.body.trip).toMatchObject({ bookedCount: 2, waitlistCount: 0 });
  });

  it('cancels waitlist entries when the trip is cancelled', async () => {
    const trip = await smallTrip(1);
    const a = await signIn(t, identity('a1'));
    const b = await signIn(t, identity('b1'));
    await book(a, trip.id);
    await book(b, trip.id, { ...SELF_BOOKING, joinWaitlist: true });
    const res = await post(admin, `/api/v1/admin/trips/${trip.id}/cancel`, {
      reason: 'Vehicle breakdown',
    });
    expect(res.body.affectedBookings).toBe(2);
    expect(await db.notificationOutbox.count({ where: { type: 'TRIP_CANCELLATION' } })).toBe(2);
  });
});

describe('2 PM cancellation cutoff', () => {
  it('allows cancelling until 2 PM the day before while booking stays open until 4 PM', async () => {
    const trip = await tripOn('2026-10-20', '10:00');
    const s = await signIn(t, identity('u1'));
    const late = await signIn(t, identity('u2'));
    const res = await book(s, trip.id);
    expect(trip.cancellationClosesAt.toISOString()).toBe(
      istToUtc('2026-10-19', '14:00').toISOString(),
    );

    t.clock.now = istToUtc('2026-10-19', '14:00');
    const cancel = await post(s, `/api/v1/bookings/${res.body.booking.reference}/cancel`);
    expect(cancel.body.error.code).toBe('CANCELLATION_CLOSED');
    t.clock.now = istToUtc('2026-10-19', '15:00');
    expect((await book(late, trip.id)).status).toBe(201);

    t.clock.now = new Date(istToUtc('2026-10-19', '14:00').getTime() - 1);
    expect((await post(s, `/api/v1/bookings/${res.body.booking.reference}/cancel`)).status).toBe(
      200,
    );
  });
});

describe('blocking users', () => {
  it('cancels bookings in the period, emails the user and blocks booking until revoked', async () => {
    const s = await signIn(t, identity('u1'));
    const inPeriod = await book(s, (await tripOn(MON, '10:00')).id);
    const afterPeriod = await book(s, (await tripOn('2026-10-21', '10:00')).id);
    const user = await db.user.findFirstOrThrow({ where: { providerSubject: 'u1' } });

    const res = await post(admin, '/api/v1/admin/blocks', {
      userId: user.id,
      startsOn: '2026-10-14',
      endsOn: '2026-10-20',
      reason: 'Repeated no-shows',
    });
    expect(res.status).toBe(201);
    expect(res.body.cancelledBookings).toBe(1);
    expect(
      (
        await db.booking.findUniqueOrThrow({
          where: { bookingReference: inPeriod.body.booking.reference },
        })
      ).status,
    ).toBe('CANCELLED');
    expect(
      (
        await db.booking.findUniqueOrThrow({
          where: { bookingReference: afterPeriod.body.booking.reference },
        })
      ).status,
    ).toBe('CONFIRMED');
    expect(await db.notificationOutbox.count({ where: { type: 'USER_BLOCKED' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'USER_BLOCKED' } })).toBe(1);

    const me = await s.agent.get('/api/v1/auth/me');
    expect(me.body.block).toEqual({ until: '2026-10-20', reason: 'Repeated no-shows' });
    const blocked = await book(s, (await tripOn('2026-10-21', '17:00')).id);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('USER_BLOCKED');
    expect((await s.agent.get('/api/v1/bookings/mine')).status).toBe(200);

    const revoke = await post(admin, `/api/v1/admin/blocks/${res.body.block.id}/revoke`);
    expect(revoke.status).toBe(200);
    expect((await book(s, (await tripOn('2026-10-21', '17:00')).id)).status).toBe(201);
  });

  it('is admin-only and admins cannot block themselves', async () => {
    const s = await signIn(t, identity('u1'));
    const me = await db.user.findFirstOrThrow({ where: { providerSubject: 'dgssac' } });
    const body = {
      userId: me.id,
      startsOn: '2026-10-14',
      endsOn: '2026-10-20',
      reason: 'test reason',
    };
    expect((await post(s, '/api/v1/admin/blocks', body)).status).toBe(403);
    expect((await post(admin, '/api/v1/admin/blocks', body)).status).toBe(400);
    expect((await admin.agent.get('/api/v1/admin/users?q=u1')).body.items[0]).toMatchObject({
      subject: 'u1',
      activeBlock: null,
    });
  });
});

describe('driver manifest and exports', () => {
  it('lists confirmed passengers with ID type and number, plus the waitlist, and audits access', async () => {
    const trip = await smallTrip(2);
    const s = await signIn(t, identity('u1', { name: 'Ravi Kumar' }));
    const w = await signIn(t, identity('w1'));
    await book(s, trip.id);
    await book(
      s,
      trip.id,
      guestBooking({
        guest: {
          name: 'Meera',
          email: 'm@x.com',
          idType: 'PAN',
          idNumber: 'abcde1234f',
          phone: '9123456789',
        },
      }),
    );
    await book(w, trip.id, { ...SELF_BOOKING, joinWaitlist: true });

    const m = await admin.agent.get(`/api/v1/admin/trips/${trip.id}/manifest`);
    expect(m.status).toBe(200);
    expect(m.body.passengers).toEqual([
      expect.objectContaining({
        serial: 1,
        name: 'Ravi Kumar',
        idType: 'IITD_ID',
        idNumber: 'u1',
        phone: '9876543210',
      }),
      expect.objectContaining({
        serial: 2,
        name: 'Meera',
        idType: 'PAN',
        idNumber: 'ABCDE1234F',
        phone: '9123456789',
        bookedBy: 'Ravi Kumar',
      }),
    ]);
    expect(m.body.waitlist).toEqual([expect.objectContaining({ position: 1, name: 'User w1' })]);

    const csv = await admin.agent.get(`/api/v1/admin/trips/${trip.id}/manifest.csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('ID type,ID number');
    expect(csv.text).toContain('PAN card,ABCDE1234F');
    expect(
      await db.auditLog.count({
        where: { action: { in: ['MANIFEST_VIEWED', 'MANIFEST_EXPORTED'] } },
      }),
    ).toBe(2);

    const user = await signIn(t, identity('x1'));
    expect((await user.agent.get(`/api/v1/admin/trips/${trip.id}/manifest`)).status).toBe(403);
  });

  it('includes passenger details and full ID numbers in the bookings CSV', async () => {
    const s = await signIn(t, identity('u1'));
    await book(s, (await tripOn(MON, '10:00')).id, guestBooking());
    const csv = await admin.agent.get('/api/v1/admin/bookings/export.csv');
    expect(csv.text).toContain('Passenger name,Passenger type');
    expect(csv.text).toContain('Aadhaar card,234567890123');
  });
});

describe('data retention', () => {
  it('erases phone and ID numbers after the retention period but keeps the booking', async () => {
    const s = await signIn(t, identity('u1'));
    await book(s, (await tripOn(MON, '10:00')).id, guestBooking());
    const sixMonthsLater = istToUtc('2027-04-20', '09:00');
    expect((await purgePersonalData(db, istToUtc('2026-11-01', '09:00'), 180)).bookings).toBe(0);
    expect((await purgePersonalData(db, sixMonthsLater, 180)).bookings).toBe(1);
    const row = await db.booking.findFirstOrThrow();
    expect(row).toMatchObject({
      phone: null,
      idNumberEnc: null,
      passengerEmail: null,
      passengerName: 'Guest Person',
    });
    expect(row.piiPurgedAt).not.toBeNull();
  });
});
