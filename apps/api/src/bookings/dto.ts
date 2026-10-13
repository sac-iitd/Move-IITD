import type { Booking, NotificationOutbox, Prisma, PrismaClient, Trip, User } from '@prisma/client';
import {
  bookingAvailability,
  directionOf,
  maskIdNumber,
  type BookingDto,
  type BookingStatus,
  type Campus,
  type IdType,
  type NotificationStatus,
  type PassengerDto,
  type PassengerType,
  type Purpose,
  type TripDto,
  type TripStatus,
} from '@iitd-bus/shared';
import { decryptIdNumber } from '../lib/id-cipher';

type Db = PrismaClient | Prisma.TransactionClient;

export function toTripDto(
  trip: Trip,
  now: Date,
  myBookings: TripDto['myBookings'] = [],
  waitlistCount = 0,
): TripDto {
  const status = trip.status as TripStatus;
  return {
    id: trip.id,
    serviceLabel: trip.serviceLabel,
    travelDate: trip.travelDate,
    origin: trip.origin as Campus,
    destination: trip.destination as Campus,
    direction: directionOf(trip.origin as Campus, trip.destination as Campus),
    departureTime: trip.departureTime,
    departureAt: trip.departureAt.toISOString(),
    capacity: trip.capacity,
    bookedCount: trip.bookedCount,
    seatsRemaining: Math.max(0, trip.capacity - trip.bookedCount),
    status,
    bookingOpensAt: trip.bookingOpensAt.toISOString(),
    bookingClosesAt: trip.bookingClosesAt.toISOString(),
    cancellationClosesAt: trip.cancellationClosesAt.toISOString(),
    availability: bookingAvailability({ ...trip, status }, now),
    timeProvisional: trip.timeProvisional,
    isSpecial: trip.isSpecial,
    waitlistCount,
    myBookings,
  };
}

/**
 * Confirmed seats: cancellable until the trip's cancellation cutoff (2 PM the day before).
 * Waitlist entries: can be withdrawn until booking closes (they hold no seat).
 */
export function canUserCancel(booking: Booking, trip: Trip, now: Date): boolean {
  if (trip.status !== 'SCHEDULED' || now >= trip.departureAt) return false;
  if (booking.status === 'CONFIRMED') return now < trip.cancellationClosesAt;
  if (booking.status === 'WAITLISTED') return now < trip.bookingClosesAt;
  return false;
}

export type BookingWithRelations = Booking & {
  trip: Trip;
  user?: Pick<User, 'providerSubject'>;
  notifications?: Pick<NotificationOutbox, 'type' | 'status'>[];
};

export function confirmationEmailStatus(
  notifications: Pick<NotificationOutbox, 'type' | 'status'>[] | undefined,
): NotificationStatus | null {
  const n =
    notifications?.find((x) => x.type === 'BOOKING_CONFIRMATION') ??
    notifications?.find((x) => x.type === 'WAITLIST_PROMOTED') ??
    notifications?.find((x) => x.type === 'WAITLIST_JOINED');
  return (n?.status as NotificationStatus | undefined) ?? null;
}

/** Full ID number for admins: Kerberos id for account holders, decrypted Aadhaar/PAN for guests. */
export function fullIdNumber(b: Booking, kerberosId: string | undefined): string | null {
  if (b.idType === 'IITD_ID') return kerberosId ?? null;
  return decryptIdNumber(b.idNumberEnc);
}

export function toPassengerDto(b: Booking, kerberosId?: string): PassengerDto {
  const full = fullIdNumber(b, kerberosId);
  const idType = b.idType as IdType;
  return {
    type: b.passengerType as PassengerType,
    name: b.passengerName,
    email: b.passengerEmail,
    phone: b.phone,
    guestPhone: b.guestPhone,
    purpose: b.purpose as Purpose,
    purposeDetail: b.purposeDetail,
    idType,
    idNumberMasked: full ? (idType === 'IITD_ID' ? full : maskIdNumber(idType, full)) : null,
  };
}

export function toBookingDto(
  b: BookingWithRelations,
  now: Date,
  waitlistPosition: number | null = null,
): BookingDto {
  const status = b.status as BookingStatus;
  return {
    reference: b.bookingReference,
    status,
    bookedAt: b.bookedAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancellationReason: b.cancellationReason,
    cancelledByAdmin: b.cancelledById !== null && b.cancelledById !== b.userId,
    canCancel: canUserCancel(b, b.trip, now),
    trip: toTripDto(
      b.trip,
      now,
      status === 'CANCELLED'
        ? []
        : [
            {
              reference: b.bookingReference,
              status,
              passengerType: b.passengerType as PassengerType,
              passengerName: b.passengerName,
            },
          ],
    ),
    emailStatus: confirmationEmailStatus(b.notifications),
    waitlistPosition: status === 'WAITLISTED' ? waitlistPosition : null,
    passenger: toPassengerDto(b, b.user?.providerSubject),
  };
}

/** 1-based waitlist positions (oldest first) for every waitlisted booking on the given trips. */
export async function waitlistPositions(db: Db, tripIds: string[]): Promise<Map<string, number>> {
  const positions = new Map<string, number>();
  if (tripIds.length === 0) return positions;
  const rows = await db.booking.findMany({
    where: { tripId: { in: tripIds }, status: 'WAITLISTED' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, tripId: true },
  });
  const counters = new Map<string, number>();
  for (const r of rows) {
    const n = (counters.get(r.tripId) ?? 0) + 1;
    counters.set(r.tripId, n);
    positions.set(r.id, n);
  }
  return positions;
}

/** Waitlist sizes per trip. */
export async function waitlistCounts(db: Db, tripIds: string[]): Promise<Map<string, number>> {
  if (tripIds.length === 0) return new Map();
  const groups = await db.booking.groupBy({
    by: ['tripId'],
    where: { tripId: { in: tripIds }, status: 'WAITLISTED' },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.tripId, g._count._all]));
}
