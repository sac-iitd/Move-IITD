import type { PrismaClient, User } from '@prisma/client';
import { istDateOf } from '@iitd-bus/shared';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { enqueueNotification } from '../email/outbox';
import { cancelBooking } from '../bookings/service';

/**
 * Blocks a user from booking for an inclusive IST date range. Their active bookings on
 * trips in that range (not yet departed) are cancelled — each passenger is emailed and
 * freed seats go to the waiting list — and the user gets one "access paused" email.
 */
export async function createBlock(
  prisma: PrismaClient,
  input: {
    userId: string;
    startsOn: string;
    endsOn: string;
    reason: string;
    actor: User;
    now: Date;
  },
) {
  const { userId, startsOn, endsOn, reason, actor, now } = input;
  if (userId === actor.id) throw new HttpError('VALIDATION_ERROR', 'You cannot block yourself.');
  if (endsOn < istDateOf(now))
    throw new HttpError('VALIDATION_ERROR', 'The block period has already ended.');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new HttpError('NOT_FOUND', 'User not found.');

  const block = await prisma.userBlock.create({
    data: { userId, startsOn, endsOn, reason, createdById: actor.id },
  });

  const affected = await prisma.booking.findMany({
    where: {
      userId,
      status: { in: ['CONFIRMED', 'WAITLISTED'] },
      trip: { travelDate: { gte: startsOn, lte: endsOn }, departureAt: { gt: now } },
    },
    select: { bookingReference: true },
  });
  for (const b of affected) {
    await cancelBooking(prisma, {
      reference: b.bookingReference,
      actor,
      asAdmin: true,
      reason: `Booking access blocked: ${reason}`,
      now,
    });
  }

  await enqueueNotification(prisma, {
    type: 'USER_BLOCKED',
    dedupeKey: `USER_BLOCKED:${block.id}`,
    recipient: user.email,
    payload: { name: user.name, blockedFrom: startsOn, blockedUntil: endsOn, reason },
  });
  await audit(prisma, {
    actorUserId: actor.id,
    action: 'USER_BLOCKED',
    targetType: 'User',
    targetId: userId,
    metadata: { blockId: block.id, startsOn, endsOn, reason, cancelledBookings: affected.length },
  });
  return { block, cancelledBookings: affected.length };
}

/** Lifts a block early. Cancelled bookings are not restored. */
export async function revokeBlock(
  prisma: PrismaClient,
  input: { blockId: string; actor: User; now: Date },
) {
  const block = await prisma.userBlock.findUnique({ where: { id: input.blockId } });
  if (!block) throw new HttpError('NOT_FOUND', 'Block not found.');
  const r = await prisma.userBlock.updateMany({
    where: { id: block.id, revokedAt: null },
    data: { revokedAt: input.now, revokedById: input.actor.id },
  });
  if (r.count !== 1) throw new HttpError('CONFLICT', 'This block was already lifted.');
  await audit(prisma, {
    actorUserId: input.actor.id,
    action: 'USER_UNBLOCKED',
    targetType: 'User',
    targetId: block.userId,
    metadata: { blockId: block.id, startsOn: block.startsOn, endsOn: block.endsOn },
  });
}
