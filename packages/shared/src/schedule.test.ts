import { describe, expect, it } from 'vitest';
import {
  addDays,
  bookingAvailability,
  computeTripWindows,
  cutoffDay,
  formatWallTime,
  istDateOf,
  istTimeOf,
  istToUtc,
  isOperationalDay,
  isValidDateString,
  previousOperationalDay,
  type AvailabilityInput,
  type ScheduleRules,
} from './schedule';

const rules: ScheduleRules = {
  departureTime: '07:30',
  bookingOpenDaysBefore: 7,
  bookingOpenTime: '00:00',
  bookingCloseTime: '16:00',
  cancellationCloseTime: '16:00',
  cutoffRule: 'PREVIOUS_OPERATIONAL_DAY',
};

// Reference week: Mon 2026-10-19 … Fri 2026-10-23.
const MON = '2026-10-19';
const TUE = '2026-10-20';

describe('IST conversion (fixed +05:30, no DST)', () => {
  it('converts wall-clock IST to UTC', () => {
    expect(istToUtc(MON, '07:30').toISOString()).toBe('2026-10-19T02:00:00.000Z');
    expect(istToUtc(MON, '00:00').toISOString()).toBe('2026-10-18T18:30:00.000Z');
  });

  it('derives IST date/time from instants across the UTC date line', () => {
    const justAfterIstMidnight = new Date('2026-10-18T18:30:00.000Z');
    expect(istDateOf(justAfterIstMidnight)).toBe(MON);
    expect(istDateOf(new Date('2026-10-18T18:29:59.999Z'))).toBe('2026-10-18');
    expect(istTimeOf(new Date('2026-10-19T08:00:00Z'))).toBe('13:30');
  });

  it('applies the same offset in January and July (daylight-independent)', () => {
    expect(istToUtc('2027-01-15', '16:00').toISOString()).toBe('2027-01-15T10:30:00.000Z');
    expect(istToUtc('2027-07-15', '16:00').toISOString()).toBe('2027-07-15T10:30:00.000Z');
  });

  it('validates calendar dates strictly', () => {
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-1-5')).toBe(false);
  });
});

describe('operational days', () => {
  it('runs Monday–Friday only', () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
    expect(week.map(isOperationalDay)).toEqual([true, true, true, true, true, false, false]);
  });

  it('finds the previous operational day', () => {
    expect(previousOperationalDay(MON)).toBe('2026-10-16'); // Friday
    expect(previousOperationalDay(TUE)).toBe(MON);
    expect(previousOperationalDay('2027-01-04')).toBe('2027-01-01'); // across year end
  });

  it('supports the literal previous-calendar-day rule as an alternative', () => {
    expect(cutoffDay(MON, 'PREVIOUS_CALENDAR_DAY')).toBe('2026-10-18'); // Sunday
    expect(cutoffDay(MON, 'PREVIOUS_OPERATIONAL_DAY')).toBe('2026-10-16'); // Friday
  });
});

describe('trip windows', () => {
  it('opens seven calendar days before at the opening time', () => {
    const w = computeTripWindows(MON, rules);
    // Previous Monday 00:00 IST
    expect(w.bookingOpensAt.toISOString()).toBe('2026-10-11T18:30:00.000Z');
    expect(istDateOf(w.bookingOpensAt)).toBe('2026-10-12');
  });

  it('closes Monday trips at 4 PM IST on the preceding Friday', () => {
    const w = computeTripWindows(MON, rules);
    expect(w.bookingClosesAt.toISOString()).toBe('2026-10-16T10:30:00.000Z');
    expect(w.cancellationClosesAt.toISOString()).toBe('2026-10-16T10:30:00.000Z');
  });

  it('closes Tuesday–Friday trips at 4 PM IST the day before', () => {
    const w = computeTripWindows(TUE, rules);
    expect(w.bookingClosesAt.toISOString()).toBe('2026-10-19T10:30:00.000Z');
  });

  it('closes Monday trips on Sunday under PREVIOUS_CALENDAR_DAY', () => {
    const w = computeTripWindows(MON, { ...rules, cutoffRule: 'PREVIOUS_CALENDAR_DAY' });
    expect(w.bookingClosesAt.toISOString()).toBe('2026-10-18T10:30:00.000Z');
  });

  it('honours custom cancellation and opening times', () => {
    const w = computeTripWindows(TUE, {
      ...rules,
      bookingOpenTime: '16:00',
      cancellationCloseTime: '12:00',
    });
    expect(w.bookingOpensAt.toISOString()).toBe('2026-10-13T10:30:00.000Z');
    expect(w.cancellationClosesAt.toISOString()).toBe('2026-10-19T06:30:00.000Z');
  });
});

describe('booking availability boundaries', () => {
  const w = computeTripWindows(MON, rules);
  const trip: AvailabilityInput = {
    status: 'SCHEDULED',
    travelDate: MON,
    capacity: 13,
    bookedCount: 0,
    ...w,
  };
  const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);

  it('rejects requests one millisecond before opening and accepts at opening', () => {
    expect(bookingAvailability(trip, ms(w.bookingOpensAt, -1))).toBe('NOT_OPEN');
    expect(bookingAvailability(trip, w.bookingOpensAt)).toBe('OPEN');
  });

  it('accepts until just before the deadline and rejects at the deadline', () => {
    expect(bookingAvailability(trip, ms(w.bookingClosesAt, -1))).toBe('OPEN');
    expect(bookingAvailability(trip, w.bookingClosesAt)).toBe('CLOSED');
  });

  it('rejects Saturday/Sunday after Friday 4 PM for Monday trips', () => {
    expect(bookingAvailability(trip, istToUtc('2026-10-17', '10:00'))).toBe('CLOSED');
    expect(bookingAvailability(trip, istToUtc('2026-10-18', '15:00'))).toBe('CLOSED');
  });

  it('reports full, cancelled, departed and weekend trips', () => {
    const open = istToUtc('2026-10-14', '12:00');
    expect(bookingAvailability({ ...trip, bookedCount: 13 }, open)).toBe('FULL');
    expect(bookingAvailability({ ...trip, status: 'CANCELLED' }, open)).toBe('CANCELLED');
    expect(bookingAvailability(trip, ms(w.departureAt, 1))).toBe('DEPARTED');
    expect(bookingAvailability({ ...trip, travelDate: '2026-10-24' }, open)).toBe(
      'NOT_OPERATIONAL',
    );
  });
});

describe('formatting', () => {
  it('formats wall-clock times', () => {
    expect(formatWallTime('13:30')).toBe('1:30 PM');
    expect(formatWallTime('07:30')).toBe('7:30 AM');
    expect(formatWallTime('00:00')).toBe('12:00 AM');
    expect(formatWallTime('12:00')).toBe('12:00 PM');
  });
});
