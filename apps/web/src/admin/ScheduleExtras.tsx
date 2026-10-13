import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIRECTION_LABELS,
  istDateOf,
  istToUtc,
  type Direction,
  type ServiceClosureDto,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Alert, ErrorState, LoadingSkeleton } from '../components/ui';
import { errorMessage, formatTravelDate } from '../lib/format';
import { ReasonDialog } from './components';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    void qc.invalidateQueries({ queryKey: ['trips'] });
  };
}

/** Holidays: stop all regular buses on a date (passengers are emailed). */
export function ClosuresSection() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = istDateOf(new Date());
  const [date, setDate] = useState('');
  const [confirming, setConfirming] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'closures'],
    queryFn: () => api<{ closures: ServiceClosureDto[] }>('/admin/closures'),
  });
  const create = useMutation({
    mutationFn: (reason: string) =>
      api<{ cancelledTrips: number; affectedBookings: number }>('/admin/closures', {
        method: 'POST',
        body: { date, reason },
      }),
    onSuccess: (r) => {
      toast(
        `No service on ${formatTravelDate(date)}. ${r.cancelledTrips} trip(s) cancelled, ${r.affectedBookings} passenger(s) emailed.`,
        'success',
      );
      setConfirming(false);
      setDate('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      api<{ tripsRegenerated: number; stillCancelled: number }>(`/admin/closures/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (r) => {
      toast(
        `Holiday removed. ${r.tripsRegenerated} trip(s) restored${r.stillCancelled ? `; ${r.stillCancelled} already-cancelled trip(s) stay cancelled` : ''}.`,
        'success',
      );
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const upcoming = list.data?.closures.filter((c) => c.date >= today) ?? [];

  return (
    <section aria-labelledby="closures-h">
      <h2 id="closures-h" className="mb-1 text-lg font-bold">
        Holidays &amp; no-service days
      </h2>
      <p className="mb-3 text-sm text-ink-800">
        Stops every regular bus on a date (e.g. a national holiday). Existing bookings are cancelled
        and passengers emailed; no trips are generated for that date. Special buses on that day are
        not affected.
      </p>
      <form
        className="mb-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (date) {
            create.reset();
            setConfirming(true);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="closure-date">
            Date
          </label>
          <input
            id="closure-date"
            type="date"
            className="input"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-danger" disabled={!date}>
          Stop buses on this date
        </button>
      </form>
      {list.isPending ? (
        <LoadingSkeleton rows={1} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-ink-800">No upcoming holidays set.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {upcoming.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm"
            >
              <span>
                <strong>{formatTravelDate(c.date)}</strong>: {c.reason}
              </span>
              <button
                type="button"
                className="cursor-pointer text-xs font-semibold text-red-800 underline"
                disabled={remove.isPending}
                onClick={() => remove.mutate(c.id)}
                aria-label={`Remove holiday on ${formatTravelDate(c.date)}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <ReasonDialog
        open={confirming}
        title={date ? `Stop all buses on ${formatTravelDate(date)}?` : 'Stop buses'}
        description={
          <p>
            All regular trips that day will be cancelled and every booked passenger emailed. This
            cannot be undone for those bookings.
          </p>
        }
        confirmLabel="Stop buses"
        onClose={() => setConfirming(false)}
        onConfirm={(reason) => create.mutate(reason)}
        pending={create.isPending}
        error={create.error}
      />
    </section>
  );
}

/** One-off trip on any date, including weekends and holidays. */
export function SpecialTripDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const today = istDateOf(new Date());
  const blank = {
    travelDate: today,
    departureTime: '09:00',
    direction: 'DELHI_TO_SONIPAT' as Direction,
    capacity: 24,
    serviceLabel: 'Special bus',
    closesDate: '',
    closesTime: '',
  };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (open) setF(blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const m = useMutation({
    mutationFn: () =>
      api('/admin/trips/special', {
        method: 'POST',
        body: {
          travelDate: f.travelDate,
          departureTime: f.departureTime,
          direction: f.direction,
          capacity: f.capacity,
          serviceLabel: f.serviceLabel.trim() || 'Special bus',
          ...(f.closesDate &&
            f.closesTime && {
              bookingClosesAt: istToUtc(f.closesDate, f.closesTime).toISOString(),
            }),
        },
      }),
    onSuccess: () => {
      toast(
        'Special bus added. Users can see and book it now (if its booking window is open).',
        'success',
      );
      invalidate();
      onClose();
    },
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog
      open={open}
      title="Add a special bus"
      onClose={onClose}
      busy={m.isPending}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={m.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={m.isPending || !f.travelDate}
            onClick={() => m.mutate()}
          >
            {m.isPending ? 'Adding…' : 'Add special bus'}
          </button>
        </>
      }
    >
      <p>
        Runs on any date, including weekends and holidays. Booking normally opens 7 days before and
        closes at 4 PM the day before.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="sp-date">
            Date
          </label>
          <input
            id="sp-date"
            type="date"
            className="input"
            min={today}
            value={f.travelDate}
            onChange={(e) => set('travelDate', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="sp-time">
            Departure (IST)
          </label>
          <input
            id="sp-time"
            type="time"
            className="input"
            value={f.departureTime}
            onChange={(e) => set('departureTime', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="sp-dir">
            Direction
          </label>
          <select
            id="sp-dir"
            className="input"
            value={f.direction}
            onChange={(e) => set('direction', e.target.value as Direction)}
          >
            {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="sp-cap">
            Seats
          </label>
          <input
            id="sp-cap"
            type="number"
            min={1}
            max={200}
            className="input"
            value={f.capacity}
            onChange={(e) => set('capacity', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="sp-label">
            Name
          </label>
          <input
            id="sp-label"
            className="input"
            maxLength={40}
            value={f.serviceLabel}
            onChange={(e) => set('serviceLabel', e.target.value)}
          />
        </div>
        <fieldset className="col-span-2">
          <legend className="label">
            Custom booking deadline (optional, for short-notice buses)
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <input
              aria-label="Booking closes on"
              type="date"
              className="input"
              value={f.closesDate}
              onChange={(e) => set('closesDate', e.target.value)}
            />
            <input
              aria-label="Booking closes at"
              type="time"
              className="input"
              value={f.closesTime}
              onChange={(e) => set('closesTime', e.target.value)}
            />
          </div>
        </fieldset>
      </div>
      {m.error && (
        <div className="mt-3">
          <Alert tone="error">{errorMessage(m.error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}
