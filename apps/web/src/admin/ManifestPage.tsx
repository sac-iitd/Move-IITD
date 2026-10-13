import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DIRECTION_LABELS, ID_TYPE_LABELS, type ManifestResponse } from '@iitd-bus/shared';
import { API_BASE, api } from '../api/client';
import { ErrorState, LoadingSkeleton } from '../components/ui';
import { formatIst, formatTravelDate, formatWallTime, routeText } from '../lib/format';

const logoSrc = `${import.meta.env.BASE_URL}sac-logo.png`;

/** Passenger list for the driver — printable on A4 or downloadable as CSV. */
export function ManifestPage() {
  const { tripId = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'manifest', tripId],
    queryFn: () => api<ManifestResponse>(`/admin/trips/${encodeURIComponent(tripId)}/manifest`),
  });

  if (q.isPending) return <LoadingSkeleton rows={3} label="Loading passenger list" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const m = q.data;
  const t = m.trip;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to="/admin/trips" className="text-sm underline">
          ← Back to trips
        </Link>
        <div className="flex gap-2">
          <a
            className="btn-secondary"
            href={`${API_BASE}/admin/trips/${encodeURIComponent(tripId)}/manifest.csv`}
            download
          >
            Download CSV
          </a>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <div className="card p-5 print:border-0 print:shadow-none">
        <div className="flex items-center gap-4 border-b border-ink-900/15 pb-3">
          <img src={logoSrc} alt="" className="h-14 w-14" width={56} height={56} />
          <div>
            <h1 className="text-xl font-bold">Passenger list — {t.serviceLabel}</h1>
            <p className="text-sm">
              {formatTravelDate(t.travelDate)} · {formatWallTime(t.departureTime)} · {routeText(t)}{' '}
              · {DIRECTION_LABELS[t.direction]}
            </p>
            <p className="text-xs text-ink-800">
              {m.passengers.length} of {t.capacity} seats booked · generated{' '}
              {formatIst(m.generatedAt)} IST
              {t.status === 'CANCELLED' && ' · TRIP CANCELLED'}
            </p>
          </div>
        </div>

        {m.passengers.length === 0 ? (
          <p className="py-6 text-center text-sm">No confirmed passengers.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="print-table w-full min-w-[720px] border-collapse text-left text-sm">
              <caption className="sr-only">Confirmed passengers</caption>
              <thead className="bg-brand-100">
                <tr>
                  {[
                    'S.No',
                    'Passenger',
                    'Phone',
                    'Purpose',
                    'ID type',
                    'ID number',
                    'Signature / ✓',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border border-ink-900/15 px-2 py-2 text-xs font-semibold"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.passengers.map((p) => (
                  <tr key={p.reference}>
                    <td className="border border-ink-900/15 px-2 py-2 tabular-nums">{p.serial}</td>
                    <td className="border border-ink-900/15 px-2 py-2">
                      <span className="font-medium">{p.name}</span>
                      {p.passengerType === 'GUEST' && (
                        <span className="block text-xs">Guest of {p.bookedBy}</span>
                      )}
                      <span className="block font-mono text-[11px] text-ink-800">
                        {p.reference}
                      </span>
                    </td>
                    <td className="border border-ink-900/15 px-2 py-2 tabular-nums">
                      {p.phone ?? '—'}
                    </td>
                    <td className="border border-ink-900/15 px-2 py-2 text-xs">{p.purpose}</td>
                    <td className="border border-ink-900/15 px-2 py-2">
                      {ID_TYPE_LABELS[p.idType]}
                    </td>
                    <td className="border border-ink-900/15 px-2 py-2 font-mono">
                      {p.idNumber ?? '—'}
                    </td>
                    <td className="w-28 border border-ink-900/15 px-2 py-2" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {m.waitlist.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold">Waiting list (not confirmed)</h2>
            <ol className="mt-1 list-decimal pl-5 text-sm">
              {m.waitlist.map((w) => (
                <li key={w.reference}>
                  {w.name} · {w.phone ?? '—'} ·{' '}
                  <span className="font-mono text-xs">{w.reference}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        <p className="mt-6 text-[11px] text-ink-800">
          Confidential — contains personal ID numbers. Hand back to the SAC office after the trip.
        </p>
      </div>
    </div>
  );
}
