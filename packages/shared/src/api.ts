import { z } from 'zod';
import {
  BOOKING_STATUSES,
  CAMPUSES,
  CUTOFF_RULES,
  DIRECTIONS,
  GUEST_ID_TYPES,
  PURPOSES,
  NOTIFICATION_STATUSES,
  NOTIFICATION_TYPES,
  TRIP_STATUSES,
  type BookingStatus,
  type Campus,
  type CutoffRule,
  type Direction,
  type ErrorCode,
  type NotificationStatus,
  type NotificationType,
  type IdType,
  type PassengerType,
  type Purpose,
  type TripStatus,
  type UserRole,
} from './constants';
import { isValidDateString, isValidTimeString, type BookingAvailability } from './schedule';

// ---------- Primitives ----------

export const dateStringSchema = z
  .string()
  .refine(isValidDateString, { message: 'Expected a valid date in YYYY-MM-DD format' });

export const timeStringSchema = z
  .string()
  .refine(isValidTimeString, { message: 'Expected a 24-hour time in HH:mm format' });

export const directionSchema = z.enum(DIRECTIONS);
export const campusSchema = z.enum(CAMPUSES);
export const cutoffRuleSchema = z.enum(CUTOFF_RULES);

/** Booking references look like "SNP-7K3M-Q9XD": unambiguous base32 characters. */
export const bookingReferenceSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^SNP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'Invalid booking reference');

export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid idempotency key');

const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Please give a reason (at least 3 characters)')
  .max(500);

// ---------- Passenger details ----------

/** Indian mobile number: 10 digits starting 6–9; an optional +91 / 0 prefix and spaces/dashes are stripped. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10-digit Indian mobile number');

/** Normalises and validates a guest ID number for its type. */
export function normalizeIdNumber(type: IdType, raw: string): string | null {
  const v = raw.replace(/[\s-]/g, '').toUpperCase();
  if (type === 'AADHAAR') return /^[2-9]\d{11}$/.test(v) ? v : null;
  if (type === 'PAN') return /^[A-Z]{5}\d{4}[A-Z]$/.test(v) ? v : null;
  return v.length > 0 ? v : null;
}

/** Shows only the last 4 characters, e.g. "XXXX XXXX 1234" / "XXXXXX123F". */
export function maskIdNumber(type: IdType, value: string): string {
  if (type === 'AADHAAR') return `XXXX XXXX ${value.slice(-4)}`;
  return 'X'.repeat(Math.max(0, value.length - 4)) + value.slice(-4);
}

const guestSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the passenger name').max(100),
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    idType: z.enum(GUEST_ID_TYPES),
    idNumber: z
      .string()
      .trim()
      .min(1, 'Enter the ID number')
      .max(30)
      // Field-level format check so it is reported together with other field errors.
      .refine(
        (v) => normalizeIdNumber('AADHAAR', v) !== null || normalizeIdNumber('PAN', v) !== null,
        'Enter a valid Aadhaar (12 digits) or PAN (ABCDE1234F)',
      ),
    phone: phoneSchema.optional(),
  })
  .transform((g, ctx) => {
    const idNumber = normalizeIdNumber(g.idType, g.idNumber);
    if (!idNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idNumber'],
        message:
          g.idType === 'AADHAAR' ? 'Aadhaar must be 12 digits' : 'PAN must look like ABCDE1234F',
      });
      return z.NEVER;
    }
    return { ...g, idNumber };
  });

/** Body of POST /trips/:tripId/bookings. */
export const createBookingSchema = z
  .object({
    passengerType: z.enum(['SELF', 'GUEST']),
    phone: phoneSchema,
    purpose: z.enum(PURPOSES),
    purposeDetail: z.string().trim().max(200).optional(),
    guest: guestSchema.optional(),
    /** Join the waiting list if the trip is full. */
    joinWaitlist: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.purpose === 'OTHER' && !b.purposeDetail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['purposeDetail'],
        message: 'Describe the purpose',
      });
    }
    if (b.passengerType === 'GUEST' && !b.guest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guest'],
        message: 'Guest details are required',
      });
    }
  });
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// ---------- Requests ----------

export const tripsQuerySchema = z
  .object({
    from: dateStringSchema.optional(),
    to: dateStringSchema.optional(),
    direction: directionSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` must be on or before `to`',
  });
export type TripsQuery = z.infer<typeof tripsQuerySchema>;

export const userCancelBookingSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const adminCancelSchema = z.object({ reason: reasonSchema });
export type AdminCancelInput = z.infer<typeof adminCancelSchema>;

const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};

export const adminTripsQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  direction: directionSchema.optional(),
  status: z.enum(TRIP_STATUSES).optional(),
});

export const adminBookingsQuerySchema = z.object({
  ...paginationSchema,
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  direction: directionSchema.optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  tripId: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(100).optional(),
});
export type AdminBookingsQuery = z.infer<typeof adminBookingsQuerySchema>;

export const adminNotificationsQuerySchema = z.object({
  ...paginationSchema,
  status: z.enum(NOTIFICATION_STATUSES).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});

export const adminAuditQuerySchema = z.object({
  ...paginationSchema,
  action: z.string().trim().max(100).optional(),
});

export const adminOverviewQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
  direction: directionSchema.optional(),
});

/** Stop regular service on a date (e.g. a national holiday). */
export const adminCreateClosureSchema = z.object({
  date: dateStringSchema,
  reason: reasonSchema,
});

/** A one-off trip on any date. Deadlines default to the standard rules when omitted. */
export const adminCreateSpecialTripSchema = z.object({
  travelDate: dateStringSchema,
  departureTime: timeStringSchema,
  direction: directionSchema,
  capacity: z.number().int().min(1).max(200),
  serviceLabel: z.string().trim().min(1).max(40).default('Special bus'),
  bookingOpensAt: z.string().datetime({ offset: true }).optional(),
  bookingClosesAt: z.string().datetime({ offset: true }).optional(),
  cancellationClosesAt: z.string().datetime({ offset: true }).optional(),
});
export type AdminCreateSpecialTrip = z.infer<typeof adminCreateSpecialTripSchema>;

export const generateTripsSchema = z.object({
  horizonDays: z.number().int().min(1).max(60).optional(),
});

/** Editing a generated trip. Instants are ISO-8601 strings. */
export const adminTripPatchSchema = z
  .object({
    capacity: z.number().int().min(1).max(200).optional(),
    departureTime: timeStringSchema.optional(),
    bookingOpensAt: z.string().datetime({ offset: true }).optional(),
    bookingClosesAt: z.string().datetime({ offset: true }).optional(),
    cancellationClosesAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied' });
export type AdminTripPatch = z.infer<typeof adminTripPatchSchema>;

export const adminTemplatePatchSchema = z
  .object({
    capacity: z.number().int().min(1).max(200).optional(),
    departureTime: timeStringSchema.optional(),
    active: z.boolean().optional(),
    bookingOpenDaysBefore: z.number().int().min(1).max(30).optional(),
    bookingOpenTime: timeStringSchema.optional(),
    bookingCloseTime: timeStringSchema.optional(),
    cancellationCloseTime: timeStringSchema.optional(),
    cutoffRule: cutoffRuleSchema.optional(),
    /** Marks a provisional timetable entry as confirmed by the institute. */
    timeConfirmed: z.literal(true).optional(),
    /**
     * Also update already-generated future trips of this template that have
     * no bookings yet. Trips with bookings are never silently rewritten.
     */
    applyToUnbookedTrips: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'applyToUnbookedTrips'), {
    message: 'No changes supplied',
  });
export type AdminTemplatePatch = z.infer<typeof adminTemplatePatchSchema>;

// ---------- Responses ----------

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string | null;
    role: UserRole;
    category: string | null;
  };
  csrfToken: string;
  /** Phone from the user's most recent booking, to prefill the form. */
  lastPhone: string | null;
  /** Present while the user is blocked from booking. */
  block: { until: string; reason: string } | null;
}

export interface PublicScheduleResponse {
  services: Array<{
    serviceLabel: string;
    capacity: number;
    origin: Campus;
    destination: Campus;
    direction: Direction;
    departureTime: string;
    timeProvisional: boolean;
    bookingOpenDaysBefore: number;
    bookingOpenTime: string;
    bookingCloseTime: string;
    cancellationCloseTime: string;
    cutoffRule: CutoffRule;
  }>;
}

export interface TripDto {
  id: string;
  serviceLabel: string;
  travelDate: string;
  origin: Campus;
  destination: Campus;
  direction: Direction;
  departureTime: string;
  departureAt: string;
  capacity: number;
  bookedCount: number;
  seatsRemaining: number;
  status: TripStatus;
  bookingOpensAt: string;
  bookingClosesAt: string;
  cancellationClosesAt: string;
  availability: BookingAvailability;
  timeProvisional: boolean;
  /** One-off trip added by an admin (may run on weekends/holidays). */
  isSpecial: boolean;
  /** People currently on the waiting list. */
  waitlistCount: number;
  /** The caller's active (confirmed or waitlisted) bookings on this trip. */
  myBookings: Array<{
    reference: string;
    status: BookingStatus;
    passengerType: PassengerType;
    passengerName: string;
  }>;
}

export interface TripsResponse {
  trips: TripDto[];
  serverTime: string;
}

export interface BookingDto {
  reference: string;
  status: BookingStatus;
  bookedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledByAdmin: boolean;
  canCancel: boolean;
  trip: TripDto;
  emailStatus: NotificationStatus | null;
  /** 1-based position while WAITLISTED. */
  waitlistPosition: number | null;
  passenger: PassengerDto;
}

export interface PassengerDto {
  type: PassengerType;
  name: string;
  email: string | null;
  phone: string | null;
  guestPhone: string | null;
  purpose: Purpose;
  purposeDetail: string | null;
  idType: IdType;
  /** Masked for users ("XXXX XXXX 1234"); null after data retention clean-up. */
  idNumberMasked: string | null;
}

export interface CreateBookingResponse {
  booking: BookingDto;
  /** true when this request created the booking; false when an idempotent replay returned it. */
  created: boolean;
}

export interface MyBookingsResponse {
  upcoming: BookingDto[];
  past: BookingDto[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminOverviewResponse {
  range: { from: string; to: string };
  todayTrips: number;
  totalBookings: number;
  seatsFilled: number;
  seatsRemaining: number;
  cancelledBookings: number;
  tripsAtCapacity: number;
  pendingNotifications: number;
  failedNotifications: number;
  provisionalTemplates: number;
}

export interface AdminTripDto extends TripDto {
  serviceTemplateId: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
}

export interface ServiceTemplateDto {
  id: string;
  serviceLabel: string;
  capacity: number;
  origin: Campus;
  destination: Campus;
  direction: Direction;
  departureTime: string;
  active: boolean;
  timeProvisional: boolean;
  bookingOpenDaysBefore: number;
  bookingOpenTime: string;
  bookingCloseTime: string;
  cancellationCloseTime: string;
  cutoffRule: CutoffRule;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface AdminBookingDto {
  reference: string;
  status: BookingStatus;
  userName: string;
  userEmail: string | null;
  userSubject: string;
  tripId: string;
  serviceLabel: string;
  direction: Direction;
  travelDate: string;
  departureTime: string;
  bookedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledByAdmin: boolean;
  emailStatus: NotificationStatus | null;
  passengerType: PassengerType;
  passengerName: string;
  passengerEmail: string | null;
  phone: string | null;
  purpose: Purpose;
  purposeDetail: string | null;
  idType: IdType;
  /** Full ID number (admins only). IITD_ID = Kerberos id. Null after retention clean-up. */
  idNumber: string | null;
  waitlistPosition: number | null;
}

export interface ManifestResponse {
  trip: AdminTripDto;
  generatedAt: string;
  passengers: Array<{
    serial: number;
    reference: string;
    name: string;
    phone: string | null;
    purpose: string;
    passengerType: PassengerType;
    bookedBy: string;
    idType: IdType;
    idNumber: string | null;
  }>;
  waitlist: Array<{ position: number; reference: string; name: string; phone: string | null }>;
}

export const adminBlockSchema = z
  .object({
    userId: z.string().min(1).max(64),
    startsOn: dateStringSchema,
    endsOn: dateStringSchema,
    reason: reasonSchema,
  })
  .refine((b) => b.startsOn <= b.endsOn, { message: 'End date must be on or after start date' });

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface AdminUserDto {
  id: string;
  name: string;
  email: string | null;
  subject: string;
  role: UserRole;
  lastLoginAt: string | null;
  activeBlock: UserBlockDto | null;
}

export interface UserBlockDto {
  id: string;
  userId: string;
  userName: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  createdByName: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  recipient: string;
  status: NotificationStatus;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
  bookingReference: string | null;
  tripId: string | null;
}

export const adminAnalyticsQuerySchema = z.object({
  from: dateStringSchema.optional(),
  to: dateStringSchema.optional(),
});

export interface AnalyticsResponse {
  range: { from: string; to: string };
  totals: {
    bookings: number;
    cancelled: number;
    cancellationRate: number;
    seatsOffered: number;
    seatsFilled: number;
    occupancy: number;
    trips: number;
    cancelledTrips: number;
  };
  /** One row per travel date with service. */
  daily: Array<{
    date: string;
    confirmed: number;
    cancelled: number;
    capacity: number;
    occupancy: number;
  }>;
  /** Average load per recurring departure (and special trips grouped by label). */
  byDeparture: Array<{
    key: string;
    serviceLabel: string;
    departureTime: string;
    direction: Direction;
    trips: number;
    confirmed: number;
    capacity: number;
    occupancy: number;
  }>;
  /** Mon=1 … Sun=7. */
  byWeekday: Array<{ weekday: number; confirmed: number; capacity: number; occupancy: number }>;
  byDirection: Array<{ direction: Direction; confirmed: number; capacity: number }>;
  /** Days between booking and departure, for confirmed and cancelled bookings. */
  leadTime: Array<{ bucket: string; bookings: number }>;
}

export interface ServiceClosureDto {
  id: string;
  date: string;
  reason: string;
  createdByName: string | null;
  createdAt: string;
}

export interface AuditLogDto {
  id: string;
  actorName: string | null;
  actorSubject: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}
