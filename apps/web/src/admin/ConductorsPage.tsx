import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConductorDto } from '@iitd-bus/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { Alert, EmptyState, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { errorMessage, formatIst } from '../lib/format';
import { TableWrap, Td, Th } from './components';

export function ConductorsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [kerberosId, setKerberosId] = useState('');
  const list = useQuery({
    queryKey: ['admin', 'conductors'],
    queryFn: () => api<{ conductors: ConductorDto[] }>('/admin/conductors'),
  });

  const grant = useMutation({
    mutationFn: () =>
      api<{ conductor: ConductorDto }>('/admin/conductors', {
        method: 'POST',
        body: { kerberosId },
      }),
    onSuccess: (r) => {
      toast(`${r.conductor.kerberosId} can scan tickets.`, 'success');
      setKerberosId('');
      void qc.invalidateQueries({ queryKey: ['admin', 'conductors'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/admin/conductors/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast('Conductor access removed. Their scan history is kept.', 'success');
      void qc.invalidateQueries({ queryKey: ['admin', 'conductors'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Conductors" />
      <p className="text-sm text-ink-800">
        A conductor can scan boarding passes. They see passenger names and how many people have
        boarded, not phone numbers or ID documents. Administrators can scan as well.
      </p>
      <form
        className="card flex flex-wrap items-end gap-3 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          grant.mutate();
        }}
      >
        <label className="min-w-56 flex-1">
          <span className="label">Kerberos id</span>
          <input
            className="input"
            value={kerberosId}
            autoComplete="off"
            placeholder="cs1234567"
            onChange={(e) => setKerberosId(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="btn-primary"
          disabled={grant.isPending || !kerberosId.trim()}
        >
          Give access
        </button>
      </form>
      {grant.error && <Alert tone="error">{errorMessage(grant.error)}</Alert>}

      {list.isPending ? (
        <LoadingSkeleton rows={2} label="Loading conductors" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.conductors.length === 0 ? (
        <EmptyState title="No conductors yet" />
      ) : (
        <TableWrap caption="Conductors">
          <thead className="bg-brand-100">
            <tr>
              <Th>Kerberos id</Th>
              <Th>Name</Th>
              <Th>Access</Th>
              <Th>Boarded</Th>
              <Th>Scans</Th>
              <Th>Since</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.data.conductors.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono">{c.kerberosId}</Td>
                <Td>{c.name ?? 'Not signed in yet'}</Td>
                <Td>{c.active ? 'Active' : 'Removed'}</Td>
                <Td>{c.boardedCount}</Td>
                <Td>{c.scanCount}</Td>
                <Td>{formatIst(c.grantedAt)}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/admin/conductors/${c.id}`}
                      className="btn-secondary min-h-9 px-3 py-1"
                    >
                      History
                    </Link>
                    {c.active && (
                      <button
                        type="button"
                        className="btn-danger min-h-9 px-3 py-1"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate(c.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  );
}
