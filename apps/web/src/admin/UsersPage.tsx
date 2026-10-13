import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  istDateOf,
  type AdminUserDto,
  type Paginated,
  type UserBlockDto,
} from '@iitd-bus/shared';
import { api } from '../api/client';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { Alert, EmptyState, ErrorState, LoadingSkeleton } from '../components/ui';
import { errorMessage, formatIst, formatTravelDate } from '../lib/format';
import { Pagination, SearchInput, TableWrap, Td, Th } from './components';

function BlockDialog({ user, onClose }: { user: AdminUserDto | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const today = istDateOf(new Date());
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(addDays(today, 14));
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (user) {
      setStartsOn(today);
      setEndsOn(addDays(today, 14));
      setReason('');
    }
  }, [user, today]);
  const m = useMutation({
    mutationFn: () =>
      api<{ cancelledBookings: number }>('/admin/blocks', {
        method: 'POST',
        body: { userId: user!.id, startsOn, endsOn, reason: reason.trim() },
      }),
    onSuccess: (r) => {
      toast(
        `${user!.name} blocked. ${r.cancelledBookings} booking(s) cancelled and emailed.`,
        'success',
      );
      void qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
  });
  if (!user) return null;
  const valid = reason.trim().length >= 3 && startsOn <= endsOn;
  return (
    <Dialog
      open
      title={`Block ${user.name}`}
      onClose={onClose}
      busy={m.isPending}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={m.isPending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!valid || m.isPending}
            onClick={() => m.mutate()}
          >
            {m.isPending ? 'Blocking…' : 'Block user'}
          </button>
        </>
      }
    >
      <p>
        {user.email ?? user.subject} will not be able to book until the end date. Their bookings for
        trips in this period are <strong>cancelled</strong> (seats go to the waiting list) and they
        are emailed.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="blk-from">
            From
          </label>
          <input
            id="blk-from"
            type="date"
            className="input"
            min={today}
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="blk-to">
            Until (inclusive)
          </label>
          <input
            id="blk-to"
            type="date"
            className="input"
            min={startsOn}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
      </div>
      <label className="label mt-3" htmlFor="blk-reason">
        Reason (shown to the user)
      </label>
      <textarea
        id="blk-reason"
        className="input min-h-20"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {m.error && (
        <div className="mt-3">
          <Alert tone="error">{errorMessage(m.error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}

export function UsersPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [blocking, setBlocking] = useState<AdminUserDto | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...(q && { q }) });
  const users = useQuery({
    queryKey: ['admin', 'users', qs.toString()],
    queryFn: () => api<Paginated<AdminUserDto>>(`/admin/users?${qs}`),
    placeholderData: (prev) => prev,
  });
  const blocks = useQuery({
    queryKey: ['admin', 'blocks'],
    queryFn: () => api<{ blocks: UserBlockDto[] }>('/admin/blocks'),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/blocks/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      toast('Block lifted. The user can book again.', 'success');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const today = istDateOf(new Date());

  return (
    <div className="space-y-8">
      <section aria-labelledby="users-h" className="space-y-3">
        <h2 id="users-h" className="text-lg font-bold">
          Users
        </h2>
        <div className="max-w-md">
          <SearchInput
            label="Search"
            placeholder="Name, email or Kerberos ID"
            value={q}
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
          />
        </div>
        {users.isPending ? (
          <LoadingSkeleton rows={3} label="Loading users" />
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : users.data.items.length === 0 ? (
          <EmptyState title="No users found">
            Users appear here after their first sign-in.
          </EmptyState>
        ) : (
          <>
            <TableWrap caption="Users">
              <thead className="bg-brand-100">
                <tr>
                  <Th>Name</Th>
                  <Th>Email / Kerberos</Th>
                  <Th>Role</Th>
                  <Th>Last sign-in</Th>
                  <Th>Booking access</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((u) => (
                  <tr key={u.id} className="border-t border-ink-900/10">
                    <Td className="font-medium">{u.name}</Td>
                    <Td className="text-xs">
                      {u.email ?? '—'}
                      <span className="block text-ink-800">{u.subject}</span>
                    </Td>
                    <Td>{u.role === 'ADMIN' ? 'Admin' : 'User'}</Td>
                    <Td className="text-xs">{u.lastLoginAt ? formatIst(u.lastLoginAt) : '—'}</Td>
                    <Td className="text-xs">
                      {u.activeBlock ? (
                        <span className="font-semibold text-red-800">
                          Blocked{' '}
                          {u.activeBlock.startsOn > today
                            ? `from ${formatTravelDate(u.activeBlock.startsOn)} `
                            : ''}
                          until {formatTravelDate(u.activeBlock.endsOn)}
                        </span>
                      ) : (
                        <span className="text-emerald-800">Active</span>
                      )}
                    </Td>
                    <Td>
                      {u.activeBlock ? (
                        <button
                          type="button"
                          className="btn-secondary min-h-9 px-3 py-1"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(u.activeBlock!.id)}
                        >
                          Lift block
                        </button>
                      ) : u.role !== 'ADMIN' ? (
                        <button
                          type="button"
                          className="btn-danger min-h-9 px-3 py-1"
                          onClick={() => setBlocking(u)}
                        >
                          Block
                        </button>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pagination
              page={users.data.page}
              pageSize={users.data.pageSize}
              total={users.data.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      <section aria-labelledby="blocks-h" className="space-y-3">
        <h2 id="blocks-h" className="text-lg font-bold">
          Block history
        </h2>
        {blocks.isPending ? (
          <LoadingSkeleton rows={2} />
        ) : blocks.isError ? (
          <ErrorState error={blocks.error} onRetry={() => void blocks.refetch()} />
        ) : blocks.data.blocks.length === 0 ? (
          <EmptyState title="No blocks in the last 90 days" />
        ) : (
          <TableWrap caption="Blocks">
            <thead className="bg-brand-100">
              <tr>
                <Th>User</Th>
                <Th>Period</Th>
                <Th>Reason</Th>
                <Th>By</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {blocks.data.blocks.map((b) => (
                <tr key={b.id} className="border-t border-ink-900/10">
                  <Td className="font-medium">{b.userName}</Td>
                  <Td className="text-xs">
                    {formatTravelDate(b.startsOn)} – {formatTravelDate(b.endsOn)}
                  </Td>
                  <Td className="text-xs">{b.reason}</Td>
                  <Td className="text-xs">{b.createdByName ?? '—'}</Td>
                  <Td className="text-xs">
                    {b.revokedAt
                      ? `Lifted ${formatIst(b.revokedAt)}`
                      : b.endsOn < today
                        ? 'Ended'
                        : 'Active'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </section>

      <BlockDialog user={blocking} onClose={() => setBlocking(null)} />
    </div>
  );
}
