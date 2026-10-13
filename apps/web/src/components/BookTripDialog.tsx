import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GUEST_ID_TYPES,
  ID_TYPE_LABELS,
  MAX_SEATS_PER_TRIP,
  PURPOSES,
  PURPOSE_LABELS,
  createBookingSchema,
  type BookingDto,
  type CreateBookingResponse,
  type Purpose,
  type TripDto,
} from '@iitd-bus/shared';
import { ApiError, api, newIdempotencyKey } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from './Dialog';
import { BookingStatusBadge } from './Badges';
import { Alert } from './ui';
import { useToast } from './Toast';
import { errorMessage, formatTravelDate, formatWallTime, routeText } from '../lib/format';

type FieldErrors = Record<string, string>;

interface FormState {
  passengerType: 'SELF' | 'GUEST';
  phone: string;
  purpose: Purpose | '';
  purposeDetail: string;
  guestName: string;
  guestEmail: string;
  guestIdType: 'AADHAAR' | 'PAN';
  guestIdNumber: string;
  guestPhone: string;
}

function toRequest(f: FormState, joinWaitlist: boolean) {
  return {
    passengerType: f.passengerType,
    phone: f.phone,
    purpose: f.purpose || undefined,
    purposeDetail: f.purpose === 'OTHER' ? f.purposeDetail : undefined,
    joinWaitlist,
    guest:
      f.passengerType === 'GUEST'
        ? {
            name: f.guestName,
            email: f.guestEmail,
            idType: f.guestIdType,
            idNumber: f.guestIdNumber,
            phone: f.guestPhone.trim() ? f.guestPhone : undefined,
          }
        : undefined,
  };
}

/** Maps Zod / API issue paths (e.g. "guest.idNumber") to form fields. */
function issuesToErrors(
  issues: { path: (string | number)[] | string; message: string }[],
): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const key = Array.isArray(i.path) ? i.path.join('.') : i.path;
    out[key || 'form'] ??= i.message;
  }
  return out;
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-800">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Booking form → server → confirmation. One idempotency key per dialog opening, so
 * double-clicks and retries can never create a second booking.
 */
export function BookTripDialog({ trip, onClose }: { trip: TripDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { lastPhone } = useAuth();
  const uid = useId();
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<BookingDto | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const hasSelf = trip?.myBookings.some((b) => b.passengerType === 'SELF') ?? false;
  const blank = (): FormState => ({
    passengerType: hasSelf ? 'GUEST' : 'SELF',
    phone: lastPhone ?? '',
    purpose: '',
    purposeDetail: '',
    guestName: '',
    guestEmail: '',
    guestIdType: 'AADHAAR',
    guestIdNumber: '',
    guestPhone: '',
  });
  const [form, setForm] = useState<FormState>(blank);

  useEffect(() => {
    if (trip) {
      setKey(newIdempotencyKey());
      setDone(null);
      setErrors({});
      setForm(blank());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip]);

  const waitlist = trip?.availability === 'FULL';

  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<CreateBookingResponse>(`/trips/${trip!.id}/bookings`, {
        method: 'POST',
        body,
        idempotencyKey: key,
      }),
    onSuccess: (data) => {
      setDone(data.booking);
      toast(
        data.booking.status === 'WAITLISTED'
          ? `Added to the waiting list (#${data.booking.waitlistPosition}). We'll email you if a seat frees up.`
          : 'Booking confirmed. A confirmation email is on its way.',
        'success',
      );
    },
    onError: (err) => {
      if (
        err instanceof ApiError &&
        err.code === 'VALIDATION_ERROR' &&
        Array.isArray(err.details)
      ) {
        setErrors(issuesToErrors(err.details as { path: string; message: string }[]));
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['trips'] });
      void qc.invalidateQueries({ queryKey: ['my-bookings'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const close = () => {
    mutation.reset();
    onClose();
  };

  if (!trip) return null;

  if (done) {
    return (
      <Dialog
        open
        title={done.status === 'WAITLISTED' ? "You're on the waiting list" : 'Booking confirmed'}
        onClose={close}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              Done
            </button>
            <Link to={`/bookings/${done.reference}`} className="btn-primary" onClick={close}>
              View booking
            </Link>
          </>
        }
      >
        <BookingSummary booking={done} />
      </Dialog>
    );
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const { [k]: _drop, ...rest } = e;
      return rest;
    });
  };

  const submit = () => {
    const body = toRequest(form, waitlist);
    const parsed = createBookingSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    setErrors({});
    mutation.mutate(body);
  };

  const err = (k: string) => errors[k];
  const apiErr = mutation.error;
  const blocking = apiErr instanceof ApiError && apiErr.status === 409;
  const remaining = MAX_SEATS_PER_TRIP - trip.myBookings.length;

  return (
    <Dialog
      open
      title={waitlist ? 'Join the waiting list' : 'Book a seat'}
      onClose={close}
      busy={mutation.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={submit}
            disabled={mutation.isPending || blocking}
          >
            {mutation.isPending ? 'Saving…' : waitlist ? 'Join waiting list' : 'Confirm booking'}
          </button>
        </>
      }
    >
      <div className="rounded-lg bg-brand-100/70 p-3 text-sm">
        <p className="font-semibold text-ink-900">
          {formatWallTime(trip.departureTime)} · {formatTravelDate(trip.travelDate)}
        </p>
        <p>{routeText(trip)}</p>
        <p className="text-xs text-ink-800">
          {trip.serviceLabel} ·{' '}
          {waitlist
            ? `full · ${trip.waitlistCount} waiting`
            : `${trip.seatsRemaining} of ${trip.capacity} seats left`}
        </p>
      </div>
      {waitlist && (
        <p className="mt-3 text-xs">
          If someone cancels before booking closes, the first person on the list gets the seat
          automatically and is emailed.
        </p>
      )}

      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <fieldset>
          <legend className="label">Who is travelling?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['SELF', 'GUEST'] as const).map((t) => (
              <label
                key={t}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${
                  form.passengerType === t
                    ? 'border-ink-900 bg-brand-100 font-semibold'
                    : 'border-ink-900/20'
                } ${t === 'SELF' && hasSelf ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name={`${uid}-who`}
                  value={t}
                  checked={form.passengerType === t}
                  disabled={t === 'SELF' && hasSelf}
                  onChange={() => set('passengerType', t)}
                />
                {t === 'SELF' ? 'Myself' : 'Someone else'}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-800">
            You can hold up to {MAX_SEATS_PER_TRIP} seats per trip ({remaining} left for this trip).
          </p>
        </fieldset>

        <Field
          id={`${uid}-phone`}
          label="Your mobile number (for emergencies)"
          error={err('phone')}
        >
          <input
            id={`${uid}-phone`}
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="10-digit mobile"
            value={form.phone}
            aria-invalid={!!err('phone')}
            aria-describedby={err('phone') ? `${uid}-phone-error` : undefined}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>

        <Field id={`${uid}-purpose`} label="Purpose of visit" error={err('purpose')}>
          <select
            id={`${uid}-purpose`}
            className="input"
            value={form.purpose}
            aria-invalid={!!err('purpose')}
            onChange={(e) => set('purpose', e.target.value as Purpose)}
          >
            <option value="" disabled>
              Select…
            </option>
            {PURPOSES.map((p) => (
              <option key={p} value={p}>
                {PURPOSE_LABELS[p]}
              </option>
            ))}
          </select>
        </Field>
        {form.purpose === 'OTHER' && (
          <Field id={`${uid}-detail`} label="Describe the activity" error={err('purposeDetail')}>
            <input
              id={`${uid}-detail`}
              className="input"
              maxLength={200}
              value={form.purposeDetail}
              aria-invalid={!!err('purposeDetail')}
              onChange={(e) => set('purposeDetail', e.target.value)}
            />
          </Field>
        )}

        {form.passengerType === 'GUEST' && (
          <fieldset className="space-y-3 rounded-lg border border-ink-900/15 p-3">
            <legend className="px-1 text-sm font-semibold">Passenger details</legend>
            <Field id={`${uid}-gname`} label="Full name (as on ID)" error={err('guest.name')}>
              <input
                id={`${uid}-gname`}
                className="input"
                autoComplete="off"
                value={form.guestName}
                aria-invalid={!!err('guest.name')}
                onChange={(e) => set('guestName', e.target.value)}
              />
            </Field>
            <Field
              id={`${uid}-gemail`}
              label="Email (they get a copy of the booking)"
              error={err('guest.email')}
            >
              <input
                id={`${uid}-gemail`}
                className="input"
                type="email"
                autoComplete="off"
                value={form.guestEmail}
                aria-invalid={!!err('guest.email')}
                onChange={(e) => set('guestEmail', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Field id={`${uid}-gidtype`} label="ID type">
                <select
                  id={`${uid}-gidtype`}
                  className="input"
                  value={form.guestIdType}
                  onChange={(e) => set('guestIdType', e.target.value as 'AADHAAR' | 'PAN')}
                >
                  {GUEST_ID_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ID_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id={`${uid}-gid`} label="ID number" error={err('guest.idNumber')}>
                <input
                  id={`${uid}-gid`}
                  className="input font-mono"
                  autoComplete="off"
                  placeholder={form.guestIdType === 'AADHAAR' ? '1234 5678 9012' : 'ABCDE1234F'}
                  value={form.guestIdNumber}
                  aria-invalid={!!err('guest.idNumber')}
                  onChange={(e) => set('guestIdNumber', e.target.value)}
                />
              </Field>
            </div>
            <Field
              id={`${uid}-gphone`}
              label="Passenger mobile (optional)"
              error={err('guest.phone')}
            >
              <input
                id={`${uid}-gphone`}
                className="input"
                type="tel"
                inputMode="tel"
                value={form.guestPhone}
                onChange={(e) => set('guestPhone', e.target.value)}
              />
            </Field>
            <p className="text-xs text-ink-800">
              The passenger must carry this ID. ID numbers are stored encrypted, shown only to SAC
              administrators and on the driver's list, and deleted 6 months after the trip.
            </p>
          </fieldset>
        )}
        {form.passengerType === 'SELF' && (
          <p className="text-xs text-ink-800">
            Carry your IIT Delhi ID card. It will be checked when boarding.
          </p>
        )}
        <button type="submit" hidden />
      </form>

      {apiErr &&
        !(
          apiErr instanceof ApiError &&
          apiErr.code === 'VALIDATION_ERROR' &&
          Object.keys(errors).length
        ) && (
          <div className="mt-4">
            <Alert
              tone="error"
              title={waitlist ? 'Could not join the waiting list' : 'Booking not completed'}
            >
              {errorMessage(apiErr)}
            </Alert>
          </div>
        )}
    </Dialog>
  );
}

export function BookingSummary({ booking }: { booking: BookingDto }) {
  const t = booking.trip;
  const p = booking.passenger;
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-brand-100 p-3 text-center">
        <p className="text-xs uppercase tracking-wide text-ink-800">Booking reference</p>
        <p className="font-mono text-2xl font-bold tracking-wider text-ink-900">
          {booking.reference}
        </p>
        <div className="mt-1">
          <BookingStatusBadge status={booking.status} position={booking.waitlistPosition} />
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-medium">Date</dt>
        <dd>{formatTravelDate(t.travelDate)}</dd>
        <dt className="font-medium">Departure</dt>
        <dd>{formatWallTime(t.departureTime)} (IST)</dd>
        <dt className="font-medium">Route</dt>
        <dd>{routeText(t)}</dd>
        <dt className="font-medium">Vehicle</dt>
        <dd>
          {t.serviceLabel} ({t.capacity} seats)
        </dd>
        <dt className="font-medium">Passenger</dt>
        <dd>
          {p.name}
          {p.type === 'GUEST' && ' (guest)'}
        </dd>
        <dt className="font-medium">ID to carry</dt>
        <dd>
          {ID_TYPE_LABELS[p.idType]}
          {p.idNumberMasked && <span className="ml-1 font-mono text-xs">{p.idNumberMasked}</span>}
        </dd>
        <dt className="font-medium">Purpose</dt>
        <dd>
          {PURPOSE_LABELS[p.purpose]}
          {p.purposeDetail && `: ${p.purposeDetail}`}
        </dd>
        {p.phone && (
          <>
            <dt className="font-medium">Contact</dt>
            <dd>{p.phone}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
