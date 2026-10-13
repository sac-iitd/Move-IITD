import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditLogDto, Paginated } from '@iitd-bus/shared';
import { api } from '../api/client';
import { EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { formatIst } from '../lib/format';
import { Pagination, TableWrap, Td, Th } from './components';

const ACTIONS = [
  'ADMIN_SIGN_IN',
  'ROLE_GRANTED',
  'ROLE_REVOKED',
  'TRIP_CANCELLED',
  'TRIP_UPDATED',
  'TRIPS_GENERATED',
  'TEMPLATE_UPDATED',
  'TEMPLATE_TIME_CONFIRMED',
  'BOOKING_CANCELLED',
  'BOOKINGS_EXPORTED',
  'NOTIFICATION_RETRIED',
  'SERVICE_CLOSURE_CREATED',
  'SERVICE_CLOSURE_REMOVED',
  'SPECIAL_TRIP_CREATED',
  'USER_BLOCKED',
  'USER_UNBLOCKED',
  'MANIFEST_VIEWED',
  'MANIFEST_EXPORTED',
  'ID_NUMBER_VIEWED',
];

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ page: String(page), ...(action && { action }) });
  const list = useQuery({
    queryKey: ['admin', 'audit', qs.toString()],
    queryFn: () => api<Paginated<AuditLogDto>>(`/admin/audit-logs?${qs}`),
  });
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <label htmlFor="a-action" className="label">
          Action
        </label>
        <select
          id="a-action"
          className="input"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {list.isPending ? (
        <LoadingSkeleton rows={4} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="No audit entries" />
      ) : (
        <>
          <TableWrap caption="Audit log">
            <thead className="bg-brand-100">
              <tr>
                <Th>When (IST)</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a) => (
                <tr key={a.id} className="border-t border-ink-900/10">
                  <Td className="whitespace-nowrap text-xs">{formatIst(a.createdAt)}</Td>
                  <Td>
                    {a.actorName ? (
                      <>
                        {a.actorName}{' '}
                        <span className="text-xs text-ink-800">({a.actorSubject})</span>
                      </>
                    ) : (
                      <span className="text-xs">System / CLI</span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{a.action}</Td>
                  <Td className="text-xs">
                    {a.targetType ? `${a.targetType} ${a.targetId ?? ''}` : '-'}
                  </Td>
                  <Td className="text-xs">
                    {a.metadata != null && (
                      <details>
                        <summary className="cursor-pointer">View</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap rounded bg-brand-50 p-2">
                          {JSON.stringify(a.metadata, null, 2)}
                        </pre>
                      </details>
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
