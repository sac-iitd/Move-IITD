import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TripCard } from '../components/TripCard';
import { tripFixture } from './fixtures';

function renderCard(overrides: Parameters<typeof tripFixture>[0], onBook = vi.fn()) {
  render(
    <MemoryRouter>
      <TripCard trip={tripFixture(overrides)} onBook={onBook} />
    </MemoryRouter>,
  );
  return onBook;
}

describe('TripCard', () => {
  it('offers booking when the trip is open', async () => {
    const onBook = renderCard({});
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText(/Booking open · closes/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Book seat: 10:00 AM/ }));
    expect(onBook).toHaveBeenCalledOnce();
  });

  it.each([
    ['NOT_OPEN', /Booking not open yet/],
    ['CLOSED', /Booking closed/],
    ['CANCELLED', /Trip cancelled/],
  ] as const)('explains %s and disables booking', (availability, message) => {
    renderCard({ availability, status: availability === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED' });
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('offers the waiting list when the trip is full', async () => {
    const onBook = renderCard({
      availability: 'FULL',
      waitlistCount: 3,
      bookedCount: 13,
      seatsRemaining: 0,
    });
    expect(screen.getByText(/Fully booked · 3 on waiting list/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Join waiting list/ }));
    expect(onBook).toHaveBeenCalledOnce();
  });

  it('lists my bookings on the trip and allows one more seat', () => {
    renderCard({
      myBookings: [
        {
          reference: 'SNP-7K3M-Q9XD',
          status: 'CONFIRMED',
          passengerType: 'SELF',
          passengerName: 'Asha',
        },
      ],
    });
    expect(screen.getByRole('link', { name: /SNP-7K3M-Q9XD/ })).toHaveAttribute(
      'href',
      '/bookings/SNP-7K3M-Q9XD',
    );
    expect(screen.getByRole('button', { name: /Book another seat/ })).toBeEnabled();
  });

  it('stops at the 2-seat limit', () => {
    renderCard({
      myBookings: [
        {
          reference: 'SNP-AAAA-AAAA',
          status: 'CONFIRMED',
          passengerType: 'SELF',
          passengerName: 'Asha',
        },
        {
          reference: 'SNP-BBBB-BBBB',
          status: 'WAITLISTED',
          passengerType: 'GUEST',
          passengerName: 'Meera',
        },
      ],
    });
    expect(screen.getByRole('button')).toHaveTextContent('Seat limit reached');
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByText('Meera')).toBeInTheDocument();
  });

  it('is disabled while the account is blocked', () => {
    render(
      <MemoryRouter>
        <TripCard trip={tripFixture({})} onBook={vi.fn()} blocked />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Booking paused');
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('flags special buses and provisional times', () => {
    renderCard({ isSpecial: true, timeProvisional: true, departureTime: '13:30' });
    expect(screen.getByText('★ Special bus')).toBeInTheDocument();
    expect(screen.getByText('Time to be confirmed')).toBeInTheDocument();
    expect(screen.getByText('1:30 PM')).toBeInTheDocument();
  });

  it('exposes an accessible capacity meter', () => {
    renderCard({});
    expect(screen.getByRole('meter', { name: 'Seats booked' })).toHaveAttribute(
      'aria-valuenow',
      '4',
    );
  });
});
