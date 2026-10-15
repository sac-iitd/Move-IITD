import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc } from '@iitd-bus/shared';
import { csvCell } from '../src/routes/admin';
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

async function bookAs(subject: string, tripId: string) {
  const s = await signIn(t, identity(subject));
  const res = await s.agent
    .post(`/api/v1/trips/${tripId}/bookings`)
    .set('X-CSRF-Token', s.csrf)
    .send(SELF_BOOKING);
  expect(res.status).toBe(201);
  return { s, reference: res.body.booking.reference as string };
}

const post = (a: SignedInAgent, url: string, body: object = {}) =>
  a.agent.post(url).set('X-CSRF-Token', a.csrf).send(body);
const patch = (a: SignedInAgent, url: string, body: object) =>
  a.agent.patch(url).set('X-CSRF-Token', a.csrf).send(body);

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

describe('authorization', () => {
  const endpoints: [string, string][] = [
    ['get', '/api/v1/admin/overview'],
    ['get', '/api/v1/admin/trips'],
    ['post', '/api/v1/admin/trips/generate'],
    ['patch', '/api/v1/admin/trips/x'],
    ['post', '/api/v1/admin/trips/x/cancel'],
    ['get', '/api/v1/admin/templates'],
    ['patch', '/api/v1/admin/templates/x'],
    ['get', '/api/v1/admin/bookings'],
    ['get', '/api/v1/admin/bookings/export.csv'],
    ['get', '/api/v1/admin/bookings/SNP-AAAA-BBBB'],
    ['post', '/api/v1/admin/bookings/SNP-AAAA-BBBB/cancel'],
    ['get', '/api/v1/admin/notifications'],
    ['post', '/api/v1/admin/notifications/x/retry'],
    ['get', '/api/v1/admin/audit-logs'],
  ];

  it('rejects unauthenticated requests on every admin endpoint', async () => {
    for (const [method, url] of endpoints) {
      const res = await (request(t.app) as unknown as Record<string, (u: string) => request.Test>)[
        method
      ]!(url);
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });

  it('rejects ordinary users on every admin endpoint', async () => {
    const user = await signIn(t, identity('student1'));
    for (const [method, url] of endpoints) {
      const res = await (user.agent as unknown as Record<string, (u: string) => request.Test>)[
        method
      ]!(url)
        .set('X-CSRF-Token', user.csrf)
        .send({});
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });

  it('gives users no way to elevate their own role', async () => {
    const user = await signIn(t, identity('student1'));
    for (const body of [{ role: 'ADMIN' }, { user: { role: 'ADMIN' } }]) {
      await patch(user, '/api/v1/auth/me', body);
      await post(user, '/api/v1/auth/me', body);
    }
    expect((await user.agent.get('/api/v1/auth/me')).body.user.role).toBe('USER');
    expect((await db.user.findFirstOrThrow({ where: { providerSubject: 'student1' } })).role).toBe(
      'USER',
    );
  });

  it('revoking the role takes effect on the next request', async () => {
    await db.user.updateMany({ where: { providerSubject: 'dgssac' }, data: { role: 'USER' } });
    expect((await admin.agent.get('/api/v1/admin/overview')).status).toBe(403);
  });
});

describe('overview and listings', () => {
  it('summarises capacity and bookings', async () => {
    const trip = await tripOn(MON, '10:00');
    await bookAs('a1', trip.id);
    const { s, reference } = await bookAs('a2', trip.id);
    await post(s, `/api/v1/bookings/${reference}/cancel`);
    const res = await admin.agent.get(`/api/v1/admin/overview?from=${MON}&to=${MON}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalBookings: 1,
      cancelledBookings: 1,
      seatsFilled: 1,
      seatsRemaining: 24 + 24 + 13 * 4 - 1,
      tripsAtCapacity: 0,
      provisionalTemplates: 0,
    });
  });

  it('searches, filters and paginates bookings', async () => {
    const trip = await tripOn(MON, '10:00');
    const { reference } = await bookAs('cs1200001', trip.id);
    await bookAs('cs1200002', trip.id);
    await bookAs('ee1200003', (await tripOn(MON, '13:00', 'SONIPAT')).id);

    const byRef = await admin.agent.get(`/api/v1/admin/bookings?q=${reference.toLowerCase()}`);
    expect(byRef.body.items.map((b: { reference: string }) => b.reference)).toEqual([reference]);
    const byUser = await admin.agent.get('/api/v1/admin/bookings?q=cs12');
    expect(byUser.body.total).toBe(2);
    expect(byUser.body.items[0]).toMatchObject({
      userEmail: expect.stringMatching(/@iitd\.ac\.in$/),
      status: 'CONFIRMED',
    });
    const byDir = await admin.agent.get('/api/v1/admin/bookings?direction=SONIPAT_TO_DELHI');
    expect(byDir.body.total).toBe(1);
    const page2 = await admin.agent.get('/api/v1/admin/bookings?pageSize=2&page=2');
    expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(page2.body.items).toHaveLength(1);
  });

  it('exports CSV with formula-injection protection and audits the export', async () => {
    const trip = await tripOn(MON, '10:00');
    await bookAs('x1', trip.id);
    await db.user.updateMany({
      where: { providerSubject: 'x1' },
      data: { name: '=HYPERLINK("http://evil")' },
    });
    const res = await admin.agent.get(`/api/v1/admin/bookings/export.csv?from=${MON}&to=${MON}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="bookings-2026-10-14\.csv"/,
    );
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM so Excel reads names correctly
    const lines = res.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toContain('Booking reference');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'BOOKINGS_EXPORTED' } });
    expect(JSON.parse(log.metadata!)).toMatchObject({ rowCount: 1 });
  });

  it('escapes CSV cells', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(null)).toBe('');
  });
});

describe('booking management', () => {
  it('cancels a booking with a required reason, releases the seat, emails and audits', async () => {
    const trip = await tripOn(MON, '10:00');
    const { s, reference } = await bookAs('p1', trip.id);
    expect((await post(admin, `/api/v1/admin/bookings/${reference}/cancel`, {})).status).toBe(400);
    const res = await post(admin, `/api/v1/admin/bookings/${reference}/cancel`, {
      reason: 'Duplicate request',
    });
    expect(res.status).toBe(200);
    expect(res.body.booking).toMatchObject({
      status: 'CANCELLED',
      cancelledByAdmin: true,
      cancellationReason: 'Duplicate request',
    });
    expect((await db.trip.findUniqueOrThrow({ where: { id: trip.id } })).bookedCount).toBe(0);
    expect(await db.notificationOutbox.count({ where: { type: 'BOOKING_CANCELLATION' } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: 'BOOKING_CANCELLED' } })).toBe(1);
    const mine = await s.agent.get(`/api/v1/bookings/${reference}`);
    expect(mine.body.booking).toMatchObject({ status: 'CANCELLED', cancelledByAdmin: true });
  });

  it('shows a booking with its notifications', async () => {
    const { reference } = await bookAs('p1', (await tripOn(MON, '10:00')).id);
    const res = await admin.agent.get(`/api/v1/admin/bookings/${reference}`);
    expect(res.body.booking.userSubject).toBe('p1');
    expect(res.body.notifications[0]).toMatchObject({
      type: 'BOOKING_CONFIRMATION',
      status: 'PENDING',
    });
  });
});

describe('trip management', () => {
  it('cancels a trip, cancels its bookings, notifies each passenger once and blocks new bookings', async () => {
    const trip = await tripOn(MON, '10:00');
    await bookAs('p1', trip.id);
    await bookAs('p2', trip.id);
    const res = await post(admin, `/api/v1/admin/trips/${trip.id}/cancel`, {
      reason: 'Institute holiday',
    });
    expect(res.status).toBe(200);
    expect(res.body.affectedBookings).toBe(2);
    expect(res.body.trip).toMatchObject({
      status: 'CANCELLED',
      availability: 'CANCELLED',
      bookedCount: 0,
    });
    expect(await db.booking.count({ where: { tripId: trip.id, status: 'CANCELLED' } })).toBe(2);
    expect(await db.notificationOutbox.count({ where: { type: 'TRIP_CANCELLATION' } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: 'TRIP_CANCELLED' } })).toBe(1);

    const p3 = await signIn(t, identity('p3'));
    const book = await post(p3, `/api/v1/trips/${trip.id}/bookings`, SELF_BOOKING);
    expect(book.body.error.code).toBe('TRIP_CANCELLED');
    expect(
      (await post(admin, `/api/v1/admin/trips/${trip.id}/cancel`, { reason: 'again' })).status,
    ).toBe(409);
  });

  it('refuses to lower capacity below confirmed bookings', async () => {
    const trip = await tripOn(MON, '10:00');
    await bookAs('p1', trip.id);
    await bookAs('p2', trip.id);
    const low = await patch(admin, `/api/v1/admin/trips/${trip.id}`, { capacity: 1 });
    expect(low.status).toBe(409);
    expect(low.body.error.code).toBe('CAPACITY_BELOW_BOOKED');
    const ok = await patch(admin, `/api/v1/admin/trips/${trip.id}`, { capacity: 2 });
    expect(ok.status).toBe(200);
    expect(ok.body.trip).toMatchObject({ capacity: 2, availability: 'FULL' });
    expect(await db.auditLog.count({ where: { action: 'TRIP_UPDATED' } })).toBe(1);
  });

  it('refuses to change the departure time of a trip that has bookings', async () => {
    const trip = await tripOn(MON, '10:00');
    await bookAs('p1', trip.id);
    const res = await patch(admin, `/api/v1/admin/trips/${trip.id}`, { departureTime: '11:00' });
    expect(res.status).toBe(409);
    const empty = await tripOn(MON, '17:00');
    const ok = await patch(admin, `/api/v1/admin/trips/${empty.id}`, { departureTime: '17:15' });
    expect(ok.body.trip).toMatchObject({
      departureTime: '17:15',
      departureAt: '2026-10-19T11:45:00.000Z',
    });
  });

  it('validates booking windows', async () => {
    const trip = await tripOn(MON, '10:00');
    const res = await patch(admin, `/api/v1/admin/trips/${trip.id}`, {
      bookingClosesAt: '2026-10-19T05:00:00+00:00', // after the 04:30Z departure
    });
    expect(res.status).toBe(400);
  });

  it('generates trips idempotently and audits it', async () => {
    const a = await post(admin, '/api/v1/admin/trips/generate', { horizonDays: 13 });
    expect(a.body.created).toBe(0);
    const b = await post(admin, '/api/v1/admin/trips/generate', { horizonDays: 20 });
    expect(b.body.created).toBeGreaterThan(0);
    expect(await db.auditLog.count({ where: { action: 'TRIPS_GENERATED' } })).toBe(2);
  });
});

describe('templates', () => {
  it('confirms a provisional departure time', async () => {
    const tpl = await db.serviceTemplate.update({
      where: { code: 'BUS2-1330-SNP-DEL' },
      data: { timeProvisional: true },
    });
    await db.trip.updateMany({
      where: { serviceTemplateId: tpl.id },
      data: { timeProvisional: true },
    });
    const res = await patch(admin, `/api/v1/admin/templates/${tpl.id}`, {
      timeConfirmed: true,
      applyToUnbookedTrips: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.template.timeProvisional).toBe(false);
    expect(
      await db.trip.count({ where: { serviceTemplateId: tpl.id, timeProvisional: true } }),
    ).toBe(0);
    expect(await db.auditLog.count({ where: { action: 'TEMPLATE_TIME_CONFIRMED' } })).toBe(1);
  });

  it('applies time changes only to future unbooked trips when asked', async () => {
    const tpl = await db.serviceTemplate.findUniqueOrThrow({
      where: { code: 'BUS2-1330-SNP-DEL' },
    });
    const booked = await tripOn(MON, '13:00', 'SONIPAT');
    await bookAs('p1', booked.id);

    const noApply = await patch(admin, `/api/v1/admin/templates/${tpl.id}`, {
      departureTime: '01:30',
    });
    expect(noApply.body.refreshedTrips).toBe(0);
    expect(
      await db.trip.count({ where: { serviceTemplateId: tpl.id, departureTime: '01:30' } }),
    ).toBe(0);

    const apply = await patch(admin, `/api/v1/admin/templates/${tpl.id}`, {
      departureTime: '01:30',
      applyToUnbookedTrips: true,
    });
    expect(apply.body.refreshedTrips).toBeGreaterThan(0);
    const bookedAfter = await db.trip.findUniqueOrThrow({ where: { id: booked.id } });
    expect(bookedAfter.departureTime).toBe('13:00'); // never silently rewritten
  });

  it('rejects impossible cutoff settings', async () => {
    const tpl = await db.serviceTemplate.findUniqueOrThrow({
      where: { code: 'BUS2-1000-DEL-SNP' },
    });
    const res = await patch(admin, `/api/v1/admin/templates/${tpl.id}`, {
      cutoffRule: 'PREVIOUS_CALENDAR_DAY',
      bookingOpenDaysBefore: 1,
      bookingOpenTime: '17:00',
    });
    expect(res.status).toBe(400);
  });
});

describe('notifications and audit log', () => {
  it('retries only FAILED notifications and audits the retry', async () => {
    await bookAs('p1', (await tripOn(MON, '10:00')).id);
    const n = await db.notificationOutbox.findFirstOrThrow();
    expect((await post(admin, `/api/v1/admin/notifications/${n.id}/retry`)).status).toBe(409);
    await db.notificationOutbox.update({
      where: { id: n.id },
      data: { status: 'FAILED', attemptCount: 8, nextAttemptAt: null },
    });
    const res = await post(admin, `/api/v1/admin/notifications/${n.id}/retry`);
    expect(res.status).toBe(200);
    expect(await db.notificationOutbox.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    });
    expect(await db.auditLog.count({ where: { action: 'NOTIFICATION_RETRIED' } })).toBe(1);
    const list = await admin.agent.get('/api/v1/admin/notifications?status=PENDING');
    expect(list.body.items[0]).toMatchObject({
      type: 'BOOKING_CONFIRMATION',
      recipient: 'p1@iitd.ac.in',
    });
  });

  it('records admin sign-in and actions with actor and never stores secrets', async () => {
    const res = await admin.agent.get('/api/v1/admin/audit-logs');
    const actions = res.body.items.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['ADMIN_SIGN_IN', 'ROLE_GRANTED']));
    const signInLog = res.body.items.find((a: { action: string }) => a.action === 'ADMIN_SIGN_IN');
    expect(signInLog).toMatchObject({ actorName: 'DGS SAC', actorSubject: 'dgssac' });
    const all = JSON.stringify(await db.auditLog.findMany());
    expect(all).not.toMatch(/csrf|access_token|bus_sid/i);
  });

  it("returns a user's trips from the last 6 months and leaves older ones out", async () => {
    const recent = await bookAs('ee1', (await tripOn(MON, '10:00')).id);
    const older = await bookAs('ee1', (await tripOn('2026-10-20', '10:00')).id);
    await db.trip.update({
      where: { id: (await tripOn('2026-10-20', '10:00')).id },
      data: { travelDate: '2025-01-15' },
    });
    const user = await db.user.findFirstOrThrow({ where: { providerSubject: 'ee1' } });
    const res = await admin.agent.get(`/api/v1/admin/users/${user.id}/travel`);
    expect(res.status).toBe(200);
    expect(res.body.from).toBe('2026-04-14');
    expect(res.body.entries.map((e: { reference: string }) => e.reference)).toEqual([
      recent.reference,
    ]);
    expect(res.body.entries[0]).toMatchObject({
      travelDate: MON,
      passengerType: 'SELF',
      status: 'CONFIRMED',
    });
    expect(res.body.entries.some((e: { reference: string }) => e.reference === older.reference)).toBe(
      false,
    );
    expect((await admin.agent.get('/api/v1/admin/users/missing/travel')).status).toBe(404);
  });
});
