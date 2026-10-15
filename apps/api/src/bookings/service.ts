import crypto from 'node:crypto';
import type { Booking, Prisma, PrismaClient, Trip, User } from '@prisma/client';
import {
  MAX_SEATS_PER_TRIP,
  bookingAvailability,
  formatTravelDate,
  istDateOf,
  type BookingAvailability,
  type CreateBookingInput,
  type CreateBookingsInput,
  type ErrorCode,
  type TripStatus,
} from '@iitd-bus/shared';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { encryptIdNumber } from '../lib/id-cipher';
import { TX_OPTIONS, isUniqueViolation, withTransientRetry } from '../lib/prisma-errors';
import { activeBlockOn } from '../blocks/query';
import { generateBookingReference } from './reference';
import { notifyBooking } from './notify';
import { waitlistPositions, type BookingWithRelations } from './dto';

type Tx = Prisma.TransactionClient;

const AVAILABILITY_ERROR: Record<Exclude<BookingAvailability, 'OPEN'>, ErrorCode> = {
  NOT_OPEN: 'BOOKING_NOT_OPEN',
  CLOSED: 'BOOKING_CLOSED',
  FULL: 'TRIP_FULL',
  CANCELLED: 'TRIP_CANCELLED',
  DEPARTED: 'TRIP_DEPARTED',
  NOT_OPERATIONAL: 'TRIP_NOT_OPERATIONAL',
};

export const bookingInclude = {
  trip: true,
  user: { select: { providerSubject: true } },
  notifications: { select: { type: true, status: true } },
} as const;

const ACTIVE = ['CONFIRMED', 'WAITLISTED'];
const SLOTS = ['SEAT1', 'SEAT2'] as const;

function availabilityOf(trip: Trip, now: Date) {
  return bookingAvailability({ ...trip, status: trip.status as TripStatus }, now);
}

function blockedError(block: { endsOn: string; reason: string }) {
  return new HttpError(
    'USER_BLOCKED',
    `Your booking access is blocked until ${formatTravelDate(block.endsOn)}: ${block.reason}`,
    { until: block.endsOn },
  );
}

export interface CreateBookingResult {
  booking: BookingWithRelations;
  created: boolean;
  waitlistPosition: number | null;
}

/**
 * Books a seat (or a waitlist place) on a trip. All rules are enforced here:
 * trip scheduled, booking window open (bookingOpensAt <= now < bookingClosesAt), Mon–Fri
 * unless special, user not blocked, at most 2 active bookings per account per trip, and at
 * most one of them for the account holder.
 *
 * Concurrency: a seat is claimed by one conditional UPDATE (`bookedCount < capacity` plus
 * window/status checks), atomic on SQLite and MySQL/InnoDB. The per-account limit is enforced
 * by unique (user, trip, activeSlot ∈ {SEAT1, SEAT2}) and (user, trip, selfSlot = SELF)
 * constraints, so parallel requests cannot exceed it. Booking row, seat claim and emails are
 * one transaction.
 */
export async function createBooking(
  prisma: PrismaClient,
  input: {
    user: User;
    tripId: string;
    request: CreateBookingInput;
    idempotencyKey?: string;
    now: Date;
  },
): Promise<CreateBookingResult> {
  const { user, tripId, request, idempotencyKey, now } = input;

  const replay = async (): Promise<CreateBookingResult | undefined> => {
    if (!idempotencyKey) return undefined;
    const existing = await prisma.booking.findUnique({
      where: { userId_idempotencyKey: { userId: user.id, idempotencyKey } },
      include: bookingInclude,
    });
    if (!existing) return undefined;
    if (existing.tripId !== tripId) {
      throw new HttpError('CONFLICT', 'This request key was already used for a different trip.');
    }
    const positions = await waitlistPositions(prisma, [tripId]);
    return {
      booking: existing,
      created: false,
      waitlistPosition: positions.get(existing.id) ?? null,
    };
  };

  const replayed = await replay();
  if (replayed) return replayed;

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');

  const block = await activeBlockOn(prisma, user.id, [istDateOf(now), trip.travelDate]);
  if (block) throw blockedError(block);

  await assertSeatAllowance(prisma, user.id, tripId, request.passengerType);

  const availability = availabilityOf(trip, now);
  const wantsWaitlist = request.joinWaitlist === true;
  if (availability === 'FULL' && !wantsWaitlist) {
    throw new HttpError('TRIP_FULL', 'This trip is fully booked. You can join the waiting list.', {
      canWaitlist: true,
    });
  }
  if (availability !== 'OPEN' && availability !== 'FULL')
    throw new HttpError(AVAILABILITY_ERROR[availability]);

  const passenger = passengerFields(user, request);

  const attempt = () =>
    withTransientRetry(() =>
      prisma.$transaction(async (tx) => {
        const slot = await freeSlot(tx, user.id, tripId);
        if (!slot) throw new HttpError('SEAT_LIMIT');

        const claimed = await tx.trip.updateMany({
          where: {
            id: tripId,
            status: 'SCHEDULED',
            bookingOpensAt: { lte: now },
            bookingClosesAt: { gt: now },
            departureAt: { gt: now },
            bookedCount: { lt: tx.trip.fields.capacity },
          },
          data: { bookedCount: { increment: 1 } },
        });
        let status: 'CONFIRMED' | 'WAITLISTED' = 'CONFIRMED';
        if (claimed.count !== 1) {
          const fresh = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
          // Under MySQL REPEATABLE READ this plain read can return the transaction's earlier
          // snapshot (seats still free). The claim's other conditions (scheduled, window open,
          // not departed) are visible in that snapshot too, so if they hold, capacity failed.
          const seen = availabilityOf(fresh, now);
          const a = seen === 'OPEN' ? 'FULL' : seen;
          if (a === 'FULL' && wantsWaitlist) status = 'WAITLISTED';
          else if (a === 'FULL') throw new HttpError('TRIP_FULL', undefined, { canWaitlist: true });
          else throw new HttpError(AVAILABILITY_ERROR[a]);
        }

        const booking = await createWithUniqueReference(tx, {
          ...passenger,
          userId: user.id,
          tripId,
          status,
          activeSlot: slot,
          idempotencyKey: idempotencyKey ?? null,
          bookedAt: now,
          createdAt: now,
        });
        const updatedTrip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
        const positions = await waitlistPositions(tx, [tripId]);
        const position = positions.get(booking.id) ?? null;
        await notifyBooking(
          tx,
          status === 'CONFIRMED' ? 'BOOKING_CONFIRMATION' : 'WAITLIST_JOINED',
          booking,
          updatedTrip,
          user,
          position ? { waitlistPosition: position } : {},
        );
        const full = await tx.booking.findUniqueOrThrow({
          where: { id: booking.id },
          include: bookingInclude,
        });
        return { booking: full, created: true, waitlistPosition: position };
      }, TX_OPTIONS),
    );

  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (err) {
      if (isUniqueViolation(err, 'idempotencyKey')) {
        const again = await replay();
        if (again) return again;
      }
      if (isUniqueViolation(err, 'selfSlot')) {
        throw new HttpError(
          'ALREADY_BOOKED',
          'You already have a booking for yourself on this trip.',
        );
      }
      // Two parallel requests picked the same free slot: re-check and retry once.
      if (isUniqueViolation(err, 'activeSlot') && tries === 0) continue;
      if (isUniqueViolation(err, 'activeSlot')) throw new HttpError('SEAT_LIMIT');
      throw err;
    }
  }
}

export interface CreateBookingsResult {
  bookings: BookingWithRelations[];
  created: boolean;
  waitlistPositions: (number | null)[];
}

/**
 * Books everyone from one form (the account holder, one guest, or two guests) in a single
 * transaction, so a double-click or a failed second seat never leaves a partial booking.
 * The account holder is emailed about every passenger; each guest is emailed separately.
 */
export async function createBookings(
  prisma: PrismaClient,
  input: {
    user: User;
    tripId: string;
    request: CreateBookingsInput;
    idempotencyKey?: string;
    now: Date;
  },
): Promise<CreateBookingsResult> {
  const { user, tripId, request, idempotencyKey, now } = input;
  const passengers = request.passengers;
  const keys = passengers.map((_, i) =>
    idempotencyKey ? (i === 0 ? idempotencyKey : `${idempotencyKey}#${i + 1}`) : undefined,
  );

  const loadGroup = async (): Promise<CreateBookingsResult | undefined> => {
    if (!idempotencyKey) return undefined;
    const rows = await prisma.booking.findMany({
      where: { userId: user.id, idempotencyKey: { in: keys as string[] } },
      include: bookingInclude,
    });
    if (rows.length === 0) return undefined;
    if (rows.length !== passengers.length || rows.some((r) => r.tripId !== tripId)) {
      throw new HttpError('CONFLICT', 'This request key was already used for a different booking.');
    }
    const ordered = keys.map((k) => rows.find((r) => r.idempotencyKey === k)!);
    const positions = await waitlistPositions(prisma, [tripId]);
    return {
      bookings: ordered,
      created: false,
      waitlistPositions: ordered.map((b) => positions.get(b.id) ?? null),
    };
  };

  const replayed = await loadGroup();
  if (replayed) return replayed;

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');

  const block = await activeBlockOn(prisma, user.id, [istDateOf(now), trip.travelDate]);
  if (block) throw blockedError(block);

  await assertGroupAllowance(prisma, user.id, tripId, passengers);

  const availability = availabilityOf(trip, now);
  const wantsWaitlist = request.joinWaitlist === true;
  const seatsLeft = Math.max(0, trip.capacity - trip.bookedCount);
  if (availability === 'FULL' && !wantsWaitlist) {
    throw new HttpError('TRIP_FULL', 'This trip is fully booked. You can join the waiting list.', {
      canWaitlist: true,
    });
  }
  if (availability === 'OPEN' && seatsLeft < passengers.length && !wantsWaitlist) {
    throw new HttpError(
      'TRIP_FULL',
      `Only ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left on this trip. Book fewer people, or join the waiting list.`,
      { canWaitlist: true },
    );
  }
  if (availability !== 'OPEN' && availability !== 'FULL')
    throw new HttpError(AVAILABILITY_ERROR[availability]);

  const booker = { ...user, name: request.bookerName };

  const attempt = () =>
    withTransientRetry(() =>
      prisma.$transaction(async (tx) => {
        const created = [];
        for (let i = 0; i < passengers.length; i++) {
          const passenger = passengers[i]!;
          const slot = await freeSlot(tx, user.id, tripId);
          if (!slot) throw new HttpError('SEAT_LIMIT');

          const claimed = await tx.trip.updateMany({
            where: {
              id: tripId,
              status: 'SCHEDULED',
              bookingOpensAt: { lte: now },
              bookingClosesAt: { gt: now },
              departureAt: { gt: now },
              bookedCount: { lt: tx.trip.fields.capacity },
            },
            data: { bookedCount: { increment: 1 } },
          });
          let status: 'CONFIRMED' | 'WAITLISTED' = 'CONFIRMED';
          if (claimed.count !== 1) {
            const fresh = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
            const seen = availabilityOf(fresh, now);
            const a = seen === 'OPEN' ? 'FULL' : seen;
            if (a === 'FULL' && wantsWaitlist) status = 'WAITLISTED';
            else if (a === 'FULL')
              throw new HttpError('TRIP_FULL', undefined, { canWaitlist: true });
            else throw new HttpError(AVAILABILITY_ERROR[a]);
          }

          const asSingle: CreateBookingInput = {
            passengerType: passenger.passengerType,
            phone: request.phone,
            purpose: passenger.purpose,
            purposeDetail: passenger.purposeDetail,
            guest: passenger.passengerType === 'GUEST' ? passenger.guest : undefined,
          };
          const fields = passengerFields(
            passenger.passengerType === 'SELF' ? booker : user,
            asSingle,
          );
          const booking = await createWithUniqueReference(tx, {
            ...fields,
            userId: user.id,
            tripId,
            status,
            activeSlot: slot,
            idempotencyKey: keys[i] ?? null,
            bookedAt: now,
            createdAt: now,
          });
          const updatedTrip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
          const positions = await waitlistPositions(tx, [tripId]);
          const position = positions.get(booking.id) ?? null;
          await notifyBooking(
            tx,
            status === 'CONFIRMED' ? 'BOOKING_CONFIRMATION' : 'WAITLIST_JOINED',
            booking,
            updatedTrip,
            booker,
            position ? { waitlistPosition: position } : {},
          );
          const full = await tx.booking.findUniqueOrThrow({
            where: { id: booking.id },
            include: bookingInclude,
          });
          created.push({ booking: full, position });
        }
        return {
          bookings: created.map((c) => c.booking),
          created: true,
          waitlistPositions: created.map((c) => c.position),
        };
      }, TX_OPTIONS),
    );

  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (err) {
      if (isUniqueViolation(err, 'idempotencyKey')) {
        const again = await loadGroup();
        if (again) return again;
      }
      if (isUniqueViolation(err, 'selfSlot')) {
        throw new HttpError(
          'ALREADY_BOOKED',
          'You already have a booking for yourself on this trip.',
        );
      }
      if (isUniqueViolation(err, 'activeSlot') && tries === 0) continue;
      if (isUniqueViolation(err, 'activeSlot')) throw new HttpError('SEAT_LIMIT');
      throw err;
    }
  }
}

async function assertGroupAllowance(
  db: PrismaClient | Tx,
  userId: string,
  tripId: string,
  passengers: CreateBookingsInput['passengers'],
) {
  const active = await db.booking.findMany({
    where: { userId, tripId, status: { in: ACTIVE } },
    select: { bookingReference: true, passengerType: true },
  });
  const wantsSelf = passengers.some((p) => p.passengerType === 'SELF');
  if (wantsSelf && active.some((b) => b.passengerType === 'SELF')) {
    const self = active.find((b) => b.passengerType === 'SELF')!;
    throw new HttpError('ALREADY_BOOKED', 'You already have a booking for yourself on this trip.', {
      reference: self.bookingReference,
    });
  }
  if (active.length + passengers.length > MAX_SEATS_PER_TRIP) throw new HttpError('SEAT_LIMIT');
}

async function assertSeatAllowance(
  db: PrismaClient | Tx,
  userId: string,
  tripId: string,
  type: 'SELF' | 'GUEST',
) {
  const active = await db.booking.findMany({
    where: { userId, tripId, status: { in: ACTIVE } },
    select: { bookingReference: true, passengerType: true },
  });
  if (type === 'SELF') {
    const self = active.find((b) => b.passengerType === 'SELF');
    if (self) {
      throw new HttpError(
        'ALREADY_BOOKED',
        'You already have a booking for yourself on this trip.',
        {
          reference: self.bookingReference,
        },
      );
    }
  }
  if (active.length >= MAX_SEATS_PER_TRIP) throw new HttpError('SEAT_LIMIT');
}

async function freeSlot(tx: Tx, userId: string, tripId: string): Promise<string | null> {
  const used = await tx.booking.findMany({
    where: { userId, tripId, status: { in: ACTIVE } },
    select: { activeSlot: true },
  });
  const taken = new Set(used.map((u) => u.activeSlot));
  return SLOTS.find((s) => !taken.has(s)) ?? null;
}

function passengerFields(user: User, r: CreateBookingInput) {
  const common = {
    phone: r.phone,
    purpose: r.purpose,
    purposeDetail: r.purpose === 'OTHER' ? (r.purposeDetail ?? null) : r.purposeDetail || null,
  };
  if (r.passengerType === 'SELF') {
    return {
      ...common,
      passengerType: 'SELF',
      selfSlot: 'SELF',
      passengerName: user.name,
      passengerEmail: user.email,
      guestPhone: null,
      idType: 'IITD_ID',
      idNumberEnc: null,
      idTypeDetail: null,
    };
  }
  const g = r.guest!;
  return {
    ...common,
    passengerType: 'GUEST',
    // Unique placeholder; becomes the booking id on cancellation.
    selfSlot: `G-${crypto.randomUUID()}`,
    passengerName: g.name,
    passengerEmail: g.email,
    guestPhone: g.phone ?? null,
    idType: g.idType,
    idTypeDetail: g.idTypeDetail,
    idNumberEnc: encryptIdNumber(g.idNumber),
  };
}

async function createWithUniqueReference(
  tx: Tx,
  data: Omit<Prisma.BookingUncheckedCreateInput, 'bookingReference'>,
) {
  // 40-bit references make collisions vanishingly rare, but never fail a booking on one.
  for (let attempt = 0; ; attempt++) {
    const bookingReference = generateBookingReference();
    const clash = await tx.booking.findUnique({
      where: { bookingReference },
      select: { id: true },
    });
    if (clash && attempt < 5) continue;
    return tx.booking.create({ data: { ...data, bookingReference } });
  }
}

/** Loads a booking the actor may see. Non-owners get 404 so references cannot be probed. */
export async function findVisibleBooking(prisma: PrismaClient, reference: string, actor: User) {
  const booking = await prisma.booking.findUnique({
    where: { bookingReference: reference },
    include: bookingInclude,
  });
  if (!booking || (booking.userId !== actor.id && actor.role !== 'ADMIN')) {
    throw new HttpError('NOT_FOUND', 'Booking not found.');
  }
  return booking;
}

/**
 * Moves the oldest waitlisted bookings into free seats, oldest first, while the trip is
 * scheduled and booking is still open (until 4 PM the day before). Each promotion claims
 * the seat with the same conditional UPDATE used for bookings and emails the passenger.
 */
export async function promoteWaitlist(tx: Tx, tripId: string, now: Date): Promise<number> {
  let promoted = 0;
  for (;;) {
    const next = await tx.booking.findFirst({
      where: { tripId, status: 'WAITLISTED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { user: true },
    });
    if (!next) break;
    const claimed = await tx.trip.updateMany({
      where: {
        id: tripId,
        status: 'SCHEDULED',
        bookingClosesAt: { gt: now },
        departureAt: { gt: now },
        bookedCount: { lt: tx.trip.fields.capacity },
      },
      data: { bookedCount: { increment: 1 } },
    });
    if (claimed.count !== 1) break;
    await tx.booking.update({ where: { id: next.id }, data: { status: 'CONFIRMED' } });
    const trip = await tx.trip.findUniqueOrThrow({ where: { id: tripId } });
    await notifyBooking(tx, 'WAITLIST_PROMOTED', { ...next, status: 'CONFIRMED' }, trip, next.user);
    promoted++;
  }
  return promoted;
}

/**
 * Cancels a confirmed booking (releasing the seat and promoting the waitlist) or withdraws
 * a waitlist entry.
 * - Owners: confirmed seats until the cancellation cutoff (2 PM the day before);
 *   waitlist entries until booking closes.
 * - Admins: any active booking, with a reason (audited).
 */
export async function cancelBooking(
  prisma: PrismaClient,
  input: { reference: string; actor: User; asAdmin: boolean; reason?: string; now: Date },
): Promise<BookingWithRelations> {
  const { actor, asAdmin, now } = input;
  const booking = await prisma.booking.findUnique({
    where: { bookingReference: input.reference },
    include: { trip: true, user: true },
  });
  if (!booking || (!asAdmin && booking.userId !== actor.id)) {
    throw new HttpError('NOT_FOUND', 'Booking not found.');
  }
  if (booking.status === 'CANCELLED') throw new HttpError('BOOKING_ALREADY_CANCELLED');
  if (!asAdmin) {
    if (now >= booking.trip.departureAt) throw new HttpError('TRIP_DEPARTED');
    if (booking.status === 'CONFIRMED' && now >= booking.trip.cancellationClosesAt) {
      throw new HttpError('CANCELLATION_CLOSED');
    }
    if (booking.status === 'WAITLISTED' && now >= booking.trip.bookingClosesAt) {
      throw new HttpError('CANCELLATION_CLOSED', 'The waiting list for this trip has closed.');
    }
  }
  const reason = input.reason?.trim() || null;
  const wasConfirmed = booking.status === 'CONFIRMED';

  await withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      const cancelled = await markCancelled(tx, booking, { now, reason, actorId: actor.id });
      if (!cancelled) throw new HttpError('BOOKING_ALREADY_CANCELLED');
      if (wasConfirmed) {
        await tx.trip.updateMany({
          where: { id: booking.tripId, bookedCount: { gt: 0 } },
          data: { bookedCount: { decrement: 1 } },
        });
      }
      await notifyBooking(
        tx,
        'BOOKING_CANCELLATION',
        { ...booking, status: 'CANCELLED' },
        booking.trip,
        booking.user,
        {
          reason: asAdmin ? reason : null,
          cancelledByAdmin: asAdmin,
          status: 'CANCELLED',
          wasWaitlisted: !wasConfirmed,
        },
      );
      if (wasConfirmed) await promoteWaitlist(tx, booking.tripId, now);
      if (asAdmin) {
        await audit(tx, {
          actorUserId: actor.id,
          action: 'BOOKING_CANCELLED',
          targetType: 'Booking',
          targetId: booking.id,
          metadata: {
            reference: booking.bookingReference,
            reason,
            tripId: booking.tripId,
            wasConfirmed,
          },
        });
      }
    }, TX_OPTIONS),
  );

  return prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: bookingInclude });
}

/** Marks an active booking cancelled and frees its slots. Returns false if it was not active. */
export async function markCancelled(
  tx: Tx,
  booking: Pick<Booking, 'id'>,
  opts: { now: Date; reason: string | null; actorId: string | null },
): Promise<boolean> {
  const r = await tx.booking.updateMany({
    where: { id: booking.id, status: { in: ACTIVE } },
    data: {
      status: 'CANCELLED',
      activeSlot: booking.id,
      selfSlot: booking.id,
      cancelledAt: opts.now,
      cancellationReason: opts.reason,
      cancelledById: opts.actorId,
    },
  });
  return r.count === 1;
}

/**
 * Closes waiting lists once booking has closed (4 PM the day before) or the trip is no
 * longer scheduled: remaining entries are cancelled and the passengers emailed.
 */
export async function expireWaitlists(prisma: PrismaClient, now: Date): Promise<number> {
  const stale = await prisma.booking.findMany({
    where: {
      status: 'WAITLISTED',
      OR: [{ trip: { bookingClosesAt: { lte: now } } }, { trip: { status: { not: 'SCHEDULED' } } }],
    },
    include: { trip: true, user: true },
    take: 500,
  });
  let expired = 0;
  for (const b of stale) {
    await prisma.$transaction(async (tx) => {
      const reason = 'No seat became available before booking closed.';
      if (!(await markCancelled(tx, b, { now, reason, actorId: null }))) return;
      await notifyBooking(tx, 'WAITLIST_EXPIRED', { ...b, status: 'CANCELLED' }, b.trip, b.user, {
        reason,
        status: 'CANCELLED',
      });
      expired++;
    }, TX_OPTIONS);
  }
  return expired;
}
