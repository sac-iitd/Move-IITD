import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DIRECTION_LABELS,
  addDays,
  istDateOf,
  type AdminTemplatePatch,
  type AdminTripDto,
  type CutoffRule,
  type Direction,
  type ServiceTemplateDto,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { DirectionBadge, SpecialBadge, TripStatusBadge } from '../components/Badges';
import { ClosuresSection, SpecialTripDialog } from './ScheduleExtras';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Alert, EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { deadline, errorMessage, formatTravelDate, formatWallTime } from '../lib/format';
import { DateRangeFilter, DirectionSelect, ReasonDialog, TableWrap, Td, Th } from './components';

function useInvalidateAdmin() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin'] });
    void qc.invalidateQueries({ queryKey: ['trips'] });
    void qc.invalidateQueries({ queryKey: ['schedule'] });
  };
}

function TemplateDialog({
  template,
  onClose,
}: {
  template: ServiceTemplateDto | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateAdmin();
  const [form, setForm] = useState<ServiceTemplateDto | null>(template);
  const [apply, setApply] = useState(true);
  useEffect(() => {
    setForm(template);
    setApply(true);
  }, [template]);

  const save = useMutation({
    mutationFn: (patch: AdminTemplatePatch) =>
      api<{ refreshedTrips: number }>(`/admin/templates/${template!.id}`, {
        method: 'PATCH',
        body: patch,
      }),
    onSuccess: (r) => {
      toast(`Template saved. ${r.refreshedTrips} upcoming unbooked trip(s) updated.`, 'success');
      invalidate();
      onClose();
    },
  });
  if (!template || !form) return null;

  const set = <K extends keyof ServiceTemplateDto>(k: K, v: ServiceTemplateDto[K]) =>
    setForm({ ...form, [k]: v });
  const diff: AdminTemplatePatch = {};
  for (const k of [
    'capacity',
    'departureTime',
    'bookingOpenDaysBefore',
    'bookingOpenTime',
    'bookingCloseTime',
    'cancellationCloseTime',
    'cutoffRule',
  ] as const) {
    if (form[k] !== template[k]) (diff as Record<string, unknown>)[k] = form[k];
  }
  const changed = Object.keys(diff).length > 0;

  return (
    <Dialog
      open
      title={`Edit ${template.serviceLabel} ${formatWallTime(template.departureTime)}`}
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate({ ...diff, applyToUnbookedTrips: apply })}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="tpl-time">
            Departure (IST)
          </label>
          <input
            id="tpl-time"
            type="time"
            className="input"
            value={form.departureTime}
            onChange={(e) => set('departureTime', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="tpl-cap">
            Capacity
          </label>
          <input
            id="tpl-cap"
            type="number"
            min={1}
            max={200}
            className="input"
            value={form.capacity}
            onChange={(e) => set('capacity', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="tpl-days">
            Opens (days before)
          </label>
          <input
            id="tpl-days"
            type="number"
            min={1}
            max={30}
            className="input"
            value={form.bookingOpenDaysBefore}
            onChange={(e) => set('bookingOpenDaysBefore', Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="tpl-open">
            Opens at
          </label>
          <input
            id="tpl-open"
            type="time"
            className="input"
            value={form.bookingOpenTime}
            onChange={(e) => set('bookingOpenTime', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="tpl-close">
            Booking closes at
          </label>
          <input
            id="tpl-close"
            type="time"
            className="input"
            value={form.bookingCloseTime}
            onChange={(e) => set('bookingCloseTime', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="tpl-cclose">
            Cancellation closes at
          </label>
          <input
            id="tpl-cclose"
            type="time"
            className="input"
            value={form.cancellationCloseTime}
            onChange={(e) => set('cancellationCloseTime', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="tpl-rule">
            Deadline day
          </label>
          <select
            id="tpl-rule"
            className="input"
            value={form.cutoffRule}
            onChange={(e) => set('cutoffRule', e.target.value as CutoffRule)}
          >
            <option value="PREVIOUS_OPERATIONAL_DAY">
              Previous working day (Monday trips close Friday)
            </option>
            <option value="PREVIOUS_CALENDAR_DAY">
              Previous calendar day (Monday trips close Sunday)
            </option>
          </select>
        </div>
        <label className="col-span-2 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={apply}
            onChange={(e) => setApply(e.target.checked)}
          />
          Also update upcoming trips that have no bookings. Trips with bookings always keep their
          current schedule.
        </label>
      </div>
      {save.error && (
        <div className="mt-3">
          <Alert tone="error">{errorMessage(save.error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}

function TripEditDialog({ trip, onClose }: { trip: AdminTripDto | null; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateAdmin();
  const [capacity, setCapacity] = useState(trip?.capacity ?? 0);
  const [time, setTime] = useState(trip?.departureTime ?? '');
  useEffect(() => {
    setCapacity(trip?.capacity ?? 0);
    setTime(trip?.departureTime ?? '');
  }, [trip]);
  const save = useMutation({
    mutationFn: (body: object) => api(`/admin/trips/${trip!.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast('Trip updated.', 'success');
      invalidate();
      onClose();
    },
  });
  if (!trip) return null;
  const body = {
    ...(capacity !== trip.capacity && { capacity }),
    ...(time !== trip.departureTime && { departureTime: time }),
  };
  return (
    <Dialog
      open
      title={`Edit trip · ${formatTravelDate(trip.travelDate)}`}
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={Object.keys(body).length === 0 || save.isPending}
            onClick={() => save.mutate(body)}
          >
            Save
          </button>
        </>
      }
    >
      <p>
        {trip.serviceLabel} · {trip.bookedCount} confirmed booking(s). Capacity cannot go below
        this.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="trip-cap">
            Capacity
          </label>
          <input
            id="trip-cap"
            type="number"
            min={1}
            max={200}
            className="input"
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="label" htmlFor="trip-time">
            Departure (IST)
          </label>
          <input
            id="trip-time"
            type="time"
            className="input"
            value={time}
            disabled={trip.bookedCount > 0}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
      </div>
      {trip.bookedCount > 0 && (
        <p className="mt-2 text-xs">
          Time is locked because passengers are booked. Cancel the trip to notify them instead.
        </p>
      )}
      {save.error && (
        <div className="mt-3">
          <Alert tone="error">{errorMessage(save.error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}

export function TripsPage() {
  const [addingSpecial, setAddingSpecial] = useState(false);
  const toast = useToast();
  const invalidate = useInvalidateAdmin();
  const today = istDateOf(new Date());
  const [range, setRange] = useState({ from: today, to: addDays(today, 13) });
  const [direction, setDirection] = useState<Direction | ''>('');
  const [editingTemplate, setEditingTemplate] = useState<ServiceTemplateDto | null>(null);
  const [editingTrip, setEditingTrip] = useState<AdminTripDto | null>(null);
  const [cancelling, setCancelling] = useState<AdminTripDto | null>(null);
  const [confirming, setConfirming] = useState<ServiceTemplateDto | null>(null);
  const [pausing, setPausing] = useState<ServiceTemplateDto | null>(null);

  const templates = useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => api<{ templates: ServiceTemplateDto[] }>('/admin/templates'),
  });
  const qs = new URLSearchParams({
    from: range.from,
    to: range.to,
    ...(direction && { direction }),
  });
  const trips = useQuery({
    queryKey: ['admin', 'trips', range, direction],
    queryFn: () => api<{ trips: AdminTripDto[] }>(`/admin/trips?${qs}`),
  });

  const cancelTrip = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<{ affectedBookings: number }>(`/admin/trips/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: (r) => {
      toast(`Trip cancelled. ${r.affectedBookings} passenger(s) will be emailed.`, 'success');
      setCancelling(null);
      invalidate();
    },
  });
  const confirmTime = useMutation({
    mutationFn: (id: string) =>
      api(`/admin/templates/${id}`, {
        method: 'PATCH',
        body: { timeConfirmed: true, applyToUnbookedTrips: true },
      }),
    onSuccess: () => {
      toast('Departure time confirmed.', 'success');
      setConfirming(null);
      invalidate();
    },
  });
  const setRunning = useMutation({
    mutationFn: ({ id, running }: { id: string; running: boolean }) =>
      api<{ affectedBookings: number }>(`/admin/templates/${id}/running`, {
        method: 'POST',
        body: { running },
      }),
    onSuccess: (r, vars) => {
      toast(
        vars.running
          ? 'Vehicle continued. Upcoming departures can be booked again. Tickets already cancelled stay cancelled.'
          : `Vehicle stopped. ${r.affectedBookings} passenger(s) will be emailed that their ticket is cancelled.`,
        'success',
      );
      setPausing(null);
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const generate = useMutation({
    mutationFn: () =>
      api<{ created: number }>('/admin/trips/generate', { method: 'POST', body: {} }),
    onSuccess: (r) => {
      toast(`${r.created} new trip(s) generated.`, 'success');
      invalidate();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const vehicles = [...(templates.data?.templates ?? [])]
    .filter((t) => t.vehicleNumber != null)
    .sort((a, b) => a.vehicleNumber! - b.vehicleNumber!);

  return (
    <div className="space-y-8">
      <section aria-labelledby="vehicles-h">
        <h2 id="vehicles-h" className="mb-1 text-lg font-bold">
          Regular vehicles
        </h2>
        <p className="mb-3 text-sm text-ink-800">
          Stop one vehicle for the time being. Future departures are cancelled and anyone who booked
          is emailed. Continue it when it should run again.
        </p>
        {templates.isPending ? (
          <LoadingSkeleton rows={2} label="Loading vehicles" />
        ) : templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {vehicles.map((v) => (
              <div key={v.id} className="card flex items-center gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-bold text-brand-200">
                  {v.vehicleNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {formatWallTime(v.departureTime)} · {v.serviceLabel} · {v.capacity} seats
                  </p>
                  <p className="text-sm text-ink-800">{DIRECTION_LABELS[v.direction]}</p>
                  <p
                    className={`text-xs font-semibold ${v.active ? 'text-emerald-800' : 'text-red-800'}`}
                  >
                    {v.active ? 'Running' : 'Stopped'}
                  </p>
                </div>
                <button
                  type="button"
                  className={
                    v.active ? 'btn-danger min-h-9 px-3 py-1' : 'btn-primary min-h-9 px-3 py-1'
                  }
                  onClick={() => setPausing(v)}
                >
                  {v.active ? 'Stop for now' : 'Continue'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="tpl-h">
        <h2 id="tpl-h" className="mb-1 text-lg font-bold">
          Recurring weekday timetable
        </h2>
        <p className="mb-3 text-sm text-ink-800">
          Changes apply to trips generated from now on. Existing trips keep their snapshot unless
          they have no bookings and you choose to update them.
        </p>
        {templates.isPending ? (
          <LoadingSkeleton rows={2} />
        ) : templates.isError ? (
          <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />
        ) : (
          <TableWrap caption="Service templates">
            <thead className="bg-brand-100">
              <tr>
                <Th>Departure</Th>
                <Th>Route</Th>
                <Th>Service</Th>
                <Th>Seats</Th>
                <Th>Booking window</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {templates.data.templates.map((t) => (
                <tr key={t.id} className="border-t border-ink-900/10">
                  <Td className="font-semibold tabular-nums">
                    {formatWallTime(t.departureTime)}
                    {t.timeProvisional && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                        Provisional
                      </span>
                    )}
                  </Td>
                  <Td>
                    <DirectionBadge direction={t.direction} />
                  </Td>
                  <Td>{t.serviceLabel}</Td>
                  <Td>{t.capacity}</Td>
                  <Td className="text-xs">
                    Opens {t.bookingOpenDaysBefore}d before at {t.bookingOpenTime}; closes{' '}
                    {t.bookingCloseTime} on{' '}
                    {t.cutoffRule === 'PREVIOUS_OPERATIONAL_DAY'
                      ? 'previous working day'
                      : 'previous day'}
                    ; cancel by {t.cancellationCloseTime}
                  </Td>
                  <Td>{t.active ? 'Running' : 'Stopped'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary min-h-9 px-3 py-1"
                        onClick={() => setEditingTemplate(t)}
                      >
                        Edit
                      </button>
                      {t.timeProvisional && (
                        <button
                          type="button"
                          className="btn-gold min-h-9 px-3 py-1"
                          onClick={() => setConfirming(t)}
                        >
                          Confirm time
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <ClosuresSection />

      <section aria-labelledby="trips-h">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="trips-h" className="text-lg font-bold">
            Trips
          </h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-gold" onClick={() => setAddingSpecial(true)}>
              + Add special bus
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Generating…' : 'Generate upcoming trips'}
            </button>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <DateRangeFilter
            from={range.from}
            to={range.to}
            onChange={(r) => r.from && r.to && setRange(r)}
          />
          <DirectionSelect value={direction} onChange={setDirection} />
        </div>
        {trips.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : trips.isError ? (
          <ErrorState error={trips.error} onRetry={() => void trips.refetch()} />
        ) : trips.data.trips.length === 0 ? (
          <EmptyState title="No trips in this range" />
        ) : (
          <TableWrap caption="Generated trips">
            <thead className="bg-brand-100">
              <tr>
                <Th>Date</Th>
                <Th>Departure</Th>
                <Th>Route</Th>
                <Th>Booked / capacity</Th>
                <Th>Booking closes</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {trips.data.trips.map((t) => (
                <tr key={t.id} className="border-t border-ink-900/10">
                  <Td>{formatTravelDate(t.travelDate)}</Td>
                  <Td className="tabular-nums">
                    {formatWallTime(t.departureTime)}{' '}
                    <span className="text-xs text-ink-800">{t.serviceLabel}</span>
                    {t.isSpecial && (
                      <span className="mt-1 block">
                        <SpecialBadge />
                      </span>
                    )}
                  </Td>
                  <Td>
                    <DirectionBadge direction={t.direction} />
                  </Td>
                  <Td className="tabular-nums">
                    <Link className="underline" to={`/admin/bookings?tripId=${t.id}`}>
                      {t.bookedCount} / {t.capacity}
                    </Link>
                    {t.waitlistCount > 0 && (
                      <span className="block text-xs text-amber-800">
                        +{t.waitlistCount} waiting
                      </span>
                    )}
                    <Link
                      className="mt-1 block text-xs font-medium underline"
                      to={`/admin/trips/${t.id}/manifest`}
                    >
                      Passenger list
                    </Link>
                  </Td>
                  <Td className="text-xs">{deadline(t.bookingClosesAt)}</Td>
                  <Td>
                    <TripStatusBadge status={t.status} />
                    {t.cancellationReason && <p className="mt-1 text-xs">{t.cancellationReason}</p>}
                  </Td>
                  <Td>
                    {t.status === 'SCHEDULED' && (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary min-h-9 px-3 py-1"
                          onClick={() => setEditingTrip(t)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-danger min-h-9 px-3 py-1"
                          onClick={() => {
                            cancelTrip.reset();
                            setCancelling(t);
                          }}
                        >
                          Cancel trip
                        </button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <SpecialTripDialog open={addingSpecial} onClose={() => setAddingSpecial(false)} />
      <TemplateDialog template={editingTemplate} onClose={() => setEditingTemplate(null)} />
      <TripEditDialog trip={editingTrip} onClose={() => setEditingTrip(null)} />
      <ReasonDialog
        open={cancelling !== null}
        title="Cancel this departure?"
        description={
          cancelling && (
            <p>
              {formatTravelDate(cancelling.travelDate)}, {formatWallTime(cancelling.departureTime)}{' '}
              ({cancelling.serviceLabel}). All <strong>{cancelling.bookedCount}</strong> confirmed
              booking(s) will be cancelled and passengers emailed. This cannot be undone.
            </p>
          )
        }
        confirmLabel="Cancel trip"
        onClose={() => setCancelling(null)}
        onConfirm={(reason) => cancelling && cancelTrip.mutate({ id: cancelling.id, reason })}
        pending={cancelTrip.isPending}
        error={cancelTrip.error}
      />
      <Dialog
        open={confirming !== null}
        title="Confirm departure time"
        onClose={() => setConfirming(null)}
        busy={confirmTime.isPending}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirming(null)}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={confirmTime.isPending}
              onClick={() => confirming && confirmTime.mutate(confirming.id)}
            >
              Yes, {confirming && formatWallTime(confirming.departureTime)} is correct
            </button>
          </>
        }
      >
        <p>
          This departure time is marked provisional. Confirm only after checking with the transport
          office; if it is wrong, use <em>Edit</em> to change it first.
        </p>
        {confirmTime.error && (
          <div className="mt-3">
            <Alert tone="error">{errorMessage(confirmTime.error)}</Alert>
          </div>
        )}
      </Dialog>
      <Dialog
        open={pausing !== null}
        title={
          pausing
            ? `${pausing.active ? 'Stop' : 'Continue'} vehicle ${pausing.vehicleNumber}`
            : 'Vehicle'
        }
        onClose={() => setPausing(null)}
        busy={setRunning.isPending}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPausing(null)}>
              Back
            </button>
            <button
              type="button"
              className={pausing?.active ? 'btn-danger' : 'btn-primary'}
              disabled={setRunning.isPending || !pausing}
              onClick={() =>
                pausing && setRunning.mutate({ id: pausing.id, running: !pausing.active })
              }
            >
              {pausing?.active ? 'Stop this vehicle' : 'Continue this vehicle'}
            </button>
          </>
        }
      >
        {pausing && (
          <p>
            Vehicle {pausing.vehicleNumber}: {formatWallTime(pausing.departureTime)}{' '}
            {DIRECTION_LABELS[pausing.direction]} ({pausing.serviceLabel}, {pausing.capacity}{' '}
            seats).{' '}
            {pausing.active
              ? 'Future departures will be cancelled. Anyone who has booked will get an email that the vehicle is temporarily discontinued and their ticket is cancelled.'
              : 'Upcoming departures will be bookable again. Tickets that were cancelled stay cancelled, so those passengers need to book again.'}
          </p>
        )}
        {setRunning.error && (
          <div className="mt-3">
            <Alert tone="error">{errorMessage(setRunning.error)}</Alert>
          </div>
        )}
      </Dialog>
    </div>
  );
}
