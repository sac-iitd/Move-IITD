import type { PrismaClient, Trip, User } from '@prisma/client';
import {
  DIRECTION_LABELS,
  directionOf,
  formatWallTime,
  tokenFromBoardingScan,
  vehicleNumberOf,
  type BoardingResult,
  type BoardingScanResponse,
  type Campus,
  type ConductorRosterDto,
  type ConductorTripDto,
  type LiveBoardingResponse,
} from '@iitd-bus/shared';
import { HttpError } from '../lib/errors';
import { TX_OPTIONS, withTransientRetry } from '../lib/prisma-errors';

function ticketOf(trip: Trip): NonNullable<BoardingScanResponse['ticket']> {
  const origin = trip.origin as Campus;
  const destination = trip.destination as Campus;
  return {
    travelDate: trip.travelDate,
    departureTime: trip.departureTime,
    serviceLabel: trip.serviceLabel,
    direction: directionOf(origin, destination),
    origin,
    destination,
  };
}

function toConductorTrip(
  trip: Trip & { template?: { code: string } | null },
  boardedCount: number,
): ConductorTripDto {
  const origin = trip.origin as Campus;
  const destination = trip.destination as Campus;
  return {
    id: trip.id,
    serviceLabel: trip.serviceLabel,
    travelDate: trip.travelDate,
    departureTime: trip.departureTime,
    departureAt: trip.departureAt.toISOString(),
    origin,
    destination,
    direction: directionOf(origin, destination),
    capacity: trip.capacity,
    bookedCount: trip.bookedCount,
    boardedCount,
    status: trip.status as ConductorTripDto['status'],
    isSpecial: trip.isSpecial,
    vehicleNumber: vehicleNumberOf(trip.template?.code ?? ''),
  };
}

async function boardedCounts(
  prisma: PrismaClient,
  tripIds: string[],
): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const groups = await prisma.booking.groupBy({
    by: ['tripId'],
    where: { tripId: { in: tripIds }, status: 'CONFIRMED', boardedAt: { not: null } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.tripId, g._count._all]));
}

export async function listBoardingTrips(
  prisma: PrismaClient,
  date: string,
): Promise<ConductorTripDto[]> {
  const trips = await prisma.trip.findMany({
    where: { travelDate: date },
    include: { template: { select: { code: true } } },
    orderBy: [{ departureAt: 'asc' }, { serviceLabel: 'asc' }],
  });
  const counts = await boardedCounts(
    prisma,
    trips.map((t) => t.id),
  );
  return trips.map((t) => toConductorTrip(t, counts.get(t.id) ?? 0));
}

/** Names of people already boarded. No phone, email or ID number. */
export async function conductorRoster(
  prisma: PrismaClient,
  tripId: string,
): Promise<ConductorRosterDto> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { template: { select: { code: true } } },
  });
  if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');
  const boarded = await prisma.booking.findMany({
    where: { tripId, status: 'CONFIRMED', boardedAt: { not: null } },
    orderBy: { boardedAt: 'asc' },
    select: { passengerName: true, boardedAt: true },
  });
  return {
    trip: toConductorTrip(trip, boarded.length),
    boarded: boarded.map((b) => ({
      name: b.passengerName,
      boardedAt: b.boardedAt!.toISOString(),
    })),
  };
}

export async function liveBoarding(
  prisma: PrismaClient,
  date: string,
): Promise<LiveBoardingResponse> {
  const trips = await listBoardingTrips(prisma, date);
  const rows = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', trip: { travelDate: date } },
    include: { boardedBy: { select: { name: true } } },
    orderBy: [{ boardedAt: 'asc' }, { passengerName: 'asc' }],
  });
  const byTrip = new Map<string, LiveBoardingResponse['trips'][number]['passengers']>();
  for (const row of rows) {
    const list = byTrip.get(row.tripId) ?? [];
    list.push({
      reference: row.bookingReference,
      name: row.passengerName,
      status: 'CONFIRMED',
      boardedAt: row.boardedAt?.toISOString() ?? null,
      scannedByName: row.boardedBy?.name ?? null,
    });
    byTrip.set(row.tripId, list);
  }
  return {
    date,
    trips: trips.map((trip) => ({
      trip,
      passengers: byTrip.get(trip.id) ?? [],
    })),
  };
}

function outcome(
  result: BoardingResult,
  message: string,
  passengerName: string | null,
  boardedAt: Date | null,
  ticket: BoardingScanResponse['ticket'],
): BoardingScanResponse {
  return {
    result,
    message,
    passengerName,
    boardedAt: boardedAt?.toISOString() ?? null,
    ticket,
  };
}

/**
 * Checks a scanned code against the departure the conductor selected.
 * A matching confirmed ticket is marked boarded once. Later scans of the same
 * ticket say it was already boarded and do not change who boarded them.
 */
export async function scanBoardingPass(
  prisma: PrismaClient,
  input: { tripId: string; code: string; actor: User; now: Date },
): Promise<BoardingScanResponse> {
  const { tripId, code, actor, now } = input;
  const selected = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!selected) throw new HttpError('NOT_FOUND', 'Trip not found.');

  const token = tokenFromBoardingScan(code);
  const booking = token
    ? await prisma.booking.findUnique({
        where: { boardingToken: token },
        include: { trip: true },
      })
    : null;

  const record = async (result: BoardingResult, bookingId: string | null) => {
    await prisma.boardingScan.create({
      data: { bookingId, tripId, scannedById: actor.id, result, createdAt: now },
    });
  };

  if (selected.status !== 'SCHEDULED') {
    await record('TRIP_CANCELLED', booking?.id ?? null);
    return outcome(
      'TRIP_CANCELLED',
      'This departure has been cancelled, so passes cannot be scanned for it.',
      booking?.passengerName ?? null,
      null,
      ticketOf(selected),
    );
  }

  if (!booking) {
    await record('INVALID', null);
    return outcome('INVALID', 'This QR is not a MoveIITD ticket.', null, null, null);
  }

  const ticket = ticketOf(booking.trip);
  if (booking.tripId !== selected.id) {
    await record('WRONG_TRIP', booking.id);
    const when = `${formatWallTime(booking.trip.departureTime)} ${DIRECTION_LABELS[ticket.direction]} (${booking.trip.serviceLabel})`;
    return outcome(
      'WRONG_TRIP',
      `This ticket is for ${when}, not the vehicle you selected.`,
      booking.passengerName,
      booking.boardedAt,
      ticket,
    );
  }

  if (booking.status === 'CANCELLED' || booking.trip.status === 'CANCELLED') {
    const result: BoardingResult =
      booking.trip.status === 'CANCELLED' ? 'TRIP_CANCELLED' : 'CANCELLED';
    await record(result, booking.id);
    return outcome(
      result,
      result === 'TRIP_CANCELLED'
        ? 'This departure has been cancelled, so this ticket is no longer valid.'
        : 'This ticket has been cancelled.',
      booking.passengerName,
      null,
      ticket,
    );
  }

  if (booking.status !== 'CONFIRMED') {
    await record('NOT_CONFIRMED', booking.id);
    return outcome(
      'NOT_CONFIRMED',
      `${booking.passengerName} is on the waiting list and does not have a seat yet.`,
      booking.passengerName,
      null,
      ticket,
    );
  }

  if (booking.boardedAt) {
    await record('ALREADY_BOARDED', booking.id);
    return outcome(
      'ALREADY_BOARDED',
      `${booking.passengerName} has already boarded.`,
      booking.passengerName,
      booking.boardedAt,
      ticket,
    );
  }

  const boarded = await withTransientRetry(() =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: 'CONFIRMED', tripId: selected.id, boardedAt: null },
        data: { boardedAt: now, boardedById: actor.id },
      });
      if (claimed.count !== 1) return null;
      await tx.boardingScan.create({
        data: {
          bookingId: booking.id,
          tripId: selected.id,
          scannedById: actor.id,
          result: 'BOARDED',
          createdAt: now,
        },
      });
      return now;
    }, TX_OPTIONS),
  );

  if (!boarded) {
    const again = await prisma.booking.findUnique({ where: { id: booking.id } });
    if (again?.boardedAt) {
      await record('ALREADY_BOARDED', booking.id);
      return outcome(
        'ALREADY_BOARDED',
        `${booking.passengerName} has already boarded.`,
        booking.passengerName,
        again.boardedAt,
        ticket,
      );
    }
    await record('CANCELLED', booking.id);
    return outcome(
      'CANCELLED',
      'This ticket has been cancelled.',
      booking.passengerName,
      null,
      ticket,
    );
  }

  return outcome(
    'BOARDED',
    `${booking.passengerName} is boarded.`,
    booking.passengerName,
    boarded,
    ticket,
  );
}
