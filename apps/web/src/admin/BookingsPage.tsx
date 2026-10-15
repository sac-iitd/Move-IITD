import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  idTypeText,
  PURPOSE_LABELS,
  type AdminBookingDto,
  type BookingStatus,
  type Direction,
  type Paginated,
} from '@iitd-bus/shared';
import { API_BASE, api } from '../api/client';
import { BookingStatusBadge, DirectionBadge, NotificationStatusBadge } from '../components/Badges';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { formatIst, formatTravelDate, formatWallTime } from '../lib/format';
import {
  DateRangeFilter,
  DirectionSelect,
  Pagination,
  ReasonDialog,
  SearchInput,
  TableWrap,
  Td,
  Th,
} from './components';

const FILTER_KEYS = ['q', 'status', 'direction', 'from', 'to', 'tripId'] as const;

export function BookingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? '1') || 1;
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Record<
    (typeof FILTER_KEYS)[number],
    string
  >;
  const [cancelling, setCancelling] = useState<AdminBookingDto | null>(null);

  const update = useCallback(
    (changes: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(changes)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!('page' in changes)) next.delete('page');
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const listQuery = new URLSearchParams(query);
  listQuery.set('page', String(page));

  const list = useQuery({
    queryKey: ['admin', 'bookings', listQuery.toString()],
    queryFn: () => api<Paginated<AdminBookingDto>>(`/admin/bookings?${listQuery}`),
    placeholderData: (prev) => prev,
  });

  const cancel = useMutation({
    mutationFn: ({ reference, reason }: { reference: string; reason: string }) =>
      api(`/admin/bookings/${reference}/cancel`, { method: 'POST', body: { reason } }),
    onSuccess: () => {
      toast('Booking cancelled and passenger notified.', 'success');
      setCancelling(null);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <SearchInput
            label="Search"
            placeholder="Reference, name, email or Kerberos ID"
            value={filters.q}
            onChange={(q) => update({ q })}
          />
        </div>
        <div>
          <label htmlFor="status-f" className="label">
            Status
          </label>
          <select
            id="status-f"
            className="input"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as BookingStatus | '' })}
          >
            <option value="">All</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="WAITLISTED">Waitlisted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <DirectionSelect
          value={filters.direction}
          onChange={(d: Direction | '') => update({ direction: d })}
        />
        <DateRangeFilter from={filters.from} to={filters.to} onChange={(r) => update(r)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {filters.tripId ? (
          <p className="text-sm">
            Showing passengers for one trip.{' '}
            <button
              type="button"
              className="cursor-pointer underline"
              onClick={() => update({ tripId: '' })}
            >
              Show all
            </button>
          </p>
        ) : (
          <span />
        )}
        <a
          className="btn-secondary"
          href={`${API_BASE}/admin/bookings/export.csv?${query}`}
          download
        >
          Export CSV
        </a>
      </div>

      {list.isPending ? (
        <LoadingSkeleton rows={4} label="Loading bookings" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No bookings match these filters" />
      ) : (
        <>
          <TableWrap caption="Bookings">
            <thead className="bg-brand-100">
              <tr>
                <Th>Reference</Th>
                <Th>Passenger</Th>
                <Th>Contact &amp; ID</Th>
                <Th>Trip</Th>
                <Th>Status</Th>
                <Th>Booked</Th>
                <Th>Email</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((b) => (
                <tr key={b.reference} className="border-t border-ink-900/10">
                  <Td className="font-mono font-semibold">{b.reference}</Td>
                  <Td>
                    <p className="font-medium">
                      {b.passengerName}
                      {b.passengerType === 'GUEST' && (
                        <span className="text-xs font-normal"> (guest)</span>
                      )}
                    </p>
                    <p className="text-xs text-ink-800">
                      {b.passengerType === 'GUEST' ? 'Booked by ' : ''}
                      {b.userName} · {b.userEmail ?? '-'} · {b.userSubject}
                    </p>
                    <p className="text-xs text-ink-800">
                      {PURPOSE_LABELS[b.purpose]}
                      {b.purposeDetail && `: ${b.purposeDetail}`}
                    </p>
                  </Td>
                  <Td className="text-xs">
                    <p className="tabular-nums">{b.phone ?? '-'}</p>
                    <p>
                      {idTypeText(b.idType, b.idTypeDetail)}:{' '}
                      <span className="font-mono">{b.idNumber ?? '(erased)'}</span>
                    </p>
                  </Td>
                  <Td>
                    <p>
                      {formatTravelDate(b.travelDate)}, {formatWallTime(b.departureTime)}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <DirectionBadge direction={b.direction} />
                      <span className="text-xs">{b.serviceLabel}</span>
                    </div>
                  </Td>
                  <Td>
                    <BookingStatusBadge status={b.status} position={b.waitlistPosition} />
                    {b.cancelledAt && (
                      <p className="mt-1 text-xs">
                        {formatIst(b.cancelledAt)} {b.cancelledByAdmin ? '(admin)' : '(user)'}
                        {b.cancellationReason && (
                          <>
                            <br />
                            {b.cancellationReason}
                          </>
                        )}
                      </p>
                    )}
                  </Td>
                  <Td className="text-xs">{formatIst(b.bookedAt)}</Td>
                  <Td>
                    <NotificationStatusBadge status={b.emailStatus} />
                  </Td>
                  <Td>
                    {b.status !== 'CANCELLED' && (
                      <button
                        type="button"
                        className="btn-danger min-h-9 px-3 py-1"
                        onClick={() => {
                          cancel.reset();
                          setCancelling(b);
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination
            page={list.data.page}
            pageSize={list.data.pageSize}
            total={list.data.total}
            onPage={(p) => update({ page: String(p) })}
          />
        </>
      )}

      <ReasonDialog
        open={cancelling !== null}
        title="Cancel this booking?"
        description={
          cancelling && (
            <p>
              <span className="font-mono">{cancelling.reference}</span> for {cancelling.userName}.
              The seat will be released and the passenger emailed.
            </p>
          )
        }
        confirmLabel="Cancel booking"
        onClose={() => setCancelling(null)}
        onConfirm={(reason) =>
          cancelling && cancel.mutate({ reference: cancelling.reference, reason })
        }
        pending={cancel.isPending}
        error={cancel.error}
      />
    </div>
  );
}
