import { Router } from 'express';
import { z } from 'zod';
import { boardingDateQuerySchema, boardingScanSchema, istDateOf } from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { requireAuth, requireStaff } from '../auth/middleware';
import { conductorRoster, listBoardingTrips, scanBoardingPass } from '../boarding/service';

const idParam = z.string().min(1).max(64);

/** Scanner used by conductors and by administrators who are checking a vehicle. */
export function boardingRouter(ctx: AppContext) {
  const r = Router();
  r.use(requireAuth, requireStaff);

  r.get('/trips', async (req, res) => {
    const q = boardingDateQuerySchema.parse(req.query);
    const date = q.date ?? istDateOf(ctx.now());
    const trips = await listBoardingTrips(ctx.prisma, date);
    res.set('Cache-Control', 'no-store').json({ date, trips });
  });

  r.get('/trips/:tripId', async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const roster = await conductorRoster(ctx.prisma, tripId);
    res.set('Cache-Control', 'no-store').json(roster);
  });

  r.post('/scans', async (req, res) => {
    const body = boardingScanSchema.parse(req.body);
    const result = await scanBoardingPass(ctx.prisma, {
      tripId: body.tripId,
      code: body.code,
      actor: req.auth!.user,
      now: ctx.now(),
    });
    res.json(result);
  });

  return r;
}
