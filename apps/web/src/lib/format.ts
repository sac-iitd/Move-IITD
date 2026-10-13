import {
  CAMPUS_LABELS,
  formatIst,
  formatTravelDate,
  formatWallTime,
  type TripDto,
} from '@iitd-bus/shared';
import { ApiError } from '../api/client';

export { formatIst, formatTravelDate, formatWallTime };

export function routeText(trip: Pick<TripDto, 'origin' | 'destination'>): string {
  return `${CAMPUS_LABELS[trip.origin]} → ${CAMPUS_LABELS[trip.destination]}`;
}

/** Short IST timestamp for deadlines, e.g. "Fri, 16 Oct, 4:00 pm". */
export function deadline(iso: string): string {
  return formatIst(iso, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}

export const LOGIN_ERRORS: Record<string, string> = {
  provider_denied: 'Sign-in was cancelled or denied at Kerberos.',
  state_expired: 'Your sign-in attempt timed out. Please try again.',
  state_mismatch: 'Your sign-in could not be verified. Please try again.',
  missing_code: 'Kerberos did not return a sign-in code. Please try again.',
  provider_error: 'Kerberos could not verify your sign-in. Please try again.',
  provider_unavailable: 'Kerberos is not reachable right now. Please try again shortly.',
  not_eligible:
    'Your account is not eligible to book this service. Contact the transport office if this is wrong.',
};
