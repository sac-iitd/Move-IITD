import { afterEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage';
import { MyBookingsPage } from '../pages/MyBookingsPage';
import { LoginPage } from '../pages/LoginPage';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { bookingFixture, tripFixture } from './fixtures';
import { meResponse, mockFetch, renderWithProviders } from './render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('dashboard booking flow', () => {
  it('books a seat with phone, purpose, CSRF + idempotency headers and shows the reference', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /trips': () => ({
        body: { trips: [tripFixture()], serverTime: new Date().toISOString() },
      }),
      'POST /trips/trip1/bookings': () => ({
        status: 201,
        body: { bookings: [bookingFixture()], created: true },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });

    await userEvent.click(await screen.findByRole('button', { name: /Book seat: 10:00 AM/ }));
    const dialog = screen.getByRole('dialog', { name: 'Book a seat' });
    // Phone is prefilled from the last booking.
    expect(within(dialog).getByLabelText(/mobile number/)).toHaveValue('9876543210');
    await userEvent.selectOptions(within(dialog).getByLabelText('Purpose of visit'), 'ACADEMIC');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByRole('dialog', { name: 'Booking confirmed' })).toBeInTheDocument();
    expect(screen.getByText('SNP-7K3M-Q9XD')).toBeInTheDocument();
    expect(screen.getByText(/confirmation email is on its way/)).toBeInTheDocument();

    const post = calls.find((c) => c.key === 'POST /trips/trip1/bookings')!;
    const headers = post.init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('csrf-token-abc');
    expect(headers['Idempotency-Key']).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.parse(post.init.body as string)).toMatchObject({
      bookerName: 'Asha Kumar',
      phone: '9876543210',
      joinWaitlist: false,
      passengers: [{ passengerType: 'SELF', purpose: 'ACADEMIC' }],
    });
  });

  it('validates the form before sending, including guest ID numbers', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: { ...meResponse, lastPhone: null } }),
      'GET /trips': () => ({
        body: { trips: [tripFixture()], serverTime: new Date().toISOString() },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    await userEvent.click(await screen.findByRole('button', { name: /Book seat: 10:00 AM/ }));
    const dialog = screen.getByRole('dialog', { name: 'Book a seat' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'No' }));
    await userEvent.type(within(dialog).getByLabelText('ID number'), '1234');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirm booking' }));
    expect(
      within(dialog).getAllByText('Enter a valid 10-digit Indian mobile number').length,
    ).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Enter a valid Aadhaar/)).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the full name as on the ID')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith('POST'))).toBe(false);
  });

  it('joins the waiting list when the trip is full', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /trips': () => ({
        body: {
          trips: [
            tripFixture({
              availability: 'FULL',
              bookedCount: 13,
              seatsRemaining: 0,
              waitlistCount: 2,
            }),
          ],
          serverTime: new Date().toISOString(),
        },
      }),
      'POST /trips/trip1/bookings': () => ({
        status: 201,
        body: {
          bookings: [bookingFixture({ status: 'WAITLISTED', waitlistPosition: 3 })],
          created: true,
        },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    await userEvent.click(await screen.findByRole('button', { name: /Join waiting list/ }));
    const dialog = screen.getByRole('dialog', { name: 'Join the waiting list' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Purpose of visit'),
      'ADMINISTRATIVE',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Join waiting list' }));
    expect(
      await screen.findByRole('dialog', { name: "You're on the waiting list" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Waitlisted · #3/).length).toBeGreaterThan(0);
    const post = calls.find((c) => c.key === 'POST /trips/trip1/bookings')!;
    expect(JSON.parse(post.init.body as string).joinWaitlist).toBe(true);
  });

  it('shows the server reason when booking fails', async () => {
    mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /trips': () => ({
        body: {
          trips: [tripFixture({ seatsRemaining: 1, bookedCount: 12 })],
          serverTime: new Date().toISOString(),
        },
      }),
      'POST /trips/trip1/bookings': () => ({
        status: 409,
        body: {
          error: {
            code: 'TRIP_FULL',
            message: 'This trip is fully booked. You can join the waiting list.',
          },
        },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    await userEvent.click(await screen.findByRole('button', { name: /Book seat: 10:00 AM/ }));
    await userEvent.selectOptions(screen.getByLabelText('Purpose of visit'), 'ACADEMIC');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This trip is fully booked.');
    expect(screen.getByRole('button', { name: 'Confirm booking' })).toBeDisabled();
  });

  it('shows the block notice and disables booking for blocked users', async () => {
    mockFetch({
      'GET /auth/me': () => ({
        body: { ...meResponse, block: { until: '2026-10-30', reason: 'Repeated no-shows' } },
      }),
      'GET /trips': () => ({
        body: { trips: [tripFixture()], serverTime: new Date().toISOString() },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    expect(await screen.findByText(/Booking paused until/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Booking open/ })).toBeDisabled();
  });

  it('shows an empty state when no trips match', async () => {
    mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /trips': () => ({ body: { trips: [], serverTime: new Date().toISOString() } }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    expect(await screen.findByText('No trips found')).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /trips': () => ({
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Something went wrong.' } },
      }),
    });
    renderWithProviders(<DashboardPage />, { route: '/dashboard' });
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('my bookings', () => {
  it('lists bookings, keeps cancelled history visible and cancels with confirmation', async () => {
    let cancelled = false;
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: meResponse }),
      'GET /bookings/mine': () => ({
        body: {
          upcoming: [
            cancelled
              ? bookingFixture({
                  status: 'CANCELLED',
                  canCancel: false,
                  cancelledAt: new Date().toISOString(),
                })
              : bookingFixture(),
            bookingFixture({ reference: 'SNP-AAAA-BBBB', status: 'CANCELLED', canCancel: false }),
          ],
          past: [],
        },
      }),
      'POST /bookings/SNP-7K3M-Q9XD/cancel': () => {
        cancelled = true;
        return { body: { booking: bookingFixture({ status: 'CANCELLED' }) } };
      },
    });
    renderWithProviders(<MyBookingsPage />, { route: '/bookings' });
    expect(await screen.findByText('SNP-AAAA-BBBB')).toBeInTheDocument();
    expect(screen.getAllByText('Cancelled')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this booking?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel booking' }));
    await waitFor(() => expect(screen.getAllByText('Cancelled')).toHaveLength(2));
    expect(calls.some((c) => c.key === 'POST /bookings/SNP-7K3M-Q9XD/cancel')).toBe(true);
  });
});

describe('authentication states', () => {
  it('redirects signed-out users to sign-in and explains expired sessions', async () => {
    mockFetch({
      'GET /auth/me': () => ({
        status: 401,
        body: { error: { code: 'SESSION_EXPIRED', message: 'expired' } },
      }),
    });
    renderWithProviders(
      <Routes>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <p>secret</p>
            </ProtectedRoute>
          }
        />
        <Route path="/login" element={<LoginPage />} />
      </Routes>,
      { route: '/dashboard' },
    );
    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Kerberos' })).toBeInTheDocument();
  });

  it('shows provider errors on the sign-in page', async () => {
    mockFetch({
      'GET /auth/me': () => ({
        status: 401,
        body: { error: { code: 'UNAUTHENTICATED', message: 'x' } },
      }),
    });
    renderWithProviders(<LoginPage />, { route: '/login?error=not_eligible' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/not eligible/);
  });
});
