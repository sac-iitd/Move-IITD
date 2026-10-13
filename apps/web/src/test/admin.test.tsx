import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { AdminRoutes } from '../admin/AdminRoutes';
import { tripFixture } from './fixtures';
import { meResponse, mockFetch, renderWithProviders } from './render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const adminMe = { ...meResponse, user: { ...meResponse.user, role: 'ADMIN', name: 'DGS SAC' } };
const adminApp = (
  <Routes>
    <Route
      path="/admin/*"
      element={
        <ProtectedRoute admin>
          <AdminRoutes />
        </ProtectedRoute>
      }
    />
  </Routes>
);

describe('admin portal', () => {
  it('denies non-admin users in the UI (the API enforces this independently)', async () => {
    mockFetch({ 'GET /auth/me': () => ({ body: meResponse }) });
    renderWithProviders(adminApp, { route: '/admin' });
    expect(await screen.findByText('Administrator access required')).toBeInTheDocument();
  });

  it('cancels a trip only after a reason is entered', async () => {
    const trip = {
      ...tripFixture({ bookedCount: 2 }),
      serviceTemplateId: 't1',
      cancellationReason: null,
      cancelledAt: null,
    };
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/templates': () => ({ body: { templates: [] } }),
      'GET /admin/trips': () => ({ body: { trips: [trip] } }),
      'POST /admin/trips/trip1/cancel': () => ({
        body: { trip: { ...trip, status: 'CANCELLED' }, affectedBookings: 2 },
      }),
    });
    renderWithProviders(adminApp, { route: '/admin/trips' });
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel trip' }));
    const dialog = screen.getByRole('dialog', { name: 'Cancel this departure?' });
    const confirm = within(dialog).getByRole('button', { name: 'Cancel trip' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Institute holiday');
    await userEvent.click(confirm);
    expect(await screen.findByText(/2 passenger\(s\) will be emailed/)).toBeInTheDocument();
    const post = calls.find((c) => c.key === 'POST /admin/trips/trip1/cancel')!;
    expect(JSON.parse(post.init.body as string)).toEqual({ reason: 'Institute holiday' });
  });

  it('shows the overview summary and the provisional-time warning', async () => {
    mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/overview': () => ({
        body: {
          range: { from: '2026-10-19', to: '2026-10-19' },
          todayTrips: 6,
          totalBookings: 41,
          seatsFilled: 41,
          seatsRemaining: 59,
          cancelledBookings: 3,
          tripsAtCapacity: 1,
          pendingNotifications: 0,
          failedNotifications: 0,
          provisionalTemplates: 1,
        },
      }),
      'GET /admin/trips': () => ({ body: { trips: [] } }),
    });
    renderWithProviders(adminApp, { route: '/admin' });
    expect(await screen.findByText('Timetable entry awaiting confirmation')).toBeInTheDocument();
    expect(screen.getByText('Bookings', { selector: 'p' }).closest('.card')).toHaveTextContent(
      '41',
    );
    expect(screen.getByText('Seats left', { selector: 'p' }).closest('.card')).toHaveTextContent(
      '59',
    );
  });
});
