/** All schedule display and cutoff logic uses India Standard Time. */
export const APP_TIMEZONE = 'Asia/Kolkata';
/** IST is a fixed UTC+05:30 offset with no daylight-saving transitions. */
export const IST_OFFSET_MINUTES = 330;

export const CAMPUSES = ['DELHI', 'SONIPAT'] as const;
export type Campus = (typeof CAMPUSES)[number];

export const CAMPUS_LABELS: Record<Campus, string> = {
  DELHI: 'IIT Delhi Hauz Khas Campus',
  SONIPAT: 'IIT Delhi Sonipat Campus',
};

export const DIRECTIONS = ['DELHI_TO_SONIPAT', 'SONIPAT_TO_DELHI'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const DIRECTION_LABELS: Record<Direction, string> = {
  DELHI_TO_SONIPAT: 'IIT Delhi Hauz Khas Campus → IIT Delhi Sonipat Campus',
  SONIPAT_TO_DELHI: 'IIT Delhi Sonipat Campus → IIT Delhi Hauz Khas Campus',
};

export function directionOf(origin: Campus, destination: Campus): Direction {
  if (origin === 'DELHI' && destination === 'SONIPAT') return 'DELHI_TO_SONIPAT';
  if (origin === 'SONIPAT' && destination === 'DELHI') return 'SONIPAT_TO_DELHI';
  throw new Error(`Unsupported route ${origin} → ${destination}`);
}

export function routeOf(direction: Direction): { origin: Campus; destination: Campus } {
  return direction === 'DELHI_TO_SONIPAT'
    ? { origin: 'DELHI', destination: 'SONIPAT' }
    : { origin: 'SONIPAT', destination: 'DELHI' };
}

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const TRIP_STATUSES = ['SCHEDULED', 'CANCELLED', 'COMPLETED'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const BOOKING_STATUSES = ['CONFIRMED', 'WAITLISTED', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'BOOKING_CONFIRMATION',
  'BOOKING_CANCELLATION',
  'TRIP_CANCELLATION',
  'WAITLIST_JOINED',
  'WAITLIST_PROMOTED',
  'WAITLIST_EXPIRED',
  'USER_BLOCKED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * SENDING is a short-lived claim state used by the outbox worker so two
 * workers never send the same message concurrently.
 */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * How the booking deadline is derived from the travel date.
 * - PREVIOUS_OPERATIONAL_DAY: the closest earlier Mon–Fri (Monday trips close the preceding Friday).
 * - PREVIOUS_CALENDAR_DAY: literally the day before (Monday trips close on Sunday).
 */
export const CUTOFF_RULES = ['PREVIOUS_OPERATIONAL_DAY', 'PREVIOUS_CALENDAR_DAY'] as const;
export type CutoffRule = (typeof CUTOFF_RULES)[number];

export const SCHEDULE_DEFAULTS = {
  bookingOpenDaysBefore: 7,
  bookingOpenTime: '00:00',
  bookingCloseTime: '16:00',
  // Institute decision (Oct 2026): self-cancellation closes at 2 PM the day before.
  cancellationCloseTime: '14:00',
  // Institute decision (Oct 2026): trips close at 4 PM the working day before,
  // so Monday trips close on Friday at 4 PM (cancellation on Friday at 2 PM).
  cutoffRule: 'PREVIOUS_OPERATIONAL_DAY' as CutoffRule,
} as const;

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'CSRF_INVALID',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'RATE_LIMITED',
  'TRIP_NOT_OPERATIONAL',
  'BOOKING_NOT_OPEN',
  'BOOKING_CLOSED',
  'TRIP_FULL',
  'TRIP_CANCELLED',
  'TRIP_DEPARTED',
  'ALREADY_BOOKED',
  'CANCELLATION_CLOSED',
  'BOOKING_ALREADY_CANCELLED',
  'CAPACITY_BELOW_BOOKED',
  'CONFLICT',
  'NOT_ELIGIBLE',
  'USER_BLOCKED',
  'SEAT_LIMIT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_MESSAGES: Partial<Record<ErrorCode, string>> = {
  BOOKING_NOT_OPEN: 'Booking for this trip has not opened yet.',
  BOOKING_CLOSED: 'Booking for this trip has closed.',
  TRIP_FULL: 'This trip is fully booked.',
  TRIP_CANCELLED: 'This trip has been cancelled.',
  TRIP_DEPARTED: 'This trip has already departed.',
  ALREADY_BOOKED: 'You already have a booking for this trip.',
  CANCELLATION_CLOSED: 'The cancellation deadline for this trip has passed.',
  BOOKING_ALREADY_CANCELLED: 'This booking is already cancelled.',
  TRIP_NOT_OPERATIONAL: 'Buses run Monday to Friday only.',
  NOT_ELIGIBLE: 'Your account is not eligible to book this service.',
  SEAT_LIMIT: 'You can hold at most 2 seats (including waitlist) on one trip.',
  USER_BLOCKED: 'Your booking access is currently blocked.',
};

/** Each Kerberos account may hold at most this many active (confirmed + waitlisted) seats per trip. */
export const MAX_SEATS_PER_TRIP = 2;

export const PASSENGER_TYPES = ['SELF', 'GUEST'] as const;
export type PassengerType = (typeof PASSENGER_TYPES)[number];

export const PURPOSES = ['ACADEMIC', 'ADMINISTRATIVE', 'OTHER'] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABELS: Record<Purpose, string> = {
  ACADEMIC: 'Academic',
  ADMINISTRATIVE: 'Administrative',
  OTHER: 'Other institutional activity',
};

/** IITD_ID is used for account holders (number = Kerberos id); guests declare Aadhaar or PAN. */
export const ID_TYPES = ['IITD_ID', 'AADHAAR', 'PAN'] as const;
export type IdType = (typeof ID_TYPES)[number];
export const GUEST_ID_TYPES = ['AADHAAR', 'PAN'] as const;
export const ID_TYPE_LABELS: Record<IdType, string> = {
  IITD_ID: 'IIT Delhi ID card',
  AADHAAR: 'Aadhaar',
  PAN: 'PAN card',
};
