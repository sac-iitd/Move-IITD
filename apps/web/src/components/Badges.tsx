import {
  DIRECTION_LABELS,
  type BookingStatus,
  type Direction,
  type NotificationStatus,
  type TripStatus,
} from '@iitd-bus/shared';

const pill = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold';

export function DirectionBadge({ direction }: { direction: Direction }) {
  const style =
    direction === 'DELHI_TO_SONIPAT' ? 'bg-ink-900 text-brand-200' : 'bg-brand-200 text-ink-900';
  return <span className={`${pill} ${style}`}>{DIRECTION_LABELS[direction]}</span>;
}

export function BookingStatusBadge({
  status,
  position,
}: {
  status: BookingStatus;
  position?: number | null;
}) {
  if (status === 'CONFIRMED') {
    return <span className={`${pill} bg-emerald-100 text-emerald-900`}>✓ Confirmed</span>;
  }
  if (status === 'WAITLISTED') {
    return (
      <span className={`${pill} bg-amber-100 text-amber-900`}>
        ⏳ Waitlisted{position ? ` · #${position}` : ''}
      </span>
    );
  }
  return <span className={`${pill} bg-zinc-200 text-zinc-800`}>Cancelled</span>;
}

export function SpecialBadge() {
  return <span className={`${pill} bg-violet-100 text-violet-900`}>★ Special bus</span>;
}

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const map: Record<TripStatus, string> = {
    SCHEDULED: 'bg-sky-100 text-sky-900',
    CANCELLED: 'bg-red-100 text-red-900',
    COMPLETED: 'bg-zinc-200 text-zinc-800',
  };
  const label: Record<TripStatus, string> = {
    SCHEDULED: 'Scheduled',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
  };
  return <span className={`${pill} ${map[status]}`}>{label[status]}</span>;
}

export function NotificationStatusBadge({ status }: { status: NotificationStatus | null }) {
  if (!status) return <span className="text-xs text-ink-800">-</span>;
  const map: Record<NotificationStatus, [string, string]> = {
    PENDING: ['bg-amber-100 text-amber-900', 'Email pending'],
    SENDING: ['bg-amber-100 text-amber-900', 'Sending'],
    SENT: ['bg-emerald-100 text-emerald-900', 'Email sent'],
    FAILED: ['bg-red-100 text-red-900', 'Email failed'],
  };
  const [style, label] = map[status];
  return <span className={`${pill} ${style}`}>{label}</span>;
}

export function CapacityIndicator({ booked, capacity }: { booked: number; capacity: number }) {
  const remaining = Math.max(0, capacity - booked);
  const pct = capacity > 0 ? Math.min(100, Math.round((booked / capacity) * 100)) : 100;
  const bar = remaining === 0 ? 'bg-red-600' : remaining <= 3 ? 'bg-amber-500' : 'bg-emerald-600';
  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-ink-800">
        <span>
          <strong className="text-ink-900">{remaining}</strong> of {capacity} seats left
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink-900/10"
        role="meter"
        aria-label="Seats booked"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={booked}
        aria-valuetext={`${booked} of ${capacity} seats booked`}
      >
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
