import type { Booking, Prisma, Trip, User } from '@prisma/client';
import type { NotificationType } from '@iitd-bus/shared';
import { enqueueNotification, type NotificationPayload } from '../email/outbox';
import { toPassengerDto } from './dto';

type Tx = Prisma.TransactionClient;

export function tripPayload(trip: Trip) {
  return {
    travelDate: trip.travelDate,
    origin: trip.origin,
    destination: trip.destination,
    departureTime: trip.departureTime,
    serviceLabel: trip.serviceLabel,
    capacity: trip.capacity,
  };
}

/**
 * Queues a booking email to the account holder and, for guest bookings with an email
 * address, a copy to the guest. Each recipient has its own dedupe key, so the same
 * logical notification is never queued twice.
 */
export async function notifyBooking(
  tx: Tx,
  type: NotificationType,
  booking: Booking,
  trip: Trip,
  owner: Pick<User, 'name' | 'email' | 'providerSubject'>,
  extra: Partial<NotificationPayload> = {},
  dedupeSuffix = '',
): Promise<void> {
  const p = toPassengerDto(booking, owner.providerSubject);
  const base: NotificationPayload = {
    name: owner.name,
    reference: booking.bookingReference,
    status: booking.status as NotificationPayload['status'],
    ...tripPayload(trip),
    passenger: {
      name: p.name,
      type: p.type,
      phone: p.phone,
      guestPhone: p.guestPhone,
      purpose: p.purpose,
      purposeDetail: p.purposeDetail,
      idType: p.idType,
      idMasked: p.idNumberMasked,
      bookedBy: owner.name,
    },
    cancellationDeadline: trip.cancellationClosesAt.toISOString(),
    ...extra,
  };
  const key = `${type}:${booking.id}${dedupeSuffix}`;
  await enqueueNotification(tx, {
    type,
    dedupeKey: key,
    recipient: owner.email,
    bookingId: booking.id,
    tripId: trip.id,
    payload: base,
  });
  if (
    booking.passengerType === 'GUEST' &&
    booking.passengerEmail &&
    booking.passengerEmail !== owner.email
  ) {
    await enqueueNotification(tx, {
      type,
      dedupeKey: `${key}:guest`,
      recipient: booking.passengerEmail,
      bookingId: booking.id,
      tripId: trip.id,
      payload: { ...base, name: booking.passengerName, guestCopy: true },
    });
  }
}
