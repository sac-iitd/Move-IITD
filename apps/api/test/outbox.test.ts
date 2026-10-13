import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { istToUtc } from '@iitd-bus/shared';
import { createBooking, cancelBooking } from '../src/bookings/service';
import { MemoryMailer } from '../src/email/mailer';
import { backoffMs, processOutbox, sanitizeError, type OutboxDeps } from '../src/email/worker';
import { renderEmail } from '../src/email/templates';
import { createLogger } from '../src/lib/logger';
import { generateTrips } from '../src/trips/generate';
import { seedServiceTemplates } from '../src/trips/templates-seed';
import { resetDb, testPrisma } from './helpers';
import { SELF_BOOKING } from './app-helpers';

const db = testPrisma();
const NOW = istToUtc('2026-10-14', '09:00');
let clock: Date;
let mailer: MemoryMailer;
let deps: OutboxDeps;

async function setupBooking(email: string | null = 'asha@iitd.ac.in') {
  const user = await db.user.create({
    data: {
      authProvider: 'kebros',
      providerSubject: `s${Math.random()}`,
      name: 'Asha Kumar',
      email,
    },
  });
  const trip = await db.trip.findFirstOrThrow({
    where: { travelDate: '2026-10-19', departureTime: '10:00' },
  });
  const { booking } = await createBooking(db, {
    user,
    tripId: trip.id,
    request: SELF_BOOKING,
    now: NOW,
  });
  return { user, trip, booking };
}

beforeEach(async () => {
  await resetDb();
  await seedServiceTemplates(db, '2026-01-01');
  await generateTrips(db, { now: NOW, horizonDays: 13 });
  clock = NOW;
  mailer = new MemoryMailer();
  deps = {
    prisma: db,
    mailer,
    logger: createLogger('silent'),
    webOrigin: 'https://bus.iitd.ac.in',
    maxAttempts: 3,
    now: () => clock,
  };
});
afterAll(() => db.$disconnect());

describe('confirmation email', () => {
  it('is queued only when the booking commits', async () => {
    const trip = await db.trip.findFirstOrThrow({
      where: { travelDate: '2026-10-26', departureTime: '10:00' },
    });
    const user = await db.user.create({
      data: { authProvider: 'kebros', providerSubject: 'x', name: 'X', email: 'x@iitd.ac.in' },
    });
    // Not yet open: booking is rejected and nothing is enqueued.
    await expect(
      createBooking(db, { user, tripId: trip.id, request: SELF_BOOKING, now: NOW }),
    ).rejects.toThrow();
    expect(await db.notificationOutbox.count()).toBe(0);
    expect(await db.booking.count()).toBe(0);
  });

  it('is sent with the required details and marked SENT', async () => {
    const { booking } = await setupBooking();
    const r = await processOutbox(deps);
    expect(r).toEqual({ sent: 1, retried: 0, failed: 0 });
    const [mail] = mailer.sent;
    expect(mail!.to).toBe('asha@iitd.ac.in');
    expect(mail!.subject).toContain(booking.bookingReference);
    for (const s of [
      'Asha Kumar',
      booking.bookingReference,
      'Mon, 19 Oct, 2026',
      '10:00 AM IST',
      'IIT Delhi (Delhi campus)',
      'Sonipat campus',
      'VAN (13 seats)',
      'Please bring your valid ID proof (IIT Delhi ID card)',
      'Emergency contact: 9876543210',
      'Purpose of visit: Academic',
      'Cancel',
      `https://bus.iitd.ac.in/bookings/${booking.bookingReference}`,
    ]) {
      expect(mail!.text).toContain(s);
    }
    expect(mail!.html).toContain(booking.bookingReference);
    const row = await db.notificationOutbox.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'SENT', attemptCount: 1, lastError: null });
    expect(row.sentAt).not.toBeNull();
  });

  it('never re-sends SENT notifications on later runs', async () => {
    await setupBooking();
    await processOutbox(deps);
    clock = new Date(NOW.getTime() + 3_600_000);
    await processOutbox(deps);
    await processOutbox(deps);
    expect(mailer.sent).toHaveLength(1);
  });

  it('retries a transient SMTP failure with backoff without touching the booking', async () => {
    const { booking } = await setupBooking();
    mailer.failNext = 1;
    expect(await processOutbox(deps)).toEqual({ sent: 0, retried: 1, failed: 0 });
    let row = await db.notificationOutbox.findFirstOrThrow();
    expect(row.status).toBe('PENDING');
    expect(row.lastError).toMatch(/421/);
    expect(row.nextAttemptAt!.getTime()).toBe(NOW.getTime() + backoffMs(1));
    expect((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe(
      'CONFIRMED',
    );

    // Not due yet
    expect((await processOutbox(deps)).sent).toBe(0);
    clock = row.nextAttemptAt!;
    expect((await processOutbox(deps)).sent).toBe(1);
    row = await db.notificationOutbox.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(mailer.sent).toHaveLength(1);
  });

  it('marks FAILED after the maximum attempts', async () => {
    await setupBooking();
    mailer.failNext = 10;
    for (let i = 0; i < 3; i++) {
      await processOutbox(deps);
      clock = new Date(clock.getTime() + 2 * 3_600_000);
    }
    const row = await db.notificationOutbox.findFirstOrThrow();
    expect(row).toMatchObject({ status: 'FAILED', attemptCount: 3, nextAttemptAt: null });
    expect(mailer.sent).toHaveLength(0);
  });

  it('concurrent workers deliver each message exactly once', async () => {
    for (let i = 0; i < 5; i++) await setupBooking(`p${i}@iitd.ac.in`);
    await Promise.all([processOutbox(deps), processOutbox(deps), processOutbox(deps)]);
    expect(mailer.sent).toHaveLength(5);
    expect(new Set(mailer.sent.map((m) => m.to)).size).toBe(5);
  });

  it('recovers a stale SENDING claim from a crashed worker', async () => {
    await setupBooking();
    await db.notificationOutbox.updateMany({
      data: { status: 'SENDING', lockedUntil: new Date(NOW.getTime() - 1000), attemptCount: 1 },
    });
    expect((await processOutbox(deps)).sent).toBe(1);
  });

  it('uses a stable Message-ID per logical notification', async () => {
    await setupBooking();
    mailer.failNext = 1;
    await processOutbox(deps);
    clock = new Date(NOW.getTime() + 3_600_000);
    await processOutbox(deps);
    expect(mailer.sent[0]!.messageId).toMatch(/^<BOOKING.CONFIRMATION\..+@iitd-bus\.local>$/);
  });

  it('records users without an email as FAILED instead of dropping silently', async () => {
    await setupBooking(null);
    const row = await db.notificationOutbox.findFirstOrThrow();
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toMatch(/no email/);
  });
});

describe('cancellation emails', () => {
  it('queues exactly one cancellation notification per booking', async () => {
    const { user, booking } = await setupBooking();
    await cancelBooking(db, {
      reference: booking.bookingReference,
      actor: user,
      asAdmin: false,
      now: NOW,
    });
    await processOutbox(deps);
    expect(mailer.sent.map((m) => m.subject.split(':')[0])).toEqual([
      'Booking confirmed',
      'Booking cancelled',
    ]);
    // dedupeKey uniqueness: enqueuing the same logical notification twice is impossible
    await expect(
      db.notificationOutbox.create({
        data: {
          type: 'BOOKING_CANCELLATION',
          dedupeKey: `BOOKING_CANCELLATION:${booking.id}`,
          recipient: 'x',
          payload: '{}',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('guest copies', () => {
  it('do not link guests to a booking page they cannot open', () => {
    const base = {
      name: 'Visiting Prof',
      reference: 'SNP-AAAA-BBBB',
      travelDate: '2026-10-19',
      origin: 'DELHI',
      destination: 'SONIPAT',
      departureTime: '07:30',
      serviceLabel: 'BUS',
    };
    const guest = renderEmail(
      'BOOKING_CONFIRMATION',
      { ...base, guestCopy: true },
      'https://sac.iitd.ac.in/MoveIITD',
    );
    expect(guest.text).not.toContain('/bookings/');
    expect(guest.text).toContain('https://sac.iitd.ac.in/MoveIITD/');
    const owner = renderEmail('BOOKING_CONFIRMATION', base, 'https://sac.iitd.ac.in/MoveIITD');
    expect(owner.text).toContain('https://sac.iitd.ac.in/MoveIITD/bookings/SNP-AAAA-BBBB');
  });
});

describe('templates and sanitisation', () => {
  const payload = {
    name: '<script>alert(1)</script>',
    reference: 'SNP-AAAA-BBBB',
    travelDate: '2026-10-19',
    origin: 'SONIPAT',
    destination: 'DELHI',
    departureTime: '13:30',
    serviceLabel: 'Bus 2',
    reason: 'Holiday',
  };

  it('escapes HTML in user-provided values', () => {
    const e = renderEmail('TRIP_CANCELLATION', payload, 'https://bus.iitd.ac.in');
    expect(e.html).not.toContain('<script>');
    expect(e.html).toContain('&lt;script&gt;');
    expect(e.text).toContain('1:30 PM IST');
    expect(e.text).toContain('Holiday');
  });

  it('strips credentials from stored errors', () => {
    expect(sanitizeError(new Error('Invalid login: password=hunter2 for user'))).not.toContain(
      'hunter2',
    );
    expect(sanitizeError(new Error('a\r\nb'))).toBe('a b');
  });
});
