import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { BookingDto } from '@iitd-bus/shared';
import { ApiError, api } from '../api/client';
import { BoardingPass } from '../components/BoardingPass';
import { BookingSummary } from '../components/BookTripDialog';
import { BookingStatusBadge, NotificationStatusBadge } from '../components/Badges';
import { CancelBookingDialog } from '../components/CancelBookingDialog';
import { Alert, ErrorState, LoadingSkeleton, PageHeader } from '../components/ui';
import { deadline, formatIst } from '../lib/format';

export function BookingDetailsPage() {
  const { reference = '' } = useParams();
  const [cancelling, setCancelling] = useState<BookingDto | null>(null);
  const q = useQuery({
    queryKey: ['booking', reference],
    queryFn: () => api<{ booking: BookingDto }>(`/bookings/${encodeURIComponent(reference)}`),
    retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
  });

  if (q.isPending) return <LoadingSkeleton rows={1} label="Loading booking" />;
  if (q.isError) {
    if (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) {
      return (
        <Alert tone="warning" title="Booking not found">
          We couldn't find that booking on your account.{' '}
          <Link to="/bookings" className="underline">
            See my bookings
          </Link>
        </Alert>
      );
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }

  const b = q.data.booking;
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Booking details">
        <BookingStatusBadge status={b.status} position={b.waitlistPosition} />
      </PageHeader>
      <div className="space-y-4">
        {b.trip.status === 'CANCELLED' && (
          <Alert tone="error" title="This trip has been cancelled">
            {b.cancellationReason ?? 'The transport office cancelled this departure.'}
          </Alert>
        )}
        {b.status === 'WAITLISTED' && (
          <Alert tone="warning" title={`You're #${b.waitlistPosition ?? '?'} on the waiting list`}>
            If a seat frees up before booking closes ({deadline(b.trip.bookingClosesAt)}), it is
            given to you automatically and you'll get an email. Otherwise the entry closes on its
            own.
          </Alert>
        )}
        {b.status === 'CANCELLED' && b.trip.status !== 'CANCELLED' && (
          <Alert
            tone="info"
            title={
              b.cancelledByAdmin
                ? 'Cancelled by the transport office'
                : 'You cancelled this booking'
            }
          >
            {b.cancelledAt && <>On {formatIst(b.cancelledAt)}. </>}
            {b.cancellationReason && <>Reason: {b.cancellationReason}</>}
          </Alert>
        )}
        {b.status === 'CONFIRMED' &&
          (b.emailStatus === 'PENDING' || b.emailStatus === 'SENDING') && (
            <Alert tone="info">
              Your booking is confirmed. The confirmation email is still being sent.
            </Alert>
          )}
        {b.status === 'CONFIRMED' && b.emailStatus === 'FAILED' && (
          <Alert tone="warning">
            Your booking is confirmed, but we couldn't email you yet. This page is your
            confirmation.
          </Alert>
        )}
        <BoardingPass booking={b} />
        <div className="card p-5">
          <BookingSummary booking={b} />
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-ink-900/10 pt-4 text-sm">
            <dt className="font-medium">Booked</dt>
            <dd>{formatIst(b.bookedAt)}</dd>
            {b.status === 'CONFIRMED' && (
              <>
                <dt className="font-medium">Email</dt>
                <dd>
                  <NotificationStatusBadge status={b.emailStatus} />
                </dd>
              </>
            )}
          </dl>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link to="/bookings" className="btn-secondary">
            Back to my bookings
          </Link>
          {b.canCancel && (
            <button type="button" className="btn-danger" onClick={() => setCancelling(b)}>
              {b.status === 'WAITLISTED' ? 'Leave waiting list' : 'Cancel booking'}
            </button>
          )}
        </div>
        {b.status === 'CONFIRMED' && !b.canCancel && b.trip.status === 'SCHEDULED' && (
          <p className="text-xs text-ink-800">
            Online cancellation closed {deadline(b.trip.cancellationClosesAt)}. Contact the
            transport office for changes.
          </p>
        )}
      </div>
      <CancelBookingDialog booking={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}
