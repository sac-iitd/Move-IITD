import type { PrismaClient, ServiceTemplate, User } from '@prisma/client';
import {
  SCHEDULE_DEFAULTS,
  VEHICLE_PAUSED_REASON,
  computeTripWindows,
  istDateOf,
  istToUtc,
  routeOf,
  type AdminCreateSpecialTrip,
  type AdminTemplatePatch,
  type AdminTripPatch,
} from '@iitd-bus/shared';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { TX_OPTIONS, isUniqueViolation, withTransientRetry } from '../lib/prisma-errors';
import { markCancelled, promoteWaitlist } from '../bookings/service';
import { notifyBooking } from '../bookings/notify';
import { generateTrips, templateRules, tripDataFromTemplate } from '../trips/generate';

/**
 * Cancels a departure: no new bookings, every confirmed booking and waitlist entry is
 * cancelled (history retained), and each passenger gets one TRIP_CANCELLATION email.
 */
export async function cancelTrip(
  prisma: PrismaClient,
  input: {
    tripId: string;
    actor: User;
    reason: string;
    now: Date;
    temporarilyDiscontinued?: boolean;
  },
) {
  const { tripId, actor, reason, now } = input;
  return withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({ where: { id: tripId } });
      if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');
      const updated = await tx.trip.updateMany({
        where: { id: tripId, status: 'SCHEDULED' },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: reason,
          cancelledById: actor.id,
          bookedCount: 0,
        },
      });
      if (updated.count !== 1) {
        throw new HttpError(
          'CONFLICT',
          trip.status === 'CANCELLED'
            ? 'Trip is already cancelled.'
            : 'Only scheduled trips can be cancelled.',
        );
      }
      const bookings = await tx.booking.findMany({
        where: { tripId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
        include: { user: true },
      });
      for (const b of bookings) {
        await markCancelled(tx, b, { now, reason: `Trip cancelled: ${reason}`, actorId: actor.id });
        await notifyBooking(tx, 'TRIP_CANCELLATION', { ...b, status: 'CANCELLED' }, trip, b.user, {
          reason,
          status: 'CANCELLED',
          ...(input.temporarilyDiscontinued && { temporarilyDiscontinued: true }),
        });
      }
      await audit(tx, {
        actorUserId: actor.id,
        action: 'TRIP_CANCELLED',
        targetType: 'Trip',
        targetId: tripId,
        metadata: {
          reason,
          travelDate: trip.travelDate,
          departureTime: trip.departureTime,
          affectedBookings: bookings.length,
        },
      });
      return { affected: bookings.length };
    }, TX_OPTIONS),
  );
}

/** Edits one generated trip with validation; never strands existing passengers. */
export async function patchTrip(
  prisma: PrismaClient,
  input: { tripId: string; actor: User; patch: AdminTripPatch; now: Date },
) {
  const { tripId, actor, patch, now } = input;
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');
  if (trip.status !== 'SCHEDULED')
    throw new HttpError('CONFLICT', 'Only scheduled trips can be edited.');

  const departureAt = patch.departureTime
    ? istToUtc(trip.travelDate, patch.departureTime)
    : trip.departureAt;
  if (patch.departureTime && patch.departureTime !== trip.departureTime && trip.bookedCount > 0) {
    throw new HttpError(
      'CONFLICT',
      'This trip already has bookings. Changing its time would silently affect passengers. Cancel the trip (which notifies them) instead.',
    );
  }
  const opens = patch.bookingOpensAt ? new Date(patch.bookingOpensAt) : trip.bookingOpensAt;
  const closes = patch.bookingClosesAt ? new Date(patch.bookingClosesAt) : trip.bookingClosesAt;
  const cancelCloses = patch.cancellationClosesAt
    ? new Date(patch.cancellationClosesAt)
    : trip.cancellationClosesAt;
  if (!(opens < closes))
    throw new HttpError('VALIDATION_ERROR', 'Booking must open before it closes.');
  if (closes > departureAt)
    throw new HttpError('VALIDATION_ERROR', 'Booking must close before departure.');
  if (cancelCloses > departureAt)
    throw new HttpError('VALIDATION_ERROR', 'Cancellation must close before departure.');
  if (departureAt <= now)
    throw new HttpError('VALIDATION_ERROR', 'Departure must be in the future.');

  const data = {
    ...(patch.capacity !== undefined && { capacity: patch.capacity }),
    ...(patch.departureTime && { departureTime: patch.departureTime, departureAt }),
    bookingOpensAt: opens,
    bookingClosesAt: closes,
    cancellationClosesAt: cancelCloses,
  };
  // Capacity guard is part of the UPDATE, so a concurrent booking cannot slip past it.
  const res = await prisma.trip.updateMany({
    where: {
      id: tripId,
      status: 'SCHEDULED',
      ...(patch.capacity !== undefined && { bookedCount: { lte: patch.capacity } }),
      ...(patch.departureTime && patch.departureTime !== trip.departureTime && { bookedCount: 0 }),
    },
    data,
  });
  if (res.count !== 1) {
    const fresh = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    if (patch.capacity !== undefined && fresh.bookedCount > patch.capacity) {
      throw new HttpError(
        'CAPACITY_BELOW_BOOKED',
        `Capacity cannot be lower than the ${fresh.bookedCount} confirmed booking(s). Cancel bookings first.`,
        { bookedCount: fresh.bookedCount },
      );
    }
    throw new HttpError('CONFLICT', 'The trip changed while saving. Please reload and try again.');
  }
  // More seats (or a later booking deadline) may let waitlisted passengers in.
  await prisma.$transaction((tx) => promoteWaitlist(tx, tripId, now), TX_OPTIONS);
  const after = await prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
  await audit(prisma, {
    actorUserId: actor.id,
    action: 'TRIP_UPDATED',
    targetType: 'Trip',
    targetId: tripId,
    metadata: {
      changes: patch,
      before: {
        capacity: trip.capacity,
        departureTime: trip.departureTime,
        bookingOpensAt: trip.bookingOpensAt,
        bookingClosesAt: trip.bookingClosesAt,
        cancellationClosesAt: trip.cancellationClosesAt,
      },
    },
  });
  return after;
}

/**
 * Updates a recurring template. Future generation uses the new values; trips
 * already generated keep their snapshot unless `applyToUnbookedTrips` is set,
 * in which case only future SCHEDULED trips with zero bookings are refreshed.
 */
export async function patchTemplate(
  prisma: PrismaClient,
  input: { templateId: string; actor: User; patch: AdminTemplatePatch; now: Date },
) {
  const { templateId, actor, patch, now } = input;
  const before = await prisma.serviceTemplate.findUnique({ where: { id: templateId } });
  if (!before) throw new HttpError('NOT_FOUND', 'Service template not found.');
  const { applyToUnbookedTrips, timeConfirmed, active, ...fields } = patch;
  if (active !== undefined && active !== before.active) {
    throw new HttpError(
      'VALIDATION_ERROR',
      'Use Stop or Continue on the vehicle to change whether it is running.',
    );
  }

  const candidate: ServiceTemplate = {
    ...before,
    ...fields,
    ...(timeConfirmed && { timeProvisional: false }),
  };
  // Validate the combined rules on a sample date so impossible windows are rejected.
  const sample = computeTripWindows('2030-01-08', templateRules(candidate)); // a Tuesday
  if (
    !(sample.bookingOpensAt < sample.bookingClosesAt) ||
    sample.bookingClosesAt > sample.departureAt ||
    sample.cancellationClosesAt > sample.departureAt
  ) {
    throw new HttpError(
      'VALIDATION_ERROR',
      'Booking must open before it closes, and both deadlines must fall before departure.',
    );
  }

  const updated = await prisma.serviceTemplate.update({
    where: { id: templateId },
    data: { ...fields, ...(timeConfirmed && { timeProvisional: false }) },
  });

  let refreshed = 0;
  if (applyToUnbookedTrips) {
    const trips = await prisma.trip.findMany({
      where: {
        serviceTemplateId: templateId,
        status: 'SCHEDULED',
        bookedCount: 0,
        travelDate: { gte: istDateOf(now) },
        bookings: { none: { status: 'CONFIRMED' } },
      },
    });
    for (const t of trips) {
      const data = tripDataFromTemplate(updated, t.travelDate);
      if (data.departureAt <= now) continue;
      const r = await prisma.trip.updateMany({
        where: { id: t.id, bookedCount: 0, status: 'SCHEDULED' },
        data,
      });
      refreshed += r.count;
    }
  }

  await audit(prisma, {
    actorUserId: actor.id,
    action: timeConfirmed ? 'TEMPLATE_TIME_CONFIRMED' : 'TEMPLATE_UPDATED',
    targetType: 'ServiceTemplate',
    targetId: templateId,
    metadata: {
      code: before.code,
      changes: patch,
      before: {
        capacity: before.capacity,
        departureTime: before.departureTime,
        active: before.active,
        timeProvisional: before.timeProvisional,
        bookingOpenDaysBefore: before.bookingOpenDaysBefore,
        bookingOpenTime: before.bookingOpenTime,
        bookingCloseTime: before.bookingCloseTime,
        cancellationCloseTime: before.cancellationCloseTime,
        cutoffRule: before.cutoffRule,
      },
      refreshedTrips: refreshed,
    },
  });
  return { template: updated, refreshedTrips: refreshed };
}

/**
 * Pauses or resumes one regular vehicle (one of the six weekday departures).
 * Pausing cancels every future departure of that vehicle and emails each passenger
 * that the vehicle is temporarily discontinued and their ticket is cancelled.
 * Resuming schedules those future departures again. Cancelled tickets stay cancelled;
 * passengers book again if they still need to travel.
 */
export async function setVehicleRunning(
  prisma: PrismaClient,
  input: { templateId: string; running: boolean; actor: User; now: Date; horizonDays: number },
) {
  const { templateId, running, actor, now, horizonDays } = input;
  const template = await prisma.serviceTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new HttpError('NOT_FOUND', 'Service template not found.');
  if (template.active === running) {
    throw new HttpError(
      'CONFLICT',
      running ? 'This vehicle is already running.' : 'This vehicle is already stopped.',
    );
  }
  await prisma.serviceTemplate.update({ where: { id: templateId }, data: { active: running } });

  let affectedBookings = 0;
  let tripsChanged = 0;
  if (!running) {
    const trips = await prisma.trip.findMany({
      where: { serviceTemplateId: templateId, status: 'SCHEDULED', departureAt: { gt: now } },
      select: { id: true },
    });
    for (const t of trips) {
      const r = await cancelTrip(prisma, {
        tripId: t.id,
        actor,
        reason: VEHICLE_PAUSED_REASON,
        now,
        temporarilyDiscontinued: true,
      });
      affectedBookings += r.affected;
      tripsChanged++;
    }
  } else {
    const restored = await prisma.trip.updateMany({
      where: {
        serviceTemplateId: templateId,
        status: 'CANCELLED',
        cancellationReason: VEHICLE_PAUSED_REASON,
        departureAt: { gt: now },
      },
      data: {
        status: 'SCHEDULED',
        cancelledAt: null,
        cancellationReason: null,
        cancelledById: null,
        bookedCount: 0,
      },
    });
    tripsChanged = restored.count;
    const generated = await generateTrips(prisma, { now, horizonDays });
    tripsChanged += generated.created;
  }

  await audit(prisma, {
    actorUserId: actor.id,
    action: running ? 'VEHICLE_RESUMED' : 'VEHICLE_PAUSED',
    targetType: 'ServiceTemplate',
    targetId: templateId,
    metadata: { code: template.code, affectedBookings, tripsChanged },
  });
  const updated = await prisma.serviceTemplate.findUniqueOrThrow({ where: { id: templateId } });
  return { template: updated, affectedBookings, tripsChanged };
}

/**
 * Stops regular service on a date (e.g. a national holiday): records the closure so
 * trips are never generated for it, then cancels every scheduled regular trip that
 * day — each passenger is emailed once. Special (admin-created) trips are kept, so a
 * special bus can still run on a holiday.
 */
export async function createClosure(
  prisma: PrismaClient,
  input: { date: string; reason: string; actor: User; now: Date },
) {
  const { date, reason, actor, now } = input;
  if (date < istDateOf(now)) throw new HttpError('VALIDATION_ERROR', 'The date is in the past.');
  let closure;
  try {
    closure = await prisma.serviceClosure.create({ data: { date, reason, createdById: actor.id } });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new HttpError('CONFLICT', 'Service is already stopped on this date.');
    throw err;
  }
  const trips = await prisma.trip.findMany({
    where: { travelDate: date, status: 'SCHEDULED', isSpecial: false },
    select: { id: true },
  });
  let affectedBookings = 0;
  for (const t of trips) {
    const r = await cancelTrip(prisma, {
      tripId: t.id,
      actor,
      reason: `No service: ${reason}`,
      now,
    });
    affectedBookings += r.affected;
  }
  await audit(prisma, {
    actorUserId: actor.id,
    action: 'SERVICE_CLOSURE_CREATED',
    targetType: 'ServiceClosure',
    targetId: closure.id,
    metadata: { date, reason, cancelledTrips: trips.length, affectedBookings },
  });
  return { closure, cancelledTrips: trips.length, affectedBookings };
}

/**
 * Removes a closure so regular trips are generated for the date again. Trips that were
 * already cancelled stay cancelled (passengers were told), so only missing trips return.
 */
export async function removeClosure(
  prisma: PrismaClient,
  input: { id: string; actor: User; now: Date; horizonDays: number },
) {
  const closure = await prisma.serviceClosure.findUnique({ where: { id: input.id } });
  if (!closure) throw new HttpError('NOT_FOUND', 'Closure not found.');
  await prisma.serviceClosure.delete({ where: { id: closure.id } });
  const generated = await generateTrips(prisma, { now: input.now, horizonDays: input.horizonDays });
  const stillCancelled = await prisma.trip.count({
    where: { travelDate: closure.date, status: 'CANCELLED', isSpecial: false },
  });
  await audit(prisma, {
    actorUserId: input.actor.id,
    action: 'SERVICE_CLOSURE_REMOVED',
    targetType: 'ServiceClosure',
    targetId: closure.id,
    metadata: {
      date: closure.date,
      reason: closure.reason,
      tripsRegenerated: generated.created,
      stillCancelled,
    },
  });
  return { tripsRegenerated: generated.created, stillCancelled };
}

/**
 * Adds a one-off trip on any date (weekends and holidays included). Booking deadlines
 * default to the standard rules (open 7 days before at 00:00, close 4 PM the calendar day
 * before, even when that is a weekend) and can be overridden, e.g. for a bus announced at
 * short notice.
 */
export async function createSpecialTrip(
  prisma: PrismaClient,
  input: { trip: AdminCreateSpecialTrip; actor: User; now: Date },
) {
  const { trip: t, actor, now } = input;
  const w = computeTripWindows(t.travelDate, {
    ...SCHEDULE_DEFAULTS,
    cutoffRule: 'PREVIOUS_CALENDAR_DAY',
    departureTime: t.departureTime,
  });
  const opens = t.bookingOpensAt ? new Date(t.bookingOpensAt) : w.bookingOpensAt;
  const closes = t.bookingClosesAt ? new Date(t.bookingClosesAt) : w.bookingClosesAt;
  const cancelCloses = t.cancellationClosesAt
    ? new Date(t.cancellationClosesAt)
    : t.bookingClosesAt
      ? closes
      : w.cancellationClosesAt;

  if (w.departureAt <= now)
    throw new HttpError('VALIDATION_ERROR', 'Departure must be in the future.');
  if (!(opens < closes))
    throw new HttpError('VALIDATION_ERROR', 'Booking must open before it closes.');
  if (closes > w.departureAt || cancelCloses > w.departureAt) {
    throw new HttpError(
      'VALIDATION_ERROR',
      'Booking and cancellation must close before departure.',
    );
  }
  if (closes <= now) {
    throw new HttpError(
      'VALIDATION_ERROR',
      'The default booking deadline (4 PM the day before) has already passed. Set a later "booking closes" time.',
    );
  }

  const trip = await prisma.trip.create({
    data: {
      serviceTemplateId: null,
      isSpecial: true,
      serviceLabel: t.serviceLabel,
      travelDate: t.travelDate,
      ...routeOf(t.direction),
      departureTime: t.departureTime,
      departureAt: w.departureAt,
      capacity: t.capacity,
      bookingOpensAt: opens,
      bookingClosesAt: closes,
      cancellationClosesAt: cancelCloses,
    },
  });
  await audit(prisma, {
    actorUserId: actor.id,
    action: 'SPECIAL_TRIP_CREATED',
    targetType: 'Trip',
    targetId: trip.id,
    metadata: { ...t },
  });
  return trip;
}
