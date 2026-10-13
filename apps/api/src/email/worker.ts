import type { PrismaClient } from '@prisma/client';
import type { NotificationType } from '@iitd-bus/shared';
import type { Logger } from '../lib/logger';
import type { Mailer } from './mailer';
import type { NotificationPayload } from './outbox';
import { renderEmail } from './templates';

const LEASE_MS = 2 * 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 60 * 60_000;

export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
}

/** Keeps error text useful for operators while stripping anything credential-like. */
export function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/(pass(word)?|pwd|secret|token|auth)[=:]\S+/gi, '$1=[redacted]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300);
}

export interface OutboxDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  logger: Logger;
  webOrigin: string;
  maxAttempts: number;
  now: () => Date;
}

export interface OutboxRunResult {
  sent: number;
  retried: number;
  failed: number;
}

/**
 * Delivers due notifications. Each row is claimed with a conditional update
 * (PENDING → SENDING + lease) so concurrent workers never send the same row;
 * SENT rows are never picked again. Delivery is at-least-once: if the process
 * dies between SMTP acceptance and marking SENT, the lease expires and the
 * message is retried with the same Message-ID so receivers can de-duplicate.
 */
export async function processOutbox(deps: OutboxDeps, batchSize = 20): Promise<OutboxRunResult> {
  const now = deps.now();
  const due = await deps.prisma.notificationOutbox.findMany({
    where: {
      OR: [
        { status: 'PENDING', nextAttemptAt: { lte: now } },
        { status: 'SENDING', lockedUntil: { lt: now } }, // stale claim from a crashed worker
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    select: { id: true, status: true },
  });

  const result: OutboxRunResult = { sent: 0, retried: 0, failed: 0 };
  for (const candidate of due) {
    const claim = await deps.prisma.notificationOutbox.updateMany({
      where: {
        id: candidate.id,
        status: candidate.status,
        ...(candidate.status === 'SENDING'
          ? { lockedUntil: { lt: now } }
          : { nextAttemptAt: { lte: now } }),
      },
      data: {
        status: 'SENDING',
        lockedUntil: new Date(now.getTime() + LEASE_MS),
        attemptCount: { increment: 1 },
      },
    });
    if (claim.count !== 1) continue; // another worker took it

    const row = await deps.prisma.notificationOutbox.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    try {
      const payload = JSON.parse(row.payload) as NotificationPayload;
      const email = renderEmail(row.type as NotificationType, payload, deps.webOrigin);
      await deps.mailer.send({
        to: row.recipient,
        ...email,
        messageId: `<${row.dedupeKey.replace(/[^A-Za-z0-9.-]/g, '.')}@iitd-bus.local>`,
      });
      await deps.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: 'SENT',
          sentAt: deps.now(),
          lockedUntil: null,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      result.sent++;
    } catch (err) {
      const exhausted = row.attemptCount >= deps.maxAttempts;
      await deps.prisma.notificationOutbox.update({
        where: { id: row.id },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          lockedUntil: null,
          lastError: sanitizeError(err),
          nextAttemptAt: exhausted
            ? null
            : new Date(deps.now().getTime() + backoffMs(row.attemptCount)),
        },
      });
      deps.logger.warn(
        { notificationId: row.id, attempt: row.attemptCount, exhausted },
        'Email delivery failed',
      );
      if (exhausted) result.failed++;
      else result.retried++;
    }
  }
  return result;
}
