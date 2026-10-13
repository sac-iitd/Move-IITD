import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  istDateOf,
  type AdminOverviewResponse,
  type AdminTripDto,
  type Direction,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { CapacityIndicator, DirectionBadge, TripStatusBadge } from '../components/Badges';
import { Alert, EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { formatTravelDate, formatWallTime } from '../lib/format';
import { AdminStatCard, DateRangeFilter, DirectionSelect } from './components';

export function OverviewPage() {
  const today = istDateOf(new Date());
  const [range, setRange] = useState({ from: today, to: today });
  const [direction, setDirection] = useState<Direction | ''>('');
  const qs = new URLSearchParams({
    from: range.from,
    to: range.to,
    ...(direction && { direction }),
  });

  const overview = useQuery({
    queryKey: ['admin', 'overview', range, direction],
    queryFn: () => api<AdminOverviewResponse>(`/admin/overview?${qs}`),
    refetchInterval: 30_000,
  });
  const trips = useQuery({
    queryKey: ['admin', 'trips', range, direction, 'overview'],
    queryFn: () => api<{ trips: AdminTripDto[] }>(`/admin/trips?${qs}`),
    refetchInterval: 30_000,
  });

  const o = overview.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <DateRangeFilter
          from={range.from}
          to={range.to}
          onChange={(r) => r.from && r.to && setRange(r)}
        />
        <DirectionSelect value={direction} onChange={setDirection} />
      </div>

      {o && o.provisionalTemplates > 0 && (
        <Alert
          tone="warning"
          title="Timetable entry awaiting confirmation"
          action={
            <Link to="/admin/trips" className="btn-secondary">
              Review
            </Link>
          }
        >
          {o.provisionalTemplates} departure time(s) are marked provisional. Confirm or correct them
          under Trips &amp; schedule.
        </Alert>
      )}
      {o && o.failedNotifications > 0 && (
        <Alert
          tone="error"
          title={`${o.failedNotifications} email(s) failed`}
          action={
            <Link to="/admin/notifications" className="btn-secondary">
              View
            </Link>
          }
        >
          Some notifications could not be delivered.
        </Alert>
      )}

      {overview.isPending ? (
        <LoadingSkeleton rows={2} label="Loading summary" />
      ) : overview.isError ? (
        <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <AdminStatCard label="Today's trips" value={o!.todayTrips} />
          <AdminStatCard label="Bookings" value={o!.totalBookings} />
          <AdminStatCard label="Seats filled" value={o!.seatsFilled} />
          <AdminStatCard label="Seats left" value={o!.seatsRemaining} />
          <AdminStatCard label="Cancelled" value={o!.cancelledBookings} />
          <AdminStatCard
            label="At capacity"
            value={o!.tripsAtCapacity}
            tone={o!.tripsAtCapacity > 0 ? 'warn' : 'default'}
          />
        </div>
      )}

      <section aria-labelledby="cap-h">
        <h2 id="cap-h" className="mb-3 text-lg font-bold">
          Per-trip capacity
        </h2>
        {trips.isPending ? (
          <LoadingSkeleton rows={3} label="Loading trips" />
        ) : trips.isError ? (
          <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
        ) : trips.data.trips.length === 0 ? (
          <EmptyState title="No trips in this range">Weekends have no service.</EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {trips.data.trips.map((t) => (
              <li key={t.id} className="card space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">
                    {formatWallTime(t.departureTime)}
                  </span>
                  <span className="text-sm text-ink-800">{formatTravelDate(t.travelDate)}</span>
                  <DirectionBadge direction={t.direction} />
                  <TripStatusBadge status={t.status} />
                </div>
                <p className="text-sm">
                  {t.serviceLabel}: <strong>{t.bookedCount}</strong> booked / {t.capacity} capacity
                  / {t.seatsRemaining} available
                </p>
                {t.status !== 'CANCELLED' && (
                  <CapacityIndicator booked={t.bookedCount} capacity={t.capacity} />
                )}
                <Link
                  to={`/admin/bookings?tripId=${t.id}`}
                  className="text-sm font-medium underline"
                >
                  Passenger list
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
