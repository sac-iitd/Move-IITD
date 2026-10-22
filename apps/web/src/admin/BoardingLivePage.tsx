import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DIRECTION_LABELS, istDateOf, type LiveBoardingResponse } from '@iitd-bus/shared';
import { api } from '../api/client';
import { SpecialBadge } from '../components/Badges';
import { EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { formatIst, formatTravelDate, formatWallTime } from '../lib/format';

/** Who booked each vehicle today, and whose pass has been scanned. */
export function BoardingLivePage() {
  const [date, setDate] = useState(() => istDateOf(new Date()));
  const q = useQuery({
    queryKey: ['admin', 'boarding', date],
    refetchInterval: 4000,
    queryFn: () => api<LiveBoardingResponse>(`/admin/boarding?date=${date}`),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Live boarding">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Travel date</span>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </PageHeader>
      <p className="text-sm text-ink-800">
        Confirmed passengers, and who has already boarded. This page refreshes on its own.
      </p>
      {q.isPending ? (
        <LoadingSkeleton rows={3} label="Loading boarding" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.trips.length === 0 ? (
        <EmptyState title="No vehicles on this date" />
      ) : (
        <div className="space-y-4">
          {q.data.trips.map(({ trip, passengers }) => (
            <section key={trip.id} className="card p-4" aria-labelledby={`live-${trip.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id={`live-${trip.id}`} className="text-lg font-bold">
                    {trip.vehicleNumber ? `${trip.vehicleNumber}. ` : ''}
                    {formatWallTime(trip.departureTime)} · {trip.serviceLabel}
                    {trip.isSpecial && (
                      <span className="ml-2">
                        <SpecialBadge />
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-ink-800">
                    {formatTravelDate(trip.travelDate)} · {DIRECTION_LABELS[trip.direction]}
                    {trip.status === 'CANCELLED' ? ' · Cancelled' : ''}
                  </p>
                  <p className="mt-1 text-sm">
                    <strong>{trip.boardedCount}</strong> boarded of {trip.bookedCount} booked
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link to={`/conduct?trip=${trip.id}`} className="btn-primary min-h-9 px-3 py-1">
                    Scan
                  </Link>
                  <Link
                    to={`/admin/trips/${trip.id}/manifest`}
                    className="btn-secondary min-h-9 px-3 py-1"
                  >
                    Full list
                  </Link>
                </div>
              </div>
              {passengers.length === 0 ? (
                <p className="mt-3 text-sm text-ink-800">No confirmed passengers.</p>
              ) : (
                <ul className="mt-3 divide-y divide-ink-900/10">
                  {passengers.map((p) => (
                    <li
                      key={p.reference}
                      className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 font-mono text-xs text-ink-800">{p.reference}</span>
                      </span>
                      {p.boardedAt ? (
                        <span className="text-emerald-800">
                          Boarded {formatIst(p.boardedAt)}
                          {p.scannedByName ? ` · ${p.scannedByName}` : ''}
                        </span>
                      ) : (
                        <span className="text-ink-800">Not boarded</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
