import { expireWaitlists } from './bookings/service';
import { purgePersonalData } from './lib/retention';
import { appUrl } from './config/env';
import type { AppContext } from './context';
import { processOutbox } from './email/worker';
import { generateTrips } from './trips/generate';

export interface BackgroundJobs {
  stop(): Promise<void>;
}

/**
 * Periodic work inside the API process: email outbox delivery, rolling trip
 * generation and expired-session cleanup. Each job skips a tick if its previous
 * run is still in progress. All jobs are idempotent, so running several API
 * instances is safe (outbox rows are claimed atomically).
 */
export function startBackgroundJobs(ctx: AppContext): BackgroundJobs {
  const running = new Set<Promise<unknown>>();
  const timers: NodeJS.Timeout[] = [];

  function schedule(name: string, intervalMs: number, fn: () => Promise<unknown>, runNow = true) {
    let busy = false;
    const tick = () => {
      if (busy) return;
      busy = true;
      const p = fn()
        .catch((err) => ctx.logger.error({ err, job: name }, 'Background job failed'))
        .finally(() => {
          busy = false;
          running.delete(p);
        });
      running.add(p);
    };
    timers.push(setInterval(tick, intervalMs));
    if (runNow) tick();
  }

  schedule('outbox', ctx.env.OUTBOX_POLL_INTERVAL_MS, async () => {
    const r = await processOutbox({
      prisma: ctx.prisma,
      mailer: ctx.mailer,
      logger: ctx.logger,
      webOrigin: appUrl(ctx.env),
      maxAttempts: ctx.env.OUTBOX_MAX_ATTEMPTS,
      now: ctx.now,
    });
    if (r.sent || r.retried || r.failed)
      ctx.logger.info({ job: 'outbox', ...r }, 'Outbox processed');
  });

  schedule('trip-generation', ctx.env.TRIP_GENERATION_INTERVAL_MINUTES * 60_000, async () => {
    const r = await generateTrips(ctx.prisma, {
      now: ctx.now(),
      horizonDays: ctx.env.TRIP_GENERATION_HORIZON_DAYS,
    });
    if (r.created || r.completed)
      ctx.logger.info({ job: 'trip-generation', ...r }, 'Trips generated');
  });

  schedule('waitlist-expiry', 5 * 60_000, async () => {
    const n = await expireWaitlists(ctx.prisma, ctx.now());
    if (n) ctx.logger.info({ job: 'waitlist-expiry', expired: n }, 'Waiting lists closed');
  });

  schedule('pii-retention', 6 * 60 * 60_000, async () => {
    const r = await purgePersonalData(ctx.prisma, ctx.now(), ctx.env.PII_RETENTION_DAYS);
    if (r.bookings || r.notifications)
      ctx.logger.info({ job: 'pii-retention', ...r }, 'Personal data erased');
  });

  schedule('session-cleanup', 60 * 60_000, async () => {
    await ctx.prisma.session.deleteMany({ where: { expiresAt: { lt: ctx.now() } } });
  });

  return {
    async stop() {
      timers.forEach(clearInterval);
      await Promise.allSettled([...running]);
    },
  };
}
