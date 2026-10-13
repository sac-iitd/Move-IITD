import { Router } from 'express';
import { z } from 'zod';
import {
  addDays,
  createBookingSchema,
  istDateOf,
  idempotencyKeySchema,
  routeOf,
  tripsQuerySchema,
  type CreateBookingResponse,
  type PassengerType,
  type TripDto,
  type TripsResponse,
} from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { requireAuth } from '../auth/middleware';
import { createBooking } from '../bookings/service';
import { toBookingDto, toTripDto, waitlistCounts } from '../bookings/dto';
import { HttpError } from '../lib/errors';
import { bookingRateLimit } from '../lib/rate-limit';

const MAX_RANGE_DAYS = 31;
const idParam = z.string().min(1).max(64);

/** The caller's active bookings and the waitlist size for each trip. */
async function personalise(ctx: AppContext, userId: string, tripIds: string[]) {
  const [mine, counts] = await Promise.all([
    ctx.prisma.booking.findMany({
      where: { userId, status: { in: ['CONFIRMED', 'WAITLISTED'] }, tripId: { in: tripIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        tripId: true,
        bookingReference: true,
        status: true,
        passengerType: true,
        passengerName: true,
      },
    }),
    waitlistCounts(ctx.prisma, tripIds),
  ]);
  const byTrip = new Map<string, TripDto['myBookings']>();
  for (const b of mine) {
    const list = byTrip.get(b.tripId) ?? [];
    list.push({
      reference: b.bookingReference,
      status: b.status as 'CONFIRMED' | 'WAITLISTED',
      passengerType: b.passengerType as PassengerType,
      passengerName: b.passengerName,
    });
    byTrip.set(b.tripId, list);
  }
  return { byTrip, counts };
}

export function tripsRouter(ctx: AppContext) {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req, res) => {
    const q = tripsQuerySchema.parse(req.query);
    const now = ctx.now();
    const today = istDateOf(now);
    const from = q.from && q.from > today ? q.from : today;
    const to = q.to ?? addDays(from, 13);
    if (to < from) throw new HttpError('VALIDATION_ERROR', '`to` must be on or after today');
    if (addDays(from, MAX_RANGE_DAYS) < to) {
      throw new HttpError('VALIDATION_ERROR', `Date range is limited to ${MAX_RANGE_DAYS} days`);
    }
    const trips = await ctx.prisma.trip.findMany({
      where: {
        travelDate: { gte: from, lte: to },
        departureAt: { gt: now },
        status: { in: ['SCHEDULED', 'CANCELLED'] },
        ...(q.direction ? routeOf(q.direction) : {}),
      },
      orderBy: [{ departureAt: 'asc' }, { serviceLabel: 'asc' }],
    });
    const { byTrip, counts } = await personalise(
      ctx,
      req.auth!.user.id,
      trips.map((t) => t.id),
    );
    const body: TripsResponse = {
      trips: trips.map((t) => toTripDto(t, now, byTrip.get(t.id) ?? [], counts.get(t.id) ?? 0)),
      serverTime: now.toISOString(),
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  r.get('/:tripId', async (req, res) => {
    const id = idParam.parse(req.params.tripId);
    const trip = await ctx.prisma.trip.findUnique({ where: { id } });
    if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');
    const { byTrip, counts } = await personalise(ctx, req.auth!.user.id, [id]);
    res
      .set('Cache-Control', 'no-store')
      .json({ trip: toTripDto(trip, ctx.now(), byTrip.get(id) ?? [], counts.get(id) ?? 0) });
  });

  /**
   * Books a seat (or a waiting-list place with joinWaitlist). Send a unique Idempotency-Key
   * header per attempt; retries with the same key return the original booking (200).
   */
  r.post('/:tripId/bookings', bookingRateLimit(ctx), async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const rawKey = req.get('idempotency-key');
    const idempotencyKey = rawKey === undefined ? undefined : idempotencyKeySchema.parse(rawKey);
    const request = createBookingSchema.parse(req.body ?? {});
    const now = ctx.now();
    const result = await createBooking(ctx.prisma, {
      user: req.auth!.user,
      tripId,
      request,
      idempotencyKey,
      now,
    });
    if (result.created) {
      req.log.info(
        { bookingId: result.booking.id, tripId, status: result.booking.status },
        'Booking created',
      );
    }
    const body: CreateBookingResponse = {
      booking: toBookingDto(result.booking, now, result.waitlistPosition),
      created: result.created,
    };
    res.status(result.created ? 201 : 200).json(body);
  });

  return r;
}
