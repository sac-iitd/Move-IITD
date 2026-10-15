import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GUEST_ID_TYPES,
  ID_TYPE_LABELS,
  MAX_SEATS_PER_TRIP,
  PURPOSES,
  PURPOSE_LABELS,
  createBookingsSchema,
  idTypeText,
  type BookingDto,
  type CreateBookingsResponse,
  type GuestIdType,
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

interface GuestDraft {
  idType: GuestIdType;
  idNumber: string;
  idTypeDetail: string;
  name: string;
  phone: string;
  email: string;
  purpose: Purpose | '';
  purposeDetail: string;
}

interface FormState {
  bookerName: string;
  phone: string;
  travelling: boolean;
  selfPurpose: Purpose | '';
  selfPurposeDetail: string;
  guests: GuestDraft[];
}

const ID_PLACEHOLDER: Record<GuestIdType, string> = {
  AADHAAR: '1234 5678 9012',
  PAN: 'ABCDE1234F',
  DRIVING_LICENCE: 'DL0420110149646',
  PASSPORT: 'A1234567',
  OTHER: 'ID number',
};

function blankGuest(): GuestDraft {
  return {
    idType: 'AADHAAR',
    idNumber: '',
    idTypeDetail: '',
    name: '',
    phone: '',
    email: '',
    purpose: '',
    purposeDetail: '',
  };
}

function toRequest(f: FormState, joinWaitlist: boolean) {
  const detail = (purpose: Purpose | '', text: string) =>
    purpose === 'OTHER' ? text : undefined;
  return {
    bookerName: f.bookerName,
    phone: f.phone,
    joinWaitlist,
    passengers: [
      ...(f.travelling
        ? [
            {
              passengerType: 'SELF' as const,
              purpose: f.selfPurpose || undefined,
              purposeDetail: detail(f.selfPurpose, f.selfPurposeDetail),
            },
          ]
        : []),
      ...f.guests.map((g) => ({
        passengerType: 'GUEST' as const,
        purpose: g.purpose || undefined,
        purposeDetail: detail(g.purpose, g.purposeDetail),
        guest: {
          idType: g.idType,
          idNumber: g.idNumber,
          idTypeDetail: g.idType === 'OTHER' ? g.idTypeDetail : undefined,
          name: g.name,
          phone: g.phone,
          email: g.email,
        },
      })),
    ],
  };
}

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

function PurposeFields({
  id,
  purpose,
  detail,
  purposeError,
  detailError,
  onPurpose,
  onDetail,
}: {
  id: string;
  purpose: Purpose | '';
  detail: string;
  purposeError?: string;
  detailError?: string;
  onPurpose: (p: Purpose | '') => void;
  onDetail: (v: string) => void;
}) {
  return (
    <>
      <Field id={`${id}-purpose`} label="Purpose of visit" error={purposeError}>
        <select
          id={`${id}-purpose`}
          className="input"
          value={purpose}
          aria-invalid={!!purposeError}
          onChange={(e) => onPurpose(e.target.value as Purpose | '')}
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
      {purpose === 'OTHER' && (
        <Field id={`${id}-detail`} label="Describe the activity" error={detailError}>
          <input
            id={`${id}-detail`}
            className="input"
            maxLength={200}
            value={detail}
            aria-invalid={!!detailError}
            onChange={(e) => onDetail(e.target.value)}
          />
        </Field>
      )}
    </>
  );
}

/**
 * One form for the whole party: the booker's name and phone, then up to two travellers
 * (yourself, a guest, or two guests). One idempotency key per opening, so a double-click
 * cannot create a second set of bookings.
 */
export function BookTripDialog({ trip, onClose }: { trip: TripDto | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { user, lastPhone } = useAuth();
  const uid = useId();
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<BookingDto[] | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [form, setForm] = useState<FormState>({
    bookerName: '',
    phone: '',
    travelling: true,
    selfPurpose: '',
    selfPurposeDetail: '',
    guests: [],
  });

  const hasSelf = trip?.myBookings.some((b) => b.passengerType === 'SELF') ?? false;
  const accountLeft = trip ? MAX_SEATS_PER_TRIP - trip.myBookings.length : 0;
  const waitlist = trip?.availability === 'FULL';
  const room = trip
    ? waitlist
      ? accountLeft
      : Math.min(accountLeft, Math.max(trip.seatsRemaining, 0))
    : 0;

  useEffect(() => {
    if (!trip) return;
    const alreadySelf = trip.myBookings.some((b) => b.passengerType === 'SELF');
    const left = MAX_SEATS_PER_TRIP - trip.myBookings.length;
    const seats = trip.availability === 'FULL' ? left : Math.min(left, trip.seatsRemaining);
    setKey(newIdempotencyKey());
    setDone(null);
    setErrors({});
    setForm({
      bookerName: user?.name ?? '',
      phone: lastPhone ?? '',
      travelling: !alreadySelf && seats > 0,
      selfPurpose: '',
      selfPurposeDetail: '',
      guests: alreadySelf && seats > 0 ? [blankGuest()] : [],
    });
  }, [trip, user?.name, lastPhone]);

  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      api<CreateBookingsResponse>(`/trips/${trip!.id}/bookings`, {
        method: 'POST',
        body,
        idempotencyKey: key,
      }),
    onSuccess: (data) => {
      setDone(data.bookings);
      const guests = data.bookings.filter((b) => b.passenger.type === 'GUEST').length;
      const waiting = data.bookings.every((b) => b.status === 'WAITLISTED');
      toast(
        waiting
          ? "Added to the waiting list. We'll email you if a seat frees up."
          : guests > 0
            ? 'Booking confirmed. You and each guest will get a separate email.'
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
    const allWaiting = done.every((b) => b.status === 'WAITLISTED');
    const title =
      done.length > 1
        ? allWaiting
          ? "You're on the waiting list"
          : 'Bookings confirmed'
        : allWaiting
          ? "You're on the waiting list"
          : 'Booking confirmed';
    return (
      <Dialog
        open
        title={title}
        onClose={close}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={close}>
              Done
            </button>
            {done.length === 1 ? (
              <Link to={`/bookings/${done[0]!.reference}`} className="btn-primary" onClick={close}>
                View booking
              </Link>
            ) : (
              <Link to="/bookings" className="btn-primary" onClick={close}>
                View my bookings
              </Link>
            )}
          </>
        }
      >
        {done.length === 1 ? (
          <BookingSummary booking={done[0]!} />
        ) : (
          <div className="space-y-3">
            <p>
              Each guest gets their own email. A copy of each booking was sent to you as well.
            </p>
            {done.map((b) => (
              <div key={b.reference} className="rounded-lg border border-ink-900/15 p-3">
                <p className="font-mono text-lg font-bold tracking-wider">{b.reference}</p>
                <p className="mt-1">
                  {b.passenger.name}
                  {b.passenger.type === 'GUEST' && ' (guest)'}
                </p>
                <div className="mt-1">
                  <BookingStatusBadge status={b.status} position={b.waitlistPosition} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    );
  }

  const maxGuests = Math.max(0, Math.min(MAX_SEATS_PER_TRIP, room) - (form.travelling ? 1 : 0));

  const patch = (next: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...next }));
    setErrors({});
  };

  const setTravelling = (yes: boolean) => {
    if (yes && hasSelf) return;
    setForm((f) => {
      const guests = yes ? f.guests.slice(0, Math.max(0, room - 1)) : f.guests.length ? f.guests : [blankGuest()];
      return { ...f, travelling: yes, guests: guests.slice(0, yes ? 1 : 2) };
    });
    setErrors({});
  };

  const setGuest = (index: number, next: Partial<GuestDraft>) => {
    setForm((f) => ({
      ...f,
      guests: f.guests.map((g, i) => (i === index ? { ...g, ...next } : g)),
    }));
    setErrors({});
  };

  const submit = () => {
    if (!form.travelling && form.guests.length === 0) {
      setErrors({ form: 'Choose who is travelling.' });
      return;
    }
    const body = toRequest(form, waitlist);
    const parsed = createBookingsSchema.safeParse(body);
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
  const guestIndex = (i: number) => (form.travelling ? 1 : 0) + i;

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
            disabled={mutation.isPending || blocking || room < 1}
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
      <p className="mt-3 text-xs text-ink-800">
        Fill this in once. You can book up to {MAX_SEATS_PER_TRIP} people on a trip: yourself, a
        guest, or two guests. {room} left for you on this trip.
      </p>

      <form
        className="mt-4 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field id={`${uid}-name`} label="Your name" error={err('bookerName')}>
          <input
            id={`${uid}-name`}
            className="input"
            autoComplete="name"
            value={form.bookerName}
            aria-invalid={!!err('bookerName')}
            onChange={(e) => patch({ bookerName: e.target.value })}
          />
        </Field>
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
            onChange={(e) => patch({ phone: e.target.value })}
          />
        </Field>

        <fieldset>
          <legend className="label">Are you travelling on this bus?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['yes', 'Yes'],
                ['no', 'No'],
              ] as const
            ).map(([value, label]) => {
              const selected = value === 'yes' ? form.travelling : !form.travelling;
              const disabled = value === 'yes' && hasSelf;
              return (
                <label
                  key={value}
                  className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${
                    selected ? 'border-ink-900 bg-brand-100 font-semibold' : 'border-ink-900/20'
                  } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name={`${uid}-self`}
                    value={value}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => setTravelling(value === 'yes')}
                  />
                  {label}
                </label>
              );
            })}
          </div>
          {hasSelf && (
            <p className="mt-1 text-xs text-ink-800">You already have a seat for yourself.</p>
          )}
        </fieldset>

        {form.travelling && (
          <div className="space-y-3 rounded-lg border border-ink-900/15 p-3">
            <p className="text-sm font-semibold">You</p>
            <p className="text-xs text-ink-800">
              Your name and mobile number above are used. Carry your IIT Delhi ID card. It will be
              checked when boarding.
            </p>
            <PurposeFields
              id={`${uid}-self`}
              purpose={form.selfPurpose}
              detail={form.selfPurposeDetail}
              purposeError={err('passengers.0.purpose')}
              detailError={err('passengers.0.purposeDetail')}
              onPurpose={(p) => patch({ selfPurpose: p })}
              onDetail={(v) => patch({ selfPurposeDetail: v })}
            />
          </div>
        )}

        {form.travelling && maxGuests > 0 && form.guests.length === 0 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={false}
              onChange={() => patch({ guests: [blankGuest()] })}
            />
            Are you booking for a visitor?
          </label>
        )}

        {form.guests.map((g, i) => {
          const n = guestIndex(i);
          const gid = `${uid}-g${i}`;
          return (
            <fieldset key={i} className="space-y-3 rounded-lg border border-ink-900/15 p-3">
              <legend className="px-1 text-sm font-semibold">
                {form.guests.length > 1 ? `Visitor ${i + 1}` : 'Visitor'}
              </legend>
              <Field id={`${gid}-idtype`} label="Government photo ID" error={err(`passengers.${n}.guest.idType`)}>
                <select
                  id={`${gid}-idtype`}
                  className="input"
                  value={g.idType}
                  onChange={(e) => setGuest(i, { idType: e.target.value as GuestIdType })}
                >
                  {GUEST_ID_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {ID_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                id={`${gid}-id`}
                label="ID number"
                error={err(`passengers.${n}.guest.idNumber`)}
              >
                <input
                  id={`${gid}-id`}
                  className="input font-mono"
                  autoComplete="off"
                  placeholder={ID_PLACEHOLDER[g.idType]}
                  value={g.idNumber}
                  aria-invalid={!!err(`passengers.${n}.guest.idNumber`)}
                  onChange={(e) => setGuest(i, { idNumber: e.target.value })}
                />
              </Field>
              {g.idType === 'OTHER' && (
                <Field
                  id={`${gid}-doc`}
                  label="Document name"
                  error={err(`passengers.${n}.guest.idTypeDetail`)}
                  hint="For example, Voter ID"
                >
                  <input
                    id={`${gid}-doc`}
                    className="input"
                    value={g.idTypeDetail}
                    aria-invalid={!!err(`passengers.${n}.guest.idTypeDetail`)}
                    onChange={(e) => setGuest(i, { idTypeDetail: e.target.value })}
                  />
                </Field>
              )}
              <Field
                id={`${gid}-name`}
                label="Full name as on the ID"
                error={err(`passengers.${n}.guest.name`)}
              >
                <input
                  id={`${gid}-name`}
                  className="input"
                  autoComplete="off"
                  value={g.name}
                  aria-invalid={!!err(`passengers.${n}.guest.name`)}
                  onChange={(e) => setGuest(i, { name: e.target.value })}
                />
              </Field>
              <Field
                id={`${gid}-phone`}
                label="Mobile number"
                error={err(`passengers.${n}.guest.phone`)}
              >
                <input
                  id={`${gid}-phone`}
                  className="input"
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="10-digit mobile"
                  value={g.phone}
                  aria-invalid={!!err(`passengers.${n}.guest.phone`)}
                  onChange={(e) => setGuest(i, { phone: e.target.value })}
                />
              </Field>
              <Field
                id={`${gid}-email`}
                label="Email (the visitor gets their own confirmation)"
                error={err(`passengers.${n}.guest.email`)}
              >
                <input
                  id={`${gid}-email`}
                  className="input"
                  type="email"
                  autoComplete="off"
                  value={g.email}
                  aria-invalid={!!err(`passengers.${n}.guest.email`)}
                  onChange={(e) => setGuest(i, { email: e.target.value })}
                />
              </Field>
              <PurposeFields
                id={gid}
                purpose={g.purpose}
                detail={g.purposeDetail}
                purposeError={err(`passengers.${n}.purpose`)}
                detailError={err(`passengers.${n}.purposeDetail`)}
                onPurpose={(p) => setGuest(i, { purpose: p })}
                onDetail={(v) => setGuest(i, { purposeDetail: v })}
              />
              <p className="text-xs text-ink-800">
                The guest must carry this ID. ID numbers are stored encrypted, shown only to SAC
                administrators and on the driver's list, and deleted 6 months after the trip.
              </p>
              {(form.travelling || form.guests.length > 1) && (
                <button
                  type="button"
                  className="text-sm font-medium text-ink-800 underline"
                  onClick={() => patch({ guests: form.guests.filter((_, j) => j !== i) })}
                >
                  Remove this visitor
                </button>
              )}
            </fieldset>
          );
        })}

        {!form.travelling && form.guests.length < maxGuests && (
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => patch({ guests: [...form.guests, blankGuest()] })}
          >
            Add a second visitor
          </button>
        )}

        {form.travelling && form.guests.length === 0 && maxGuests === 0 && room <= 1 && (
          <p className="text-xs text-ink-800">
            Only one seat is available, so this booking is for you.
          </p>
        )}
        {err('form') && <p className="text-xs font-medium text-red-700">{err('form')}</p>}
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
          {idTypeText(p.idType, p.idTypeDetail)}
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
