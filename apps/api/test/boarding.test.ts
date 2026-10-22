import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { boardingCodeOf, istToUtc } from '@iitd-bus/shared';
import { renderEmail } from '../src/email/templates';
import type { NotificationPayload } from '../src/email/outbox';
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
const NOW = istToUtc('2026-10-14', '09:00');
const MON = '2026-10-19';
let t: TestApp;
let admin: SignedInAgent;

const tripOn = (travelDate: string, departureTime: string, origin = 'DELHI') =>
  db.trip.findFirstOrThrow({ where: { travelDate, departureTime, origin } });

const post = (a: SignedInAgent, url: string, body: object = {}) =>
  a.agent.post(url).set('X-CSRF-Token', a.csrf).send(body);

async function bookAs(subject: string, tripId: string, body: object = SELF_BOOKING) {
  const s = await signIn(t, identity(subject));
  const res = await post(s, `/api/v1/trips/${tripId}/bookings`, body);
  expect(res.status).toBe(201);
  return { s, booking: res.body.booking as { reference: string; boardingCode: string | null } };
}

beforeEach(async () => {
  await resetDb();
  await seedServiceTemplates(db, '2026-01-01');
  await generateTrips(db, { now: NOW, horizonDays: 13 });
  t = createTestApp({
    now: NOW,
    env: { ADMIN_ALLOWLIST: 'dgssac@iitd.ac.in', SESSION_TTL_HOURS: '720' },
  });
  admin = await signIn(t, identity('dgssac', { email: 'dgssac@iitd.ac.in', name: 'DGS SAC' }));
});
afterAll(() => db.$disconnect());

describe('boarding passes', () => {
  it('puts a QR code on a confirmed ticket and in the confirmation email', async () => {
    const trip = await tripOn(MON, '07:45');
    const { booking } = await bookAs('p1', trip.id);
    expect(booking.boardingCode).toMatch(/^MIITD1\.[A-Za-z0-9_-]{20,}$/);

    const note = await db.notificationOutbox.findFirstOrThrow({
      where: { type: 'BOOKING_CONFIRMATION' },
    });
    const payload = JSON.parse(note.payload) as NotificationPayload;
    expect(payload.boardingCode).toBe(booking.boardingCode);
    const email = renderEmail('BOOKING_CONFIRMATION', payload, 'https://sac.iitd.ac.in/MoveIITD');
    expect(email.boardingCode).toBe(booking.boardingCode);
    expect(email.html).toContain('cid:boarding-qr');
    expect(email.text).toContain('QR boarding pass');
    expect(email.text).toContain(booking.reference);
  });

  it('boards the matching ticket, rejects the wrong vehicle, and does not board twice', async () => {
    const morning = await tripOn(MON, '07:45');
    const later = await tripOn(MON, '10:00');
    const { booking } = await bookAs('p1', morning.id);
    const code = booking.boardingCode!;

    const wrong = await post(admin, '/api/v1/boarding/scans', { tripId: later.id, code });
    expect(wrong.status).toBe(200);
    expect(wrong.body.result).toBe('WRONG_TRIP');
    expect(wrong.body.passengerName).toBe('User p1');
    expect(wrong.body.message).toContain('7:45 AM');
    expect(
      await db.booking.findFirstOrThrow({ where: { bookingReference: booking.reference } }),
    ).toMatchObject({
      boardedAt: null,
    });

    const ok = await post(admin, '/api/v1/boarding/scans', { tripId: morning.id, code });
    expect(ok.body).toMatchObject({ result: 'BOARDED', passengerName: 'User p1' });
    expect(ok.body.boardedAt).toEqual(expect.any(String));

    const again = await post(admin, '/api/v1/boarding/scans', { tripId: morning.id, code });
    expect(again.body.result).toBe('ALREADY_BOARDED');
    expect(await db.boardingScan.count({ where: { result: 'BOARDED' } })).toBe(1);

    const roster = await admin.agent.get(`/api/v1/boarding/trips/${morning.id}`);
    expect(roster.body.boarded).toEqual([expect.objectContaining({ name: 'User p1' })]);
    expect(JSON.stringify(roster.body)).not.toContain('9876543210');

    const live = await admin.agent.get(`/api/v1/admin/boarding?date=${MON}`);
    const row = live.body.trips.find((x: { trip: { id: string } }) => x.trip.id === morning.id);
    expect(row.passengers).toEqual([
      expect.objectContaining({
        name: 'User p1',
        boardedAt: expect.any(String),
        scannedByName: 'DGS SAC',
      }),
    ]);
  });

  it('rejects a cancelled ticket, a waiting-list entry, and a code that is not a pass', async () => {
    const trip = await tripOn(MON, '10:00');
    await db.trip.update({ where: { id: trip.id }, data: { capacity: 1 } });
    const { booking, s } = await bookAs('p1', trip.id);
    const waiting = await post(
      await signIn(t, identity('p2')).then((x) => x),
      `/api/v1/trips/${trip.id}/bookings`,
      { ...SELF_BOOKING, joinWaitlist: true },
    );
    expect(waiting.status).toBe(201);
    const waitCode = boardingCodeOf(
      (
        await db.booking.findFirstOrThrow({
          where: { bookingReference: waiting.body.booking.reference },
        })
      ).boardingToken!,
    );
    // Waiting-list bookings still have a token, but it must not board anyone.
    const queued = await post(admin, '/api/v1/boarding/scans', { tripId: trip.id, code: waitCode });
    expect(queued.body.result).toBe('NOT_CONFIRMED');

    await post(s, `/api/v1/bookings/${booking.reference}/cancel`, { reason: 'Plans changed' });
    const cancelled = await post(admin, '/api/v1/boarding/scans', {
      tripId: trip.id,
      code: booking.boardingCode,
    });
    expect(cancelled.body.result).toBe('CANCELLED');

    const junk = await post(admin, '/api/v1/boarding/scans', {
      tripId: trip.id,
      code: 'MIITD1.not-a-real-boarding-token-at-all',
    });
    expect(junk.body.result).toBe('INVALID');
    expect(junk.body.passengerName).toBeNull();
  });

  it('lets an admin appoint a conductor, who can scan, and removes that access', async () => {
    const trip = await tripOn(MON, '07:45');
    const { booking } = await bookAs('p1', trip.id);

    const stranger = await signIn(t, identity('rider'));
    expect(
      (
        await post(stranger, '/api/v1/boarding/scans', {
          tripId: trip.id,
          code: booking.boardingCode,
        })
      ).status,
    ).toBe(403);
    expect((await request(t.app).get('/api/v1/boarding/trips')).status).toBe(401);

    const pending = await post(admin, '/api/v1/admin/conductors', { kerberosId: 'Bus.Conductor' });
    expect(pending.status).toBe(201);
    expect(pending.body.conductor).toMatchObject({
      kerberosId: 'bus.conductor',
      active: true,
      name: null,
    });

    const conductor = await signIn(t, identity('bus.conductor', { name: 'Route Conductor' }));
    expect((await conductor.agent.get('/api/v1/auth/me')).body.user.role).toBe('CONDUCTOR');
    expect((await conductor.agent.get('/api/v1/admin/overview')).status).toBe(403);

    const scanned = await post(conductor, '/api/v1/boarding/scans', {
      tripId: trip.id,
      code: booking.boardingCode,
    });
    expect(scanned.body.result).toBe('BOARDED');

    const listed = await admin.agent.get('/api/v1/admin/conductors');
    const row = listed.body.conductors.find(
      (c: { kerberosId: string }) => c.kerberosId === 'bus.conductor',
    );
    expect(row.boardedCount).toBe(1);
    const history = await admin.agent.get(`/api/v1/admin/conductors/${row.id}`);
    expect(history.body.trips[0].scans[0]).toMatchObject({
      result: 'BOARDED',
      passengerName: 'User p1',
      reference: booking.reference,
    });
    expect(JSON.stringify(history.body)).not.toContain('9876543210');

    expect(
      (
        await admin.agent
          .delete(`/api/v1/admin/conductors/${row.id}`)
          .set('X-CSRF-Token', admin.csrf)
      ).status,
    ).toBe(200);
    expect((await conductor.agent.get('/api/v1/boarding/trips')).status).toBe(403);
    expect((await conductor.agent.get('/api/v1/auth/me')).body.user.role).toBe('USER');

    const again = await post(admin, '/api/v1/admin/conductors', { kerberosId: 'dgssac' });
    expect(again.status).toBe(409);
  });
});
