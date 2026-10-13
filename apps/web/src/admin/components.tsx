import { useEffect, useId, useState, type ReactNode } from 'react';
import { DIRECTION_LABELS, type Direction } from '@iitd-bus/shared';
import { Dialog } from '../components/Dialog';
import { Alert } from '../components/ui';
import { errorMessage } from '../lib/format';

export function AdminStatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warn' | 'bad';
}) {
  const toneCls =
    tone === 'bad' ? 'text-red-800' : tone === 'warn' ? 'text-amber-800' : 'text-ink-900';
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-800">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span>
        {total === 0
          ? 'No results'
          : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/** Debounced search box. */
export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (draft !== value) onChange(draft);
    }, 300);
    return () => clearTimeout(h);
  }, [draft, value, onChange]);
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className="input"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  );
}

export function DateRangeFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const fromId = useId();
  const toId = useId();
  return (
    <>
      <div>
        <label htmlFor={fromId} className="label">
          From
        </label>
        <input
          id={fromId}
          type="date"
          className="input"
          value={from}
          onChange={(e) => onChange({ from: e.target.value, to })}
        />
      </div>
      <div>
        <label htmlFor={toId} className="label">
          To
        </label>
        <input
          id={toId}
          type="date"
          className="input"
          value={to}
          onChange={(e) => onChange({ from, to: e.target.value })}
        />
      </div>
    </>
  );
}

export function DirectionSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: Direction | '') => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="label">
        Direction
      </label>
      <select
        id={id}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value as Direction | '')}
      >
        <option value="">Both</option>
        {(Object.keys(DIRECTION_LABELS) as Direction[]).map((d) => (
          <option key={d} value={d}>
            {DIRECTION_LABELS[d]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Destructive confirmation that requires a written reason. */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  pending,
  error,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  pending: boolean;
  error: unknown;
}) {
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const valid = reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      busy={pending}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={pending}>
            Back
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={!valid || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div>{description}</div>
      <label htmlFor={id} className="label mt-4">
        Reason (required, shown to passengers)
      </label>
      <textarea
        id={id}
        className="input min-h-20"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {error != null && (
        <div className="mt-3">
          <Alert tone="error">{errorMessage(error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-800"
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-top text-sm ${className}`}>{children}</td>;
}

export function TableWrap({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
