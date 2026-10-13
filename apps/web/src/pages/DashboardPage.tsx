import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  DIRECTION_LABELS,
  addDays,
  istDateOf,
  istToUtc,
  isOperationalDay,
  type Direction,
  type TripDto,
  type TripsResponse,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { BookTripDialog } from '../components/BookTripDialog';
import { TripCard } from '../components/TripCard';
import { Alert, EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { formatIst, formatTravelDate } from '../lib/format';

const HORIZON_DAYS = 13;

function upcomingOperationalDays(today: string): string[] {
  const out: string[] = [];
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    if (isOperationalDay(d)) out.push(d);
  }
  return out;
}

const chip = (active: boolean) =>
  `min-h-11 shrink-0 cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium ${
    active
      ? 'border-ink-900 bg-ink-900 text-brand-100'
      : 'border-ink-900/20 bg-white text-ink-900 hover:bg-brand-100'
  }`;

export function DashboardPage() {
  const { user, block } = useAuth();
  const [params, setParams] = useSearchParams();
  const today = istDateOf(new Date());
  const days = useMemo(() => upcomingOperationalDays(today), [today]);
  const date = params.get('date');
  const direction = (params.get('direction') as Direction | null) ?? null;
  const [booking, setBooking] = useState<TripDto | null>(null);

  const from = date ?? today;
  const to = date ?? addDays(today, HORIZON_DAYS);
  const trips = useQuery({
    queryKey: ['trips', from, to, direction],
    queryFn: () => {
      const q = new URLSearchParams({ from, to });
      if (direction) q.set('direction', direction);
      return api<TripsResponse>(`/trips?${q}`);
    },
    refetchInterval: 60_000,
  });

  const setFilter = (key: 'date' | 'direction', value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, TripDto[]>();
    for (const t of trips.data?.trips ?? []) {
      map.set(t.travelDate, [...(map.get(t.travelDate) ?? []), t]);
    }
    return [...map.entries()];
  }, [trips.data]);

  return (
    <div>
      <PageHeader title={`Hello, ${user?.name.split(' ')[0] ?? 'there'}`}>
        {trips.data && (
          <p className="text-xs text-ink-800">
            Updated {formatIst(trips.data.serverTime, { hour: 'numeric', minute: '2-digit' })} IST
          </p>
        )}
      </PageHeader>

      {block && (
        <div className="mb-4">
          <Alert tone="error" title={`Booking paused until ${formatTravelDate(block.until)}`}>
            {block.reason}. You can still view and cancel your existing bookings. Contact the
            Student Affairs Council if you think this is a mistake.
          </Alert>
        </div>
      )}
      <p className="mb-4 text-xs text-ink-800">
        Booking opens 7 days ahead and closes at 4:00 PM the day before travel. Cancel by 2:00 PM
        the day before. Full trip? Join the waiting list. The first person gets the next free seat
        automatically.
      </p>

      <section aria-label="Filters" className="mb-6 space-y-3">
        <div>
          <p id="date-filter" className="label">
            Travel date
          </p>
          <div
            role="group"
            aria-labelledby="date-filter"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
          >
            <button
              type="button"
              className={chip(!date)}
              aria-pressed={!date}
              onClick={() => setFilter('date', null)}
            >
              All upcoming
            </button>
            {days.map((d) => (
              <button
                key={d}
                type="button"
                className={chip(date === d)}
                aria-pressed={date === d}
                onClick={() => setFilter('date', d)}
              >
                {d === today
                  ? 'Today'
                  : formatIst(istToUtc(d, '12:00'), {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p id="dir-filter" className="label">
            Direction
          </p>
          <div role="group" aria-labelledby="dir-filter" className="flex flex-wrap gap-2">
            <button
              type="button"
              className={chip(!direction)}
              aria-pressed={!direction}
              onClick={() => setFilter('direction', null)}
            >
              Both
            </button>
            {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
              <button
                key={d}
                type="button"
                className={chip(direction === d)}
                aria-pressed={direction === d}
                onClick={() => setFilter('direction', d)}
              >
                {DIRECTION_LABELS[d]}
              </button>
            ))}
          </div>
        </div>
      </section>

      {trips.isPending ? (
        <LoadingSkeleton rows={4} label="Loading trips" />
      ) : trips.isError ? (
        <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
      ) : grouped.length === 0 ? (
        <EmptyState title="No trips found">
          Buses run Monday to Friday. Try another date or direction.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {grouped.map(([day, list]) => (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 id={`day-${day}`} className="mb-3 text-lg font-bold">
                {formatTravelDate(day)}
              </h2>
              <div className="space-y-3">
                {list.map((t) => (
                  <TripCard key={t.id} trip={t} onBook={setBooking} blocked={block !== null} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <BookTripDialog trip={booking} onClose={() => setBooking(null)} />
    </div>
  );
}
