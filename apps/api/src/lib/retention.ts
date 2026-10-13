import type { PrismaClient } from '@prisma/client';
import { addDays, istDateOf } from '@iitd-bus/shared';

/**
 * Erases personal contact and ID data PII_RETENTION_DAYS after the trip: phone numbers,
 * guest emails and encrypted ID numbers on bookings, and old email payloads. Booking
 * records themselves (reference, trip, name, status) are kept for history.
 */
export async function purgePersonalData(prisma: PrismaClient, now: Date, retentionDays: number) {
  const cutoffDate = addDays(istDateOf(now), -retentionDays);
  const bookings = await prisma.booking.updateMany({
    where: { piiPurgedAt: null, trip: { travelDate: { lt: cutoffDate } } },
    data: {
      phone: null,
      guestPhone: null,
      passengerEmail: null,
      idNumberEnc: null,
      piiPurgedAt: now,
    },
  });
  const outbox = await prisma.notificationOutbox.updateMany({
    where: {
      status: { in: ['SENT', 'FAILED'] },
      createdAt: { lt: new Date(now.getTime() - retentionDays * 86_400_000) },
      NOT: { payload: '{}' },
    },
    data: { payload: '{}' },
  });
  return { bookings: bookings.count, notifications: outbox.count };
}
