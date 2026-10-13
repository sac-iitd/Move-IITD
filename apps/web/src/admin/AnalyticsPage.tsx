import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DIRECTION_LABELS,
  addDays,
  formatWallTime,
  istDateOf,
  type AnalyticsResponse,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { ErrorState, LoadingSkeleton } from '../components/ui';
import { formatIst, formatTravelDate } from '../lib/format';
import { AdminStatCard, DateRangeFilter } from './components';
import { BarList, ChartCard, ColumnChart, SplitBar } from './charts';

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function presets(today: string) {
  return [
    { id: '7', label: 'Last 7 days', from: addDays(today, -6), to: today },
    { id: '30', label: 'Last 30 days', from: addDays(today, -29), to: today },
    { id: '90', label: 'Last 90 days', from: addDays(today, -89), to: today },
    { id: 'next', label: 'Next 7 days', from: today, to: addDays(today, 7) },
  ];
}

const shortDate = (d: string) =>
  formatIst(`${d}T06:30:00.000Z`, { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function AnalyticsPage() {
  const today = istDateOf(new Date());
  const options = presets(today);
  const [range, setRange] = useState({ from: options[1]!.from, to: options[1]!.to });
  const q = useQuery({
    queryKey: ['admin', 'analytics', range],
    queryFn: () => api<AnalyticsResponse>(`/admin/analytics?${new URLSearchParams(range)}`),
    placeholderData: (prev) => prev,
  });
  const activePreset = options.find((o) => o.from === range.from && o.to === range.to)?.id;

  return (
    <div className="space-y-6">
      {/* Filters: one row above the charts. */}
      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label="Date range presets" className="flex flex-wrap gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={activePreset === o.id}
              className={`min-h-11 cursor-pointer rounded-lg border px-3 text-sm font-medium ${
                activePreset === o.id
                  ? 'border-ink-900 bg-ink-900 text-brand-100'
                  : 'border-ink-900/20 bg-white hover:bg-brand-100'
              }`}
              onClick={() => setRange({ from: o.from, to: o.to })}
            >
              {o.label}
            </button>
          ))}
        </div>
        <DateRangeFilter
          from={range.from}
          to={range.to}
          onChange={(r) => r.from && r.to && r.from <= r.to && setRange(r)}
        />
      </div>

      {q.isPending ? (
        <LoadingSkeleton rows={4} label="Loading analytics" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <AnalyticsBody data={q.data} />
      )}
    </div>
  );
}

function AnalyticsBody({ data }: { data: AnalyticsResponse }) {
  const t = data.totals;
  const dir = (d: 'DELHI_TO_SONIPAT' | 'SONIPAT_TO_DELHI') =>
    data.byDirection.find((x) => x.direction === d)?.confirmed ?? 0;

  return (
    <>
      <p className="text-xs text-ink-800">
        {formatTravelDate(data.range.from)} – {formatTravelDate(data.range.to)} · cancelled trips
        are excluded from seats offered.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard label="Occupancy" value={`${t.occupancy}%`} />
        <AdminStatCard label="Seats booked" value={t.seatsFilled} />
        <AdminStatCard label="Cancellation rate" value={`${t.cancellationRate}%`} />
        <AdminStatCard label="Trips run" value={t.trips} />
      </div>
      <p className="text-xs text-ink-800">
        {t.seatsOffered} seats offered · {t.bookings} active bookings · {t.cancelled} cancelled ·{' '}
        {t.cancelledTrips} trips cancelled
      </p>

      <ChartCard
        title="Seats booked per day"
        subtitle="Confirmed seats on each travel date. Hover or focus a bar for capacity and cancellations."
        table={{
          headers: ['Date', 'Seats booked', 'Capacity', 'Occupancy', 'Cancelled'],
          rows: data.daily.map((d) => [
            d.date,
            d.confirmed,
            d.capacity,
            `${d.occupancy}%`,
            d.cancelled,
          ]),
        }}
      >
        <ColumnChart
          ariaLabel="Seats booked per day"
          data={data.daily.map((d) => ({
            key: d.date,
            label: shortDate(d.date),
            value: d.confirmed,
            tooltip: [
              `${d.confirmed} of ${d.capacity} seats booked (${d.occupancy}%)`,
              `${d.cancelled} cancellation${d.cancelled === 1 ? '' : 's'}`,
            ],
          }))}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Occupancy by departure"
          subtitle="Average share of seats booked."
          table={{
            headers: [
              'Departure',
              'Vehicle',
              'Direction',
              'Trips',
              'Seats booked',
              'Capacity',
              'Occupancy',
            ],
            rows: data.byDeparture.map((d) => [
              d.departureTime === 'special' ? 'Special' : formatWallTime(d.departureTime),
              d.serviceLabel,
              DIRECTION_LABELS[d.direction],
              d.trips,
              d.confirmed,
              d.capacity,
              `${d.occupancy}%`,
            ]),
          }}
        >
          <BarList
            ariaLabel="Occupancy by departure"
            max={100}
            data={data.byDeparture.map((d) => ({
              key: d.key,
              label: `${d.departureTime === 'special' ? 'Special' : formatWallTime(d.departureTime)} ${d.serviceLabel}`,
              sublabel: `${DIRECTION_LABELS[d.direction]} · ${d.trips} trips`,
              value: d.occupancy,
              valueLabel: `${d.occupancy}%`,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Occupancy by weekday"
          table={{
            headers: ['Day', 'Seats booked', 'Capacity', 'Occupancy'],
            rows: data.byWeekday.map((w) => [
              WEEKDAYS[w.weekday]!,
              w.confirmed,
              w.capacity,
              `${w.occupancy}%`,
            ]),
          }}
        >
          <BarList
            ariaLabel="Occupancy by weekday"
            max={100}
            data={data.byWeekday.map((w) => ({
              key: String(w.weekday),
              label: WEEKDAYS[w.weekday]!,
              value: w.occupancy,
              valueLabel: `${w.occupancy}%`,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Direction split"
          subtitle="Confirmed seats by direction."
          table={{
            headers: ['Direction', 'Seats booked', 'Capacity'],
            rows: data.byDirection.map((d) => [
              DIRECTION_LABELS[d.direction],
              d.confirmed,
              d.capacity,
            ]),
          }}
        >
          <SplitBar
            ariaLabel="Confirmed seats by direction"
            parts={[
              { label: DIRECTION_LABELS.DELHI_TO_SONIPAT, value: dir('DELHI_TO_SONIPAT') },
              { label: DIRECTION_LABELS.SONIPAT_TO_DELHI, value: dir('SONIPAT_TO_DELHI') },
            ]}
          />
        </ChartCard>

        <ChartCard
          title="How far ahead people book"
          subtitle="Time between booking and departure (all bookings, incl. cancelled)."
          table={{
            headers: ['Booked', 'Bookings'],
            rows: data.leadTime.map((l) => [l.bucket, l.bookings]),
          }}
        >
          <BarList
            ariaLabel="Booking lead time"
            data={data.leadTime.map((l) => ({
              key: l.bucket,
              label: l.bucket,
              value: l.bookings,
              valueLabel: String(l.bookings),
            }))}
          />
        </ChartCard>
      </div>
    </>
  );
}
