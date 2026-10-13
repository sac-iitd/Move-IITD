import { Link } from 'react-router-dom';
import { MAX_SEATS_PER_TRIP, type TripDto } from '@iitd-bus/shared';
import { BookingStatusBadge, CapacityIndicator, DirectionBadge, SpecialBadge } from './Badges';
import { deadline, formatWallTime, routeText } from '../lib/format';

/** User-facing explanation of a trip's booking state. */
export function availabilityMessage(trip: TripDto): { text: string; tone: string } {
  switch (trip.availability) {
    case 'OPEN':
      return {
        text: `Booking open · closes ${deadline(trip.bookingClosesAt)}`,
        tone: 'text-ink-800',
      };
    case 'NOT_OPEN':
      return {
        text: `Booking not open yet · opens ${deadline(trip.bookingOpensAt)}`,
        tone: 'text-sky-900',
      };
    case 'CLOSED':
      return { text: 'Booking closed', tone: 'text-zinc-700' };
    case 'FULL':
      return {
        text: `Fully booked${trip.waitlistCount ? ` · ${trip.waitlistCount} on waiting list` : ''} · waitlist closes ${deadline(trip.bookingClosesAt)}`,
        tone: 'text-red-800',
      };
    case 'CANCELLED':
      return { text: 'Trip cancelled', tone: 'text-red-800' };
    case 'DEPARTED':
      return { text: 'Departed', tone: 'text-zinc-700' };
    case 'NOT_OPERATIONAL':
      return { text: 'No service on weekends', tone: 'text-zinc-700' };
  }
}

export function TripCard({
  trip,
  onBook,
  blocked = false,
}: {
  trip: TripDto;
  onBook: (trip: TripDto) => void;
  blocked?: boolean;
}) {
  const msg = availabilityMessage(trip);
  const mine = trip.myBookings;
  const seatsLeftForMe = MAX_SEATS_PER_TRIP - mine.length;
  const canBook = trip.availability === 'OPEN' && seatsLeftForMe > 0 && !blocked;
  const canWaitlist = trip.availability === 'FULL' && seatsLeftForMe > 0 && !blocked;
  const cancelled = trip.status === 'CANCELLED';
  const label = blocked
    ? 'Booking paused'
    : canBook
      ? mine.length
        ? 'Book another seat'
        : 'Book seat'
      : canWaitlist
        ? 'Join waiting list'
        : mine.length >= MAX_SEATS_PER_TRIP
          ? 'Seat limit reached'
          : trip.availability === 'FULL'
            ? 'Full'
            : 'Unavailable';

  return (
    <article
      className={`card trip-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6 ${cancelled ? 'opacity-75' : ''}`}
      aria-label={`${formatWallTime(trip.departureTime)} ${routeText(trip)}`}
    >
      <div className="flex items-baseline gap-3 sm:w-36 sm:flex-col sm:gap-1">
        <p
          className={`text-2xl font-bold tabular-nums text-ink-900 ${cancelled ? 'line-through' : ''}`}
        >
          {formatWallTime(trip.departureTime)}
        </p>
        <p className="text-xs font-semibold tracking-wide text-ink-800">{trip.serviceLabel}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DirectionBadge direction={trip.direction} />
          {trip.isSpecial && <SpecialBadge />}
          {trip.timeProvisional && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
              Time to be confirmed
            </span>
          )}
        </div>
        <p className="text-sm text-ink-800">{routeText(trip)}</p>
        {!cancelled && <CapacityIndicator booked={trip.bookedCount} capacity={trip.capacity} />}
        <p className={`text-sm font-medium ${msg.tone}`}>{msg.text}</p>
        {mine.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Your bookings on this trip">
            {mine.map((b) => (
              <li key={b.reference}>
                <Link
                  to={`/bookings/${b.reference}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-ink-900/15 bg-brand-50 px-2 py-1 text-xs hover:bg-brand-100"
                >
                  <BookingStatusBadge status={b.status} />
                  <span>{b.passengerType === 'SELF' ? 'You' : b.passengerName}</span>
                  <span className="font-mono">{b.reference}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sm:w-44 sm:text-right">
        <button
          type="button"
          className={`${canWaitlist ? 'btn-gold' : 'btn-primary'} w-full sm:w-auto`}
          disabled={!canBook && !canWaitlist}
          onClick={() => onBook(trip)}
          aria-label={
            canBook || canWaitlist
              ? `${label}: ${formatWallTime(trip.departureTime)} ${routeText(trip)}`
              : msg.text
          }
        >
          {label}
        </button>
      </div>
    </article>
  );
}
