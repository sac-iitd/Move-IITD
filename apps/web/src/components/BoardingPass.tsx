import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { DIRECTION_LABELS, type BookingDto } from '@iitd-bus/shared';
import { formatIst, formatTravelDate, formatWallTime } from '../lib/format';

/** Cinema-style pass. Shown only for a confirmed ticket that still has a QR. */
export function BoardingPass({ booking }: { booking: BookingDto }) {
  const code = booking.boardingCode;

  if (booking.status !== 'CONFIRMED' || !code || booking.trip.status === 'CANCELLED') return null;

  return (
    <article className="overflow-hidden rounded-2xl border border-ink-900/15 bg-white shadow-sm">
      <div className="flex items-center justify-between bg-ink-900 px-4 py-3 text-brand-100">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-brand-300">
            Boarding pass
          </p>
          <p className="text-lg font-bold">MoveIITD</p>
        </div>
        <p className="font-mono text-sm font-semibold text-brand-200">{booking.reference}</p>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-800">Date</dt>
          <dd className="font-semibold">{formatTravelDate(booking.trip.travelDate)}</dd>
          <dt className="text-ink-800">Departure</dt>
          <dd className="font-semibold">{formatWallTime(booking.trip.departureTime)} IST</dd>
          <dt className="text-ink-800">Route</dt>
          <dd>{DIRECTION_LABELS[booking.trip.direction]}</dd>
          <dt className="text-ink-800">Vehicle</dt>
          <dd>
            {booking.trip.serviceLabel}
            {booking.trip.isSpecial ? ' · special' : ''}
          </dd>
          <dt className="text-ink-800">Passenger</dt>
          <dd className="font-semibold">
            {booking.passenger.name}
            {booking.passenger.type === 'GUEST' ? ' (guest)' : ''}
          </dd>
        </dl>
        <QrImage code={code} />
      </div>
      <p className="border-t border-dashed border-ink-900/20 px-4 py-3 text-center text-xs text-ink-800">
        {booking.boardedAt
          ? `Boarded ${formatIst(booking.boardedAt)} IST.`
          : 'Show this QR code when you board. Seat numbers are not assigned.'}
      </p>
    </article>
  );
}

function QrImage({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setSrc(null);
    void QRCode.toDataURL(code, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return (
      <p className="max-w-52 text-center text-xs text-ink-800">
        The QR code could not be drawn in this browser. Open the confirmation email, which has the
        same pass.
      </p>
    );
  }
  if (!src) return <div className="h-52 w-52 animate-pulse rounded-lg bg-brand-100" />;
  return (
    <img
      src={src}
      width={220}
      height={220}
      alt={`Boarding QR code for ${code.slice(0, 6)}`}
      className="mx-auto rounded-lg border border-ink-900/10"
    />
  );
}
