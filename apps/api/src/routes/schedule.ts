import { Router } from 'express';
import {
  directionOf,
  type Campus,
  type CutoffRule,
  type PublicScheduleResponse,
} from '@iitd-bus/shared';
import type { AppContext } from '../context';

/** Public timetable (no personal data) for the landing page. */
export function scheduleRouter(ctx: AppContext) {
  const r = Router();
  r.get('/', async (_req, res) => {
    const templates = await ctx.prisma.serviceTemplate.findMany({
      where: { active: true },
      orderBy: [{ serviceLabel: 'asc' }, { departureTime: 'asc' }],
    });
    const body: PublicScheduleResponse = {
      services: templates.map((t) => ({
        serviceLabel: t.serviceLabel,
        capacity: t.capacity,
        origin: t.origin as Campus,
        destination: t.destination as Campus,
        direction: directionOf(t.origin as Campus, t.destination as Campus),
        departureTime: t.departureTime,
        timeProvisional: t.timeProvisional,
        bookingOpenDaysBefore: t.bookingOpenDaysBefore,
        bookingOpenTime: t.bookingOpenTime,
        bookingCloseTime: t.bookingCloseTime,
        cancellationCloseTime: t.cancellationCloseTime,
        cutoffRule: t.cutoffRule as CutoffRule,
      })),
    };
    res.set('Cache-Control', 'public, max-age=300').json(body);
  });
  return r;
}
