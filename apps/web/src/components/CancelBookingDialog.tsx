import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BookingDto } from '@iitd-bus/shared';
import { api } from '../api/client';
import { Dialog } from './Dialog';
import { Alert } from './ui';
import { useToast } from './Toast';
import { errorMessage, formatTravelDate, formatWallTime, routeText } from '../lib/format';

export function CancelBookingDialog({
  booking,
  onClose,
}: {
  booking: BookingDto | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const mutation = useMutation({
    mutationFn: (b: BookingDto) =>
      api<{ booking: BookingDto }>(`/bookings/${b.reference}/cancel`, {
        method: 'POST',
        body: reason.trim() ? { reason: reason.trim() } : {},
      }),
    onSuccess: () => {
      toast('Booking cancelled. Your seat has been released.', 'success');
      setReason('');
      onClose();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['my-bookings'] });
      void qc.invalidateQueries({ queryKey: ['booking'] });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });
  if (!booking) return null;
  const waitlisted = booking.status === 'WAITLISTED';
  const close = () => {
    mutation.reset();
    onClose();
  };
  return (
    <Dialog
      open
      title={waitlisted ? 'Leave the waiting list?' : 'Cancel this booking?'}
      onClose={close}
      busy={mutation.isPending}
      footer={
        <>
          <button
            type="button"
            className="btn-secondary"
            onClick={close}
            disabled={mutation.isPending}
          >
            {waitlisted ? 'Stay on list' : 'Keep booking'}
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={() => mutation.mutate(booking)}
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? 'Cancelling…'
              : waitlisted
                ? 'Leave waiting list'
                : 'Cancel booking'}
          </button>
        </>
      }
    >
      <p>
        <span className="font-mono font-semibold">{booking.reference}</span>:{' '}
        {formatTravelDate(booking.trip.travelDate)}, {formatWallTime(booking.trip.departureTime)},{' '}
        {routeText(booking.trip)}
      </p>
      <p className="mt-2">
        {waitlisted
          ? 'You will lose your place in the queue.'
          : 'Your seat will be released and given to the first person on the waiting list.'}
      </p>
      <label className="label mt-4" htmlFor="cancel-reason">
        Reason (optional)
      </label>
      <textarea
        id="cancel-reason"
        className="input min-h-20"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {mutation.error && (
        <div className="mt-4">
          <Alert tone="error">{errorMessage(mutation.error)}</Alert>
        </div>
      )}
    </Dialog>
  );
}
