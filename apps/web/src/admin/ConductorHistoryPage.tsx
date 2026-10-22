import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { DIRECTION_LABELS, type ConductorHistoryDto } from '@iitd-bus/shared';
import { api } from '../api/client';
import { ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { formatIst, formatTravelDate, formatWallTime } from '../lib/format';

const RESULT_LABEL: Record<string, string> = {
  BOARDED: 'Boarded',
  ALREADY_BOARDED: 'Already boarded',
  WRONG_TRIP: 'Wrong vehicle',
  CANCELLED: 'Cancelled ticket',
  NOT_CONFIRMED: 'Waiting list',
  TRIP_CANCELLED: 'Departure cancelled',
  INVALID: 'Not a ticket',
};

export function ConductorHistoryPage() {
  const { grantId = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'conductors', grantId],
    queryFn: () => api<ConductorHistoryDto>(`/admin/conductors/${encodeURIComponent(grantId)}`),
  });

  if (q.isPending) return <LoadingSkeleton rows={3} label="Loading conductor history" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const { conductor, trips } = q.data;

  return (
    <div className="space-y-4">
      <Link to="/admin/conductors" className="text-sm underline">
        Back to conductors
      </Link>
      <PageHeader title={conductor.name ?? conductor.kerberosId}>
        <span className="text-sm text-ink-800">
          {conductor.active ? 'Active' : 'Access removed'}
        </span>
      </PageHeader>
      <p className="text-sm text-ink-800">
        Kerberos id <span className="font-mono">{conductor.kerberosId}</span>
        {conductor.email ? ` · ${conductor.email}` : ''}. {conductor.boardedCount} people boarded
        across {conductor.scanCount} scans.
        {conductor.grantedByName ? ` Access given by ${conductor.grantedByName}.` : ''}
      </p>
      {trips.length === 0 ? (
        <p className="text-sm text-ink-800">No scans yet.</p>
      ) : (
        trips.map((trip) => (
          <section key={trip.tripId} className="card p-4">
            <h2 className="font-bold">
              {formatTravelDate(trip.travelDate)} · {formatWallTime(trip.departureTime)} ·{' '}
              {trip.serviceLabel}
            </h2>
            <p className="text-sm text-ink-800">
              {DIRECTION_LABELS[trip.direction]} · {trip.boarded} boarded
            </p>
            <ul className="mt-3 divide-y divide-ink-900/10 text-sm">
              {trip.scans.map((scan, i) => (
                <li key={`${scan.at}-${i}`} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{scan.passengerName ?? 'Unknown code'}</span>
                    {scan.reference && (
                      <span className="ml-2 font-mono text-xs text-ink-800">{scan.reference}</span>
                    )}
                  </span>
                  <span className="text-ink-800">
                    {RESULT_LABEL[scan.result] ?? scan.result} · {formatIst(scan.at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
