import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BookingDto, MyBookingsResponse } from '@iitd-bus/shared';
import { api } from '../api/client';
import { BookingStatusBadge, DirectionBadge, NotificationStatusBadge } from '../components/Badges';
import { CancelBookingDialog } from '../components/CancelBookingDialog';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { deadline, formatTravelDate, formatWallTime, routeText } from '../lib/format';

function BookingRow({ b, onCancel }: { b: BookingDto; onCancel: (b: BookingDto) => void }) {
  return (
    <li className="card trip-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/bookings/${b.reference}`}
            className="font-mono font-semibold text-ink-900 underline-offset-2 hover:underline"
          >
            {b.reference}
          </Link>
          <BookingStatusBadge status={b.status} position={b.waitlistPosition} />
          <DirectionBadge direction={b.trip.direction} />
          <span className="text-xs font-semibold text-ink-800">{b.trip.serviceLabel}</span>
          {b.trip.status === 'CANCELLED' && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">
              Trip cancelled
            </span>
          )}
        </div>
        <p className="text-sm">
          <strong>{formatTravelDate(b.trip.travelDate)}</strong> ·{' '}
          {formatWallTime(b.trip.departureTime)} · {routeText(b.trip)}
        </p>
        <p className="text-xs text-ink-800">
          Passenger: <strong>{b.passenger.name}</strong>
          {b.passenger.type === 'GUEST' && ' (guest)'}
        </p>
        {b.status === 'CANCELLED' && b.cancellationReason && (
          <p className="text-xs text-ink-800">Reason: {b.cancellationReason}</p>
        )}
        {b.canCancel && (
          <p className="text-xs text-ink-800">
            {b.status === 'WAITLISTED'
              ? `Waiting list closes ${deadline(b.trip.bookingClosesAt)}`
              : `Cancel by ${deadline(b.trip.cancellationClosesAt)}`}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3">
        {b.status === 'CONFIRMED' && <NotificationStatusBadge status={b.emailStatus} />}
        {b.canCancel && (
          <button type="button" className="btn-secondary" onClick={() => onCancel(b)}>
            {b.status === 'WAITLISTED' ? 'Leave waiting list' : 'Cancel'}
          </button>
        )}
      </div>
    </li>
  );
}

export function MyBookingsPage() {
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  const q = useQuery({
    queryKey: ['my-bookings'],
    queryFn: () => api<MyBookingsResponse>('/bookings/mine'),
  });

  return (
    <div>
      <PageHeader title="My bookings">
        <Link to="/dashboard" className="btn-primary">
          Book a bus
        </Link>
      </PageHeader>
      {q.isPending ? (
        <LoadingSkeleton rows={3} label="Loading your bookings" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="upcoming-h">
            <h2 id="upcoming-h" className="mb-3 text-lg font-bold">
              Upcoming
            </h2>
            {q.data.upcoming.length === 0 ? (
              <EmptyState title="No upcoming bookings">
                <Link to="/dashboard" className="underline">
                  Find a trip
                </Link>
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {q.data.upcoming.map((b) => (
                  <BookingRow key={b.reference} b={b} onCancel={setCancelling} />
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="past-h">
            <h2 id="past-h" className="mb-3 text-lg font-bold">
              Past
            </h2>
            {q.data.past.length === 0 ? (
              <p className="text-sm text-ink-800">No past trips yet.</p>
            ) : (
              <ul className="space-y-3">
                {q.data.past.map((b) => (
                  <BookingRow key={b.reference} b={b} onCancel={setCancelling} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <CancelBookingDialog booking={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
