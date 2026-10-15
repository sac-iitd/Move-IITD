import type { Prisma, PrismaClient } from '@prisma/client';
import type { NotificationType } from '@iitd-bus/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/** Data needed to render an email. ID numbers are always masked; erased after retention. */
export interface NotificationPayload {
  /** Greeting name of the recipient. */
  name: string;
  reference?: string;
  status?: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  /** Trip fields are absent only for account notices (USER_BLOCKED). */
  travelDate?: string;
  origin?: string;
  destination?: string;
  departureTime?: string;
  serviceLabel?: string;
  capacity?: number;
  passenger?: {
    name: string;
    type: 'SELF' | 'GUEST';
    phone: string | null;
    guestPhone: string | null;
    purpose: string;
    purposeDetail: string | null;
    idType: string;
    idTypeDetail?: string | null;
    idMasked: string | null;
    bookedBy: string;
  };
  /** ISO instant until which the passenger may cancel online. */
  cancellationDeadline?: string;
  waitlistPosition?: number;
  reason?: string | null;
  cancelledByAdmin?: boolean;
  /** The cancelled booking was a waiting-list entry (no seat was held). */
  wasWaitlisted?: boolean;
  blockedFrom?: string;
  blockedUntil?: string;
  /** true for the copy sent to a guest passenger. */
  guestCopy?: boolean;
}

export interface EnqueueInput {
  type: NotificationType;
  /** Logical identity; the same key is never enqueued twice. */
  dedupeKey: string;
  recipient: string | null;
  bookingId?: string;
  tripId?: string;
  payload: NotificationPayload;
}

/**
 * Writes a notification to the transactional outbox. Call inside the same
 * transaction as the state change so the message exists iff the change commits.
 * Users without an email address get a FAILED record so admins can see it.
 */
export async function enqueueNotification(db: Db, input: EnqueueInput): Promise<void> {
  await db.notificationOutbox.create({
    data: {
      type: input.type,
      dedupeKey: input.dedupeKey,
      recipient: input.recipient ?? '',
      bookingId: input.bookingId ?? null,
      tripId: input.tripId ?? null,
      payload: JSON.stringify(input.payload),
      ...(input.recipient
        ? { status: 'PENDING' }
        : {
            status: 'FAILED',
            lastError: 'Recipient has no email address on file',
            nextAttemptAt: null,
          }),
    },
  });
}
