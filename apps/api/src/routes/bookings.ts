import { Router } from 'express';
import {
  bookingReferenceSchema,
  userCancelBookingSchema,
  type MyBookingsResponse,
} from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { requireAuth } from '../auth/middleware';
import { ensureBoardingToken } from '../boarding/token';
import { bookingInclude, cancelBooking, findVisibleBooking } from '../bookings/service';
import { toBookingDto, waitlistPositions } from '../bookings/dto';
import { bookingRateLimit } from '../lib/rate-limit';

export function bookingsRouter(ctx: AppContext) {
  const r = Router();
  r.use(requireAuth);

  r.get('/mine', async (req, res) => {
    const now = ctx.now();
    const bookings = await ctx.prisma.booking.findMany({
      where: { userId: req.auth!.user.id },
      include: bookingInclude,
      orderBy: [{ trip: { departureAt: 'asc' } }, { createdAt: 'asc' }],
      take: 500,
    });
    const withPasses = [];
    for (const booking of bookings) withPasses.push(await ensureBoardingToken(ctx.prisma, booking));
    const positions = await waitlistPositions(ctx.prisma, [
      ...new Set(withPasses.filter((b) => b.status === 'WAITLISTED').map((b) => b.tripId)),
    ]);
    const dtos = withPasses.map((b) => toBookingDto(b, now, positions.get(b.id) ?? null));
    const body: MyBookingsResponse = {
      upcoming: dtos.filter((b) => new Date(b.trip.departureAt) > now),
      past: dtos.filter((b) => new Date(b.trip.departureAt) <= now).reverse(),
    };
    res.set('Cache-Control', 'no-store').json(body);
  });

  r.get('/:reference', async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    // Users see only their own bookings (admins use the admin API for others).
    const booking = await ensureBoardingToken(
      ctx.prisma,
      await findVisibleBooking(ctx.prisma, reference, {
        ...req.auth!.user,
        role: 'USER',
      }),
    );
    const positions = await waitlistPositions(
      ctx.prisma,
      booking.status === 'WAITLISTED' ? [booking.tripId] : [],
    );
    res
      .set('Cache-Control', 'no-store')
      .json({ booking: toBookingDto(booking, ctx.now(), positions.get(booking.id) ?? null) });
  });

  r.post('/:reference/cancel', bookingRateLimit(ctx), async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const { reason } = userCancelBookingSchema.parse(req.body ?? {});
    const now = ctx.now();
    const booking = await cancelBooking(ctx.prisma, {
      reference,
      actor: req.auth!.user,
      asAdmin: false,
      reason,
      now,
    });
    req.log.info({ bookingId: booking.id }, 'Booking cancelled by user');
    res.json({ booking: toBookingDto(booking, now) });
  });

  return r;
}
