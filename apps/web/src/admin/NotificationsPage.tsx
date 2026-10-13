import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  NotificationDto,
  NotificationStatus,
  NotificationType,
  Paginated,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { NotificationStatusBadge } from '../components/Badges';
import { useToast } from '../components/Toast';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { errorMessage, formatIst } from '../lib/format';
import { Pagination, TableWrap, Td, Th } from './components';

const TYPE_LABELS: Record<NotificationType, string> = {
  BOOKING_CONFIRMATION: 'Booking confirmation',
  BOOKING_CANCELLATION: 'Booking cancellation',
  TRIP_CANCELLATION: 'Trip cancellation',
  WAITLIST_JOINED: 'Joined waiting list',
  WAITLIST_PROMOTED: 'Seat from waiting list',
  WAITLIST_EXPIRED: 'Waiting list closed',
  USER_BLOCKED: 'Booking access paused',
};

export function NotificationsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus | ''>('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(status && { status }) });
  const list = useQuery({
    queryKey: ['admin', 'notifications', qs.toString()],
    queryFn: () => api<Paginated<NotificationDto>>(`/admin/notifications?${qs}`),
    refetchInterval: 15_000,
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/admin/notifications/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      toast('Email re-queued for delivery.', 'success');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label htmlFor="n-status" className="label">
          Status
        </label>
        <select
          id="n-status"
          className="input"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as NotificationStatus | '');
            setPage(1);
          }}
        >
          <option value="">All</option>
          <option value="PENDING">Pending</option>
          <option value="SENDING">Sending</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>
      {list.isPending ? (
        <LoadingSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <>
          <TableWrap caption="Email notifications">
            <thead className="bg-brand-100">
              <tr>
                <Th>Created</Th>
                <Th>Type</Th>
                <Th>Recipient</Th>
                <Th>Booking</Th>
                <Th>Status</Th>
                <Th>Attempts</Th>
                <Th>Last error / next try</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((n) => (
                <tr key={n.id} className="border-t border-ink-900/10">
                  <Td className="text-xs">{formatIst(n.createdAt)}</Td>
                  <Td>{TYPE_LABELS[n.type]}</Td>
                  <Td className="text-xs">{n.recipient || '-'}</Td>
                  <Td className="font-mono text-xs">{n.bookingReference ?? '-'}</Td>
                  <Td>
                    <NotificationStatusBadge status={n.status} />
                  </Td>
                  <Td className="tabular-nums">{n.attemptCount}</Td>
                  <Td className="max-w-xs text-xs">
                    {n.lastError && <p className="text-red-800">{n.lastError}</p>}
                    {n.status === 'PENDING' && n.nextAttemptAt && (
                      <p>Next: {formatIst(n.nextAttemptAt)}</p>
                    )}
                    {n.sentAt && <p>Sent {formatIst(n.sentAt)}</p>}
                  </Td>
                  <Td>
                    {n.status === 'FAILED' && n.recipient && (
                      <button
                        type="button"
                        className="btn-secondary min-h-9 px-3 py-1"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate(n.id)}
                      >
                        Retry
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
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
