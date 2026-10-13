import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  addDays,
  adminAuditQuerySchema,
  adminBookingsQuerySchema,
  adminCancelSchema,
  adminNotificationsQuerySchema,
  adminOverviewQuerySchema,
  adminTemplatePatchSchema,
  adminTripPatchSchema,
  adminTripsQuerySchema,
  adminCreateClosureSchema,
  adminBlockSchema,
  adminUsersQuerySchema,
  DIRECTION_LABELS,
  ID_TYPE_LABELS,
  PURPOSE_LABELS,
  type AdminUserDto,
  type IdType,
  type ManifestResponse,
  type PassengerType,
  type Purpose,
  type UserBlockDto,
  adminAnalyticsQuerySchema,
  weekdayOf,
  type AnalyticsResponse,
  type Direction,
  adminCreateSpecialTripSchema,
  bookingReferenceSchema,
  directionOf,
  formatIst,
  generateTripsSchema,
  istDateOf,
  routeOf,
  type AdminBookingDto,
  type AdminBookingsQuery,
  type AdminOverviewResponse,
  type AdminTripDto,
  type AuditLogDto,
  type ServiceClosureDto,
  type BookingStatus,
  type Campus,
  type CutoffRule,
  type NotificationDto,
  type NotificationStatus,
  type NotificationType,
  type Paginated,
  type ServiceTemplateDto,
} from '@iitd-bus/shared';
import type { AppContext } from '../context';
import { requireAdmin, requireAuth } from '../auth/middleware';
import {
  cancelTrip,
  createClosure,
  createSpecialTrip,
  patchTemplate,
  patchTrip,
  removeClosure,
} from '../admin/service';
import { cancelBooking } from '../bookings/service';
import {
  confirmationEmailStatus,
  fullIdNumber,
  toBookingDto,
  toTripDto,
  waitlistCounts,
  waitlistPositions,
} from '../bookings/dto';
import { createBlock, revokeBlock } from '../blocks/service';
import { audit } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { generateTrips } from '../trips/generate';

const idParam = z.string().min(1).max(64);
const EXPORT_LIMIT = 10_000;

function toAdminTripDto(
  t: Parameters<typeof toTripDto>[0],
  now: Date,
  waitlistCount = 0,
): AdminTripDto {
  return {
    ...toTripDto(t, now, [], waitlistCount),
    serviceTemplateId: t.serviceTemplateId,
    cancellationReason: t.cancellationReason,
    cancelledAt: t.cancelledAt?.toISOString() ?? null,
  };
}

function toTemplateDto(t: Prisma.ServiceTemplateGetPayload<object>): ServiceTemplateDto {
  return {
    id: t.id,
    serviceLabel: t.serviceLabel,
    capacity: t.capacity,
    origin: t.origin as Campus,
    destination: t.destination as Campus,
    direction: directionOf(t.origin as Campus, t.destination as Campus),
    departureTime: t.departureTime,
    active: t.active,
    timeProvisional: t.timeProvisional,
    bookingOpenDaysBefore: t.bookingOpenDaysBefore,
    bookingOpenTime: t.bookingOpenTime,
    bookingCloseTime: t.bookingCloseTime,
    cancellationCloseTime: t.cancellationCloseTime,
    cutoffRule: t.cutoffRule as CutoffRule,
    effectiveFrom: t.effectiveFrom,
    effectiveUntil: t.effectiveUntil,
  };
}

function bookingWhere(q: Omit<AdminBookingsQuery, 'page' | 'pageSize'>): Prisma.BookingWhereInput {
  const trip: Prisma.TripWhereInput = {
    ...((q.from || q.to) && {
      travelDate: { ...(q.from && { gte: q.from }), ...(q.to && { lte: q.to }) },
    }),
    ...(q.direction && routeOf(q.direction)),
  };
  const search = q.q?.trim();
  return {
    ...(q.status && { status: q.status }),
    ...(q.tripId && { tripId: q.tripId }),
    ...(Object.keys(trip).length > 0 && { trip }),
    ...(search && {
      OR: [
        { bookingReference: { contains: search.toUpperCase() } },
        { passengerName: { contains: search } },
        { user: { name: { contains: search } } },
        { user: { email: { contains: search.toLowerCase() } } },
        { user: { providerSubject: { contains: search.toLowerCase() } } },
      ],
    }),
  };
}

const bookingInclude = {
  trip: true,
  user: true,
  cancelledBy: { select: { id: true } },
  notifications: { select: { type: true, status: true } },
} as const;

type AdminBookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

function toAdminBookingDto(
  b: AdminBookingRow,
  waitlistPosition: number | null = null,
): AdminBookingDto {
  return {
    reference: b.bookingReference,
    status: b.status as BookingStatus,
    userName: b.user.name,
    userEmail: b.user.email,
    userSubject: b.user.providerSubject,
    tripId: b.tripId,
    serviceLabel: b.trip.serviceLabel,
    direction: directionOf(b.trip.origin as Campus, b.trip.destination as Campus),
    travelDate: b.trip.travelDate,
    departureTime: b.trip.departureTime,
    bookedAt: b.bookedAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancellationReason: b.cancellationReason,
    cancelledByAdmin: b.cancelledById !== null && b.cancelledById !== b.userId,
    emailStatus: confirmationEmailStatus(b.notifications),
    passengerType: b.passengerType as PassengerType,
    passengerName: b.passengerName,
    passengerEmail: b.passengerEmail,
    phone: b.phone,
    purpose: b.purpose as Purpose,
    purposeDetail: b.purposeDetail,
    idType: b.idType as IdType,
    idNumber: fullIdNumber(b, b.user.providerSubject),
    waitlistPosition: b.status === 'WAITLISTED' ? waitlistPosition : null,
  };
}

function purposeText(purpose: string, detail: string | null): string {
  const label = PURPOSE_LABELS[purpose as Purpose] ?? purpose;
  return detail ? `${label}: ${detail}` : label;
}

/** Neutralises spreadsheet formula injection and escapes CSV metacharacters. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminRouter(ctx: AppContext) {
  const r = Router();
  r.use(requireAuth, requireAdmin);
  r.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  r.get('/overview', async (req, res) => {
    const q = adminOverviewQuerySchema.parse(req.query);
    const now = ctx.now();
    const today = istDateOf(now);
    const from = q.from ?? today;
    const to = q.to ?? from;
    const tripWhere: Prisma.TripWhereInput = {
      travelDate: { gte: from, lte: to },
      ...(q.direction && routeOf(q.direction)),
    };
    const [todayTrips, scheduled, totalBookings, cancelledBookings, pending, failed, provisional] =
      await Promise.all([
        ctx.prisma.trip.count({
          where: {
            travelDate: today,
            status: { not: 'CANCELLED' },
            ...(q.direction && routeOf(q.direction)),
          },
        }),
        ctx.prisma.trip.findMany({
          where: { ...tripWhere, status: { not: 'CANCELLED' } },
          select: { capacity: true, bookedCount: true },
        }),
        ctx.prisma.booking.count({ where: { status: 'CONFIRMED', trip: tripWhere } }),
        ctx.prisma.booking.count({ where: { status: 'CANCELLED', trip: tripWhere } }),
        ctx.prisma.notificationOutbox.count({ where: { status: { in: ['PENDING', 'SENDING'] } } }),
        ctx.prisma.notificationOutbox.count({ where: { status: 'FAILED' } }),
        ctx.prisma.serviceTemplate.count({ where: { timeProvisional: true, active: true } }),
      ]);
    const seatsFilled = scheduled.reduce((n, t) => n + t.bookedCount, 0);
    const capacity = scheduled.reduce((n, t) => n + t.capacity, 0);
    const body: AdminOverviewResponse = {
      range: { from, to },
      todayTrips,
      totalBookings,
      seatsFilled,
      seatsRemaining: Math.max(0, capacity - seatsFilled),
      cancelledBookings,
      tripsAtCapacity: scheduled.filter((t) => t.bookedCount >= t.capacity).length,
      pendingNotifications: pending,
      failedNotifications: failed,
      provisionalTemplates: provisional,
    };
    res.json(body);
  });

  /**
   * Aggregates for the analytics charts. Occupancy counts confirmed seats on trips that
   * ran or will run (cancelled trips are excluded from capacity but reported separately).
   */
  r.get('/analytics', async (req, res) => {
    const q = adminAnalyticsQuerySchema.parse(req.query);
    const today = istDateOf(ctx.now());
    const from = q.from ?? addDays(today, -29);
    const to = q.to ?? addDays(today, 7);
    if (to < from || addDays(from, 180) < to)
      throw new HttpError('VALIDATION_ERROR', 'Date range must be 0–180 days.');

    const trips = await ctx.prisma.trip.findMany({
      where: { travelDate: { gte: from, lte: to } },
      select: {
        id: true,
        travelDate: true,
        departureTime: true,
        departureAt: true,
        serviceLabel: true,
        origin: true,
        destination: true,
        capacity: true,
        bookedCount: true,
        status: true,
        isSpecial: true,
      },
    });
    const bookings = await ctx.prisma.booking.findMany({
      where: { trip: { travelDate: { gte: from, lte: to } } },
      select: { status: true, bookedAt: true, tripId: true },
    });
    const tripById = new Map(trips.map((t) => [t.id, t]));
    const running = trips.filter((t) => t.status !== 'CANCELLED');
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

    const daily = new Map<string, { confirmed: number; cancelled: number; capacity: number }>();
    const byDep = new Map<string, AnalyticsResponse['byDeparture'][number]>();
    const byWd = new Map<number, { confirmed: number; capacity: number }>();
    const byDir = new Map<Direction, { confirmed: number; capacity: number }>();
    for (const t of running) {
      const d = daily.get(t.travelDate) ?? { confirmed: 0, cancelled: 0, capacity: 0 };
      d.confirmed += t.bookedCount;
      d.capacity += t.capacity;
      daily.set(t.travelDate, d);
      const direction = directionOf(t.origin as Campus, t.destination as Campus);
      const key = t.isSpecial
        ? `special|${t.serviceLabel}|${direction}`
        : `${t.serviceLabel}|${t.departureTime}|${direction}`;
      const g = byDep.get(key) ?? {
        key,
        serviceLabel: t.serviceLabel,
        departureTime: t.isSpecial ? 'special' : t.departureTime,
        direction,
        trips: 0,
        confirmed: 0,
        capacity: 0,
        occupancy: 0,
      };
      g.trips++;
      g.confirmed += t.bookedCount;
      g.capacity += t.capacity;
      byDep.set(key, g);
      const wd = weekdayOf(t.travelDate) || 7;
      const w = byWd.get(wd) ?? { confirmed: 0, capacity: 0 };
      w.confirmed += t.bookedCount;
      w.capacity += t.capacity;
      byWd.set(wd, w);
      const dr = byDir.get(direction) ?? { confirmed: 0, capacity: 0 };
      dr.confirmed += t.bookedCount;
      dr.capacity += t.capacity;
      byDir.set(direction, dr);
    }

    const buckets = ['Same day', '1 day', '2–3 days', '4–5 days', '6–7 days', '8+ days'];
    const lead = new Map(buckets.map((b) => [b, 0]));
    let cancelled = 0;
    for (const b of bookings) {
      const t = tripById.get(b.tripId);
      if (!t) continue;
      if (b.status === 'CANCELLED') {
        cancelled++;
        const d = daily.get(t.travelDate);
        if (d) d.cancelled++;
      }
      const days = Math.floor((t.departureAt.getTime() - b.bookedAt.getTime()) / 86_400_000);
      const bucket =
        days < 1
          ? buckets[0]!
          : days < 2
            ? buckets[1]!
            : days < 4
              ? buckets[2]!
              : days < 6
                ? buckets[3]!
                : days < 8
                  ? buckets[4]!
                  : buckets[5]!;
      lead.set(bucket, lead.get(bucket)! + 1);
    }

    const seatsOffered = running.reduce((n, t) => n + t.capacity, 0);
    const seatsFilled = running.reduce((n, t) => n + t.bookedCount, 0);
    const body: AnalyticsResponse = {
      range: { from, to },
      totals: {
        bookings: bookings.length - cancelled,
        cancelled,
        cancellationRate: pct(cancelled, bookings.length),
        seatsOffered,
        seatsFilled,
        occupancy: pct(seatsFilled, seatsOffered),
        trips: running.length,
        cancelledTrips: trips.length - running.length,
      },
      daily: [...daily.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => ({ date, ...d, occupancy: pct(d.confirmed, d.capacity) })),
      byDeparture: [...byDep.values()]
        .map((g) => ({ ...g, occupancy: pct(g.confirmed, g.capacity) }))
        .sort((a, b) => a.departureTime.localeCompare(b.departureTime)),
      byWeekday: [...byWd.entries()]
        .sort(([a], [b]) => a - b)
        .map(([weekday, w]) => ({ weekday, ...w, occupancy: pct(w.confirmed, w.capacity) })),
      byDirection: [...byDir.entries()].map(([direction, d]) => ({ direction, ...d })),
      leadTime: buckets.map((bucket) => ({ bucket, bookings: lead.get(bucket)! })),
    };
    res.json(body);
  });

  // ---- Trips & templates ----

  r.get('/trips', async (req, res) => {
    const q = adminTripsQuerySchema.parse(req.query);
    const now = ctx.now();
    const from = q.from ?? istDateOf(now);
    const to = q.to ?? addDays(from, 13);
    if (to < from || addDays(from, 62) < to)
      throw new HttpError('VALIDATION_ERROR', 'Date range must be 0–62 days.');
    const trips = await ctx.prisma.trip.findMany({
      where: {
        travelDate: { gte: from, lte: to },
        ...(q.status && { status: q.status }),
        ...(q.direction && routeOf(q.direction)),
      },
      orderBy: [{ departureAt: 'asc' }, { serviceLabel: 'asc' }],
    });
    const counts = await waitlistCounts(
      ctx.prisma,
      trips.map((t) => t.id),
    );
    res.json({
      trips: trips.map((t) => toAdminTripDto(t, now, counts.get(t.id) ?? 0)),
      range: { from, to },
    });
  });

  r.post('/trips/generate', async (req, res) => {
    const { horizonDays } = generateTripsSchema.parse(req.body ?? {});
    const result = await generateTrips(ctx.prisma, {
      now: ctx.now(),
      horizonDays: horizonDays ?? ctx.env.TRIP_GENERATION_HORIZON_DAYS,
    });
    await audit(ctx.prisma, {
      actorUserId: req.auth!.user.id,
      action: 'TRIPS_GENERATED',
      targetType: 'Trip',
      metadata: { ...result },
    });
    res.json(result);
  });

  r.patch('/trips/:tripId', async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const patch = adminTripPatchSchema.parse(req.body);
    const trip = await patchTrip(ctx.prisma, {
      tripId,
      actor: req.auth!.user,
      patch,
      now: ctx.now(),
    });
    res.json({ trip: toAdminTripDto(trip, ctx.now()) });
  });

  r.post('/trips/:tripId/cancel', async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const { reason } = adminCancelSchema.parse(req.body);
    const result = await cancelTrip(ctx.prisma, {
      tripId,
      actor: req.auth!.user,
      reason,
      now: ctx.now(),
    });
    const trip = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    res.json({ trip: toAdminTripDto(trip, ctx.now()), affectedBookings: result.affected });
  });

  /** One-off trip on any date (weekends/holidays allowed). */
  r.post('/trips/special', async (req, res) => {
    const input = adminCreateSpecialTripSchema.parse(req.body);
    const trip = await createSpecialTrip(ctx.prisma, {
      trip: input,
      actor: req.auth!.user,
      now: ctx.now(),
    });
    res.status(201).json({ trip: toAdminTripDto(trip, ctx.now()) });
  });

  // ---- Service closures (holidays) ----

  r.get('/closures', async (_req, res) => {
    const rows = await ctx.prisma.serviceClosure.findMany({
      where: { date: { gte: addDays(istDateOf(ctx.now()), -30) } },
      include: { createdBy: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });
    const closures: ServiceClosureDto[] = rows.map((c) => ({
      id: c.id,
      date: c.date,
      reason: c.reason,
      createdByName: c.createdBy?.name ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
    res.json({ closures });
  });

  r.post('/closures', async (req, res) => {
    const { date, reason } = adminCreateClosureSchema.parse(req.body);
    const r2 = await createClosure(ctx.prisma, {
      date,
      reason,
      actor: req.auth!.user,
      now: ctx.now(),
    });
    res.status(201).json({
      closure: { id: r2.closure.id, date: r2.closure.date, reason: r2.closure.reason },
      cancelledTrips: r2.cancelledTrips,
      affectedBookings: r2.affectedBookings,
    });
  });

  r.delete('/closures/:closureId', async (req, res) => {
    const id = idParam.parse(req.params.closureId);
    const result = await removeClosure(ctx.prisma, {
      id,
      actor: req.auth!.user,
      now: ctx.now(),
      horizonDays: ctx.env.TRIP_GENERATION_HORIZON_DAYS,
    });
    res.json(result);
  });

  r.get('/templates', async (_req, res) => {
    const templates = await ctx.prisma.serviceTemplate.findMany({
      orderBy: [{ serviceLabel: 'asc' }, { departureTime: 'asc' }],
    });
    res.json({ templates: templates.map(toTemplateDto) });
  });

  r.patch('/templates/:templateId', async (req, res) => {
    const templateId = idParam.parse(req.params.templateId);
    const patch = adminTemplatePatchSchema.parse(req.body);
    const result = await patchTemplate(ctx.prisma, {
      templateId,
      actor: req.auth!.user,
      patch,
      now: ctx.now(),
    });
    res.json({ template: toTemplateDto(result.template), refreshedTrips: result.refreshedTrips });
  });

  // ---- Bookings ----

  r.get('/bookings', async (req, res) => {
    const { page, pageSize, ...filters } = adminBookingsQuerySchema.parse(req.query);
    const where = bookingWhere(filters);
    const [total, rows] = await Promise.all([
      ctx.prisma.booking.count({ where }),
      ctx.prisma.booking.findMany({
        where,
        include: bookingInclude,
        orderBy: [{ trip: { departureAt: 'asc' } }, { bookedAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const positions = await waitlistPositions(ctx.prisma, [
      ...new Set(rows.filter((r) => r.status === 'WAITLISTED').map((r) => r.tripId)),
    ]);
    const body: Paginated<AdminBookingDto> = {
      items: rows.map((r) => toAdminBookingDto(r, positions.get(r.id) ?? null)),
      page,
      pageSize,
      total,
    };
    res.json(body);
  });

  r.get('/bookings/export.csv', async (req, res) => {
    const { page: _p, pageSize: _s, ...filters } = adminBookingsQuerySchema.parse(req.query);
    const rows = await ctx.prisma.booking.findMany({
      where: bookingWhere(filters),
      include: bookingInclude,
      orderBy: [{ trip: { departureAt: 'asc' } }, { bookedAt: 'asc' }],
      take: EXPORT_LIMIT,
    });
    await audit(ctx.prisma, {
      actorUserId: req.auth!.user.id,
      action: 'BOOKINGS_EXPORTED',
      targetType: 'Booking',
      metadata: { filters, rowCount: rows.length },
    });
    const positions = await waitlistPositions(ctx.prisma, [...new Set(rows.map((r) => r.tripId))]);
    const header = [
      'Booking reference',
      'Status',
      'Waitlist position',
      'Passenger name',
      'Passenger type',
      'Passenger email',
      'Phone',
      'Guest phone',
      'Purpose',
      'ID type',
      'ID number',
      'Booked by (name)',
      'Booked by (email)',
      'Booked by (Kerberos ID)',
      'Vehicle',
      'Direction',
      'Travel date',
      'Departure (IST)',
      'Booked at (IST)',
      'Cancelled at (IST)',
      'Cancellation reason',
      'Cancelled by admin',
    ];
    const lines = rows.map((row) => {
      const b = toAdminBookingDto(row, positions.get(row.id) ?? null);
      return [
        b.reference,
        b.status,
        b.waitlistPosition ?? '',
        b.passengerName,
        b.passengerType,
        b.passengerEmail,
        b.phone,
        row.guestPhone,
        purposeText(b.purpose, b.purposeDetail),
        ID_TYPE_LABELS[b.idType],
        b.idNumber,
        b.userName,
        b.userEmail,
        b.userSubject,
        b.serviceLabel,
        DIRECTION_LABELS[b.direction],
        b.travelDate,
        b.departureTime,
        formatIst(b.bookedAt),
        b.cancelledAt ? formatIst(b.cancelledAt) : '',
        b.cancellationReason,
        b.cancelledByAdmin ? 'yes' : 'no',
      ]
        .map(csvCell)
        .join(',');
    });
    const filename = `bookings-${istDateOf(ctx.now())}.csv`;
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${filename}"`)
      .send('﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n');
  });

  r.get('/bookings/:reference', async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const booking = await ctx.prisma.booking.findUnique({
      where: { bookingReference: reference },
      include: { ...bookingInclude, notifications: true },
    });
    if (!booking) throw new HttpError('NOT_FOUND', 'Booking not found.');
    const positions = await waitlistPositions(ctx.prisma, [booking.tripId]);
    if (booking.idType !== 'IITD_ID') {
      await audit(ctx.prisma, {
        actorUserId: req.auth!.user.id,
        action: 'ID_NUMBER_VIEWED',
        targetType: 'Booking',
        targetId: booking.id,
        metadata: { reference },
      });
    }
    res.json({
      booking: toAdminBookingDto(booking, positions.get(booking.id) ?? null),
      detail: toBookingDto(booking, ctx.now(), positions.get(booking.id) ?? null),
      notifications: booking.notifications.map(toNotificationDto(booking.bookingReference)),
    });
  });

  r.post('/bookings/:reference/cancel', async (req, res) => {
    const reference = bookingReferenceSchema.parse(req.params.reference);
    const { reason } = adminCancelSchema.parse(req.body);
    await cancelBooking(ctx.prisma, {
      reference,
      actor: req.auth!.user,
      asAdmin: true,
      reason,
      now: ctx.now(),
    });
    const row = await ctx.prisma.booking.findUniqueOrThrow({
      where: { bookingReference: reference },
      include: bookingInclude,
    });
    res.json({ booking: toAdminBookingDto(row) });
  });

  // ---- Driver manifest ----

  /** Passenger list for one trip (contains ID numbers — every view/export is audited). */
  async function buildManifest(tripId: string): Promise<ManifestResponse> {
    const trip = await ctx.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new HttpError('NOT_FOUND', 'Trip not found.');
    const rows = await ctx.prisma.booking.findMany({
      where: { tripId, status: { in: ['CONFIRMED', 'WAITLISTED'] } },
      include: { user: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const counts = await waitlistCounts(ctx.prisma, [tripId]);
    const confirmed = rows.filter((r) => r.status === 'CONFIRMED');
    const waiting = rows.filter((r) => r.status === 'WAITLISTED');
    return {
      trip: toAdminTripDto(trip, ctx.now(), counts.get(tripId) ?? 0),
      generatedAt: ctx.now().toISOString(),
      passengers: confirmed.map((b, i) => ({
        serial: i + 1,
        reference: b.bookingReference,
        name: b.passengerName,
        phone: b.guestPhone ?? b.phone,
        purpose: purposeText(b.purpose, b.purposeDetail),
        passengerType: b.passengerType as PassengerType,
        bookedBy: b.user.name,
        idType: b.idType as IdType,
        idNumber: fullIdNumber(b, b.user.providerSubject),
      })),
      waitlist: waiting.map((b, i) => ({
        position: i + 1,
        reference: b.bookingReference,
        name: b.passengerName,
        phone: b.guestPhone ?? b.phone,
      })),
    };
  }

  r.get('/trips/:tripId/manifest', async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const manifest = await buildManifest(tripId);
    await audit(ctx.prisma, {
      actorUserId: req.auth!.user.id,
      action: 'MANIFEST_VIEWED',
      targetType: 'Trip',
      targetId: tripId,
      metadata: { passengers: manifest.passengers.length },
    });
    res.json(manifest);
  });

  r.get('/trips/:tripId/manifest.csv', async (req, res) => {
    const tripId = idParam.parse(req.params.tripId);
    const m = await buildManifest(tripId);
    await audit(ctx.prisma, {
      actorUserId: req.auth!.user.id,
      action: 'MANIFEST_EXPORTED',
      targetType: 'Trip',
      targetId: tripId,
      metadata: { passengers: m.passengers.length },
    });
    const header = [
      'S.No',
      'Passenger name',
      'Phone',
      'Purpose',
      'ID type',
      'ID number',
      'Guest of',
      'Booking reference',
    ];
    const lines = m.passengers.map((p) =>
      [
        p.serial,
        p.name,
        p.phone,
        p.purpose,
        ID_TYPE_LABELS[p.idType],
        p.idNumber,
        p.passengerType === 'GUEST' ? p.bookedBy : '',
        p.reference,
      ]
        .map(csvCell)
        .join(','),
    );
    const title = `${m.trip.serviceLabel} ${DIRECTION_LABELS[m.trip.direction]} ${m.trip.travelDate} ${m.trip.departureTime}`;
    const file = `manifest-${m.trip.travelDate}-${m.trip.departureTime.replace(':', '')}-${m.trip.serviceLabel}.csv`;
    res
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="${file}"`)
      .send('﻿' + [csvCell(title), header.join(','), ...lines].join('\r\n') + '\r\n');
  });

  // ---- Users & blocks ----

  function toBlockDto(
    b: Prisma.UserBlockGetPayload<{ include: { user: true; createdBy: true } }>,
  ): UserBlockDto {
    return {
      id: b.id,
      userId: b.userId,
      userName: b.user.name,
      startsOn: b.startsOn,
      endsOn: b.endsOn,
      reason: b.reason,
      createdByName: b.createdBy?.name ?? null,
      createdAt: b.createdAt.toISOString(),
      revokedAt: b.revokedAt?.toISOString() ?? null,
    };
  }

  r.get('/users', async (req, res) => {
    const { q, page, pageSize } = adminUsersQuerySchema.parse(req.query);
    const today = istDateOf(ctx.now());
    const search = q?.trim();
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { name: { contains: search } },
            { email: { contains: search.toLowerCase() } },
            { providerSubject: { contains: search.toLowerCase() } },
          ],
        }
      : {};
    const [total, users] = await Promise.all([
      ctx.prisma.user.count({ where }),
      ctx.prisma.user.findMany({
        where,
        orderBy: [{ lastLoginAt: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          blocks: {
            where: { revokedAt: null, endsOn: { gte: today } },
            include: { user: true, createdBy: true },
            orderBy: { startsOn: 'asc' },
            take: 1,
          },
        },
      }),
    ]);
    const body: Paginated<AdminUserDto> = {
      items: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        subject: u.providerSubject,
        role: u.role as 'USER' | 'ADMIN',
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        activeBlock: u.blocks[0] ? toBlockDto(u.blocks[0]) : null,
      })),
      page,
      pageSize,
      total,
    };
    res.json(body);
  });

  r.get('/blocks', async (_req, res) => {
    const today = istDateOf(ctx.now());
    const blocks = await ctx.prisma.userBlock.findMany({
      where: { endsOn: { gte: addDays(today, -90) } },
      include: { user: true, createdBy: true },
      orderBy: [{ endsOn: 'desc' }],
      take: 200,
    });
    res.json({ blocks: blocks.map(toBlockDto) });
  });

  r.post('/blocks', async (req, res) => {
    const input = adminBlockSchema.parse(req.body);
    const result = await createBlock(ctx.prisma, {
      ...input,
      actor: req.auth!.user,
      now: ctx.now(),
    });
    const block = await ctx.prisma.userBlock.findUniqueOrThrow({
      where: { id: result.block.id },
      include: { user: true, createdBy: true },
    });
    res.status(201).json({ block: toBlockDto(block), cancelledBookings: result.cancelledBookings });
  });

  r.post('/blocks/:blockId/revoke', async (req, res) => {
    const blockId = idParam.parse(req.params.blockId);
    await revokeBlock(ctx.prisma, { blockId, actor: req.auth!.user, now: ctx.now() });
    res.json({ ok: true });
  });

  // ---- Notifications ----

  r.get('/notifications', async (req, res) => {
    const { page, pageSize, status, type } = adminNotificationsQuerySchema.parse(req.query);
    const where: Prisma.NotificationOutboxWhereInput = {
      ...(status && { status }),
      ...(type && { type }),
    };
    const [total, rows] = await Promise.all([
      ctx.prisma.notificationOutbox.count({ where }),
      ctx.prisma.notificationOutbox.findMany({
        where,
        include: { booking: { select: { bookingReference: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const body: Paginated<NotificationDto> = {
      items: rows.map((n) => toNotificationDto(n.booking?.bookingReference ?? null)(n)),
      page,
      pageSize,
      total,
    };
    res.json(body);
  });

  /** Re-queues a FAILED notification. SENT messages cannot be retried (no duplicates). */
  r.post('/notifications/:notificationId/retry', async (req, res) => {
    const id = idParam.parse(req.params.notificationId);
    const n = await ctx.prisma.notificationOutbox.findUnique({ where: { id } });
    if (!n) throw new HttpError('NOT_FOUND', 'Notification not found.');
    if (!n.recipient) throw new HttpError('CONFLICT', 'This user has no email address on file.');
    const updated = await ctx.prisma.notificationOutbox.updateMany({
      where: { id, status: 'FAILED' },
      data: { status: 'PENDING', attemptCount: 0, nextAttemptAt: ctx.now(), lockedUntil: null },
    });
    if (updated.count !== 1)
      throw new HttpError('CONFLICT', 'Only failed notifications can be retried.');
    await audit(ctx.prisma, {
      actorUserId: req.auth!.user.id,
      action: 'NOTIFICATION_RETRIED',
      targetType: 'NotificationOutbox',
      targetId: id,
      metadata: { type: n.type, previousError: n.lastError },
    });
    res.json({ ok: true });
  });

  // ---- Audit ----

  r.get('/audit-logs', async (req, res) => {
    const { page, pageSize, action } = adminAuditQuerySchema.parse(req.query);
    const where: Prisma.AuditLogWhereInput = action ? { action } : {};
    const [total, rows] = await Promise.all([
      ctx.prisma.auditLog.count({ where }),
      ctx.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { name: true, providerSubject: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const body: Paginated<AuditLogDto> = {
      items: rows.map((a) => ({
        id: a.id,
        actorName: a.actor?.name ?? null,
        actorSubject: a.actor?.providerSubject ?? null,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        metadata: a.metadata ? (JSON.parse(a.metadata) as unknown) : null,
        createdAt: a.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
    res.json(body);
  });

  return r;
}

function toNotificationDto(bookingReference: string | null) {
  return (n: Prisma.NotificationOutboxGetPayload<object>): NotificationDto => ({
    id: n.id,
    type: n.type as NotificationType,
    recipient: n.recipient,
    status: n.status as NotificationStatus,
    attemptCount: n.attemptCount,
    lastError: n.lastError,
    nextAttemptAt: n.nextAttemptAt?.toISOString() ?? null,
    sentAt: n.sentAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
    bookingReference,
    tripId: n.tripId,
  });
}
