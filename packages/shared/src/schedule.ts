import { IST_OFFSET_MINUTES, type CutoffRule, type TripStatus } from './constants';

/**
 * Date helpers for Asia/Kolkata. IST has a fixed +05:30 offset (no DST), so
 * plain offset arithmetic is exact. Calendar dates are carried as
 * 'YYYY-MM-DD' strings to avoid accidental timezone shifts; instants are
 * JavaScript Dates (UTC internally, UTC in storage).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export function isValidDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isValidTimeString(value: string): boolean {
  return TIME_RE.test(value);
}

function parseDate(value: string): [number, number, number] {
  if (!isValidDateString(value)) throw new Error(`Invalid date '${value}', expected YYYY-MM-DD`);
  const m = DATE_RE.exec(value)!;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function parseTime(value: string): [number, number] {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`Invalid time '${value}', expected HH:mm (24h)`);
  return [Number(m[1]), Number(m[2])];
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** Converts an IST wall-clock date + time into the corresponding UTC instant. */
export function istToUtc(date: string, time: string): Date {
  const [y, mo, d] = parseDate(date);
  const [h, mi] = parseTime(time);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** Shifts an instant into IST so its UTC getters read IST wall-clock fields. */
function toIstShifted(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/** The IST calendar date ('YYYY-MM-DD') of an instant. */
export function istDateOf(instant: Date): string {
  return formatUtcDate(toIstShifted(instant));
}

/** The IST wall-clock time ('HH:mm') of an instant. */
export function istTimeOf(instant: Date): string {
  const s = toIstShifted(instant);
  return `${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = parseDate(date);
  return formatUtcDate(new Date(Date.UTC(y, mo - 1, d) + days * MS_PER_DAY));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  const [y, mo, d] = parseDate(date);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** Buses run Monday–Friday only. */
export function isOperationalDay(date: string): boolean {
  const wd = weekdayOf(date);
  return wd >= 1 && wd <= 5;
}

export function previousOperationalDay(date: string): string {
  let d = addDays(date, -1);
  while (!isOperationalDay(d)) d = addDays(d, -1);
  return d;
}

/** The calendar day on which booking/cancellation deadlines fall for a trip. */
export function cutoffDay(travelDate: string, rule: CutoffRule): string {
  return rule === 'PREVIOUS_CALENDAR_DAY'
    ? addDays(travelDate, -1)
    : previousOperationalDay(travelDate);
}

/** Inclusive list of dates between from and to. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface ScheduleRules {
  departureTime: string;
  bookingOpenDaysBefore: number;
  bookingOpenTime: string;
  bookingCloseTime: string;
  cancellationCloseTime: string;
  cutoffRule: CutoffRule;
}

export interface TripWindows {
  departureAt: Date;
  bookingOpensAt: Date;
  bookingClosesAt: Date;
  cancellationClosesAt: Date;
}

/**
 * Computes the authoritative instants for a trip on `travelDate`.
 *
 * - Booking opens `bookingOpenDaysBefore` calendar days before travel at `bookingOpenTime` IST
 *   (default: seven days before at 00:00, so a Monday trip opens the previous Monday at midnight).
 * - Booking closes at `bookingCloseTime` IST on the cutoff day (default 16:00 on the previous
 *   operational day, i.e. Friday 16:00 for Monday trips).
 * - Self-cancellation closes at `cancellationCloseTime` IST on the same cutoff day.
 *
 * Boundaries: a booking is accepted when `bookingOpensAt <= now < bookingClosesAt`.
 */
export function computeTripWindows(travelDate: string, rules: ScheduleRules): TripWindows {
  const cutoff = cutoffDay(travelDate, rules.cutoffRule);
  return {
    departureAt: istToUtc(travelDate, rules.departureTime),
    bookingOpensAt: istToUtc(
      addDays(travelDate, -rules.bookingOpenDaysBefore),
      rules.bookingOpenTime,
    ),
    bookingClosesAt: istToUtc(cutoff, rules.bookingCloseTime),
    cancellationClosesAt: istToUtc(cutoff, rules.cancellationCloseTime),
  };
}

export type BookingAvailability =
  'OPEN' | 'NOT_OPEN' | 'CLOSED' | 'FULL' | 'CANCELLED' | 'DEPARTED' | 'NOT_OPERATIONAL';

export interface AvailabilityInput {
  status: TripStatus;
  travelDate: string;
  departureAt: Date;
  bookingOpensAt: Date;
  bookingClosesAt: Date;
  capacity: number;
  bookedCount: number;
  /** Admin-created one-off trips may run on any day, including weekends and closures. */
  isSpecial?: boolean;
}

/**
 * Evaluates whether a trip accepts new bookings at `now`. Order matters:
 * cancellation and timing outrank capacity so users see the most relevant reason.
 */
export function bookingAvailability(trip: AvailabilityInput, now: Date): BookingAvailability {
  if (trip.status === 'CANCELLED') return 'CANCELLED';
  if (!trip.isSpecial && !isOperationalDay(trip.travelDate)) return 'NOT_OPERATIONAL';
  if (trip.status === 'COMPLETED' || now >= trip.departureAt) return 'DEPARTED';
  if (now < trip.bookingOpensAt) return 'NOT_OPEN';
  if (now >= trip.bookingClosesAt) return 'CLOSED';
  if (trip.bookedCount >= trip.capacity) return 'FULL';
  return 'OPEN';
}

/** Formats an instant for display in IST, e.g. "Mon, 19 Oct 2026, 4:00 PM". */
export function formatIst(
  instant: Date | string,
  opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts }).format(
    typeof instant === 'string' ? new Date(instant) : instant,
  );
}

/** Formats an 'HH:mm' wall-clock time as e.g. "1:30 PM". */
export function formatWallTime(time: string): string {
  const [h, m] = parseTime(time);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Formats a 'YYYY-MM-DD' date, e.g. "Mon, 19 Oct 2026". */
export function formatTravelDate(date: string): string {
  return formatIst(istToUtc(date, '12:00'), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
