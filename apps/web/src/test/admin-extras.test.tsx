import { afterEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import type { AnalyticsResponse, ManifestResponse } from '@iitd-bus/shared';
import { AnalyticsPage } from '../admin/AnalyticsPage';
import { ManifestPage } from '../admin/ManifestPage';
import { UsersPage } from '../admin/UsersPage';
import { ClosuresSection } from '../admin/ScheduleExtras';
import { tripFixture } from './fixtures';
import { meResponse, mockFetch, renderWithProviders } from './render';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const adminMe = { ...meResponse, user: { ...meResponse.user, role: 'ADMIN' } };

describe('driver manifest', () => {
  it('shows passengers with ID type and number, the waitlist and print/CSV actions', async () => {
    const manifest: ManifestResponse = {
      trip: {
        ...tripFixture({ serviceLabel: 'VAN' }),
        serviceTemplateId: 't',
        cancellationReason: null,
        cancelledAt: null,
      },
      generatedAt: new Date().toISOString(),
      passengers: [
        {
          serial: 1,
          reference: 'SNP-AAAA-AAAA',
          name: 'Ravi',
          phone: '9876543210',
          purpose: 'Academic',
          passengerType: 'SELF',
          bookedBy: 'Ravi',
          idType: 'IITD_ID',
          idNumber: 'cs1200001',
        },
        {
          serial: 2,
          reference: 'SNP-BBBB-BBBB',
          name: 'Meera',
          phone: '9123456789',
          purpose: 'Administrative',
          passengerType: 'GUEST',
          bookedBy: 'Ravi',
          idType: 'PAN',
          idNumber: 'ABCDE1234F',
        },
      ],
      waitlist: [{ position: 1, reference: 'SNP-CCCC-CCCC', name: 'Wait Person', phone: null }],
    };
    mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/trips/trip1/manifest': () => ({ body: manifest }),
    });
    renderWithProviders(
      <Routes>
        <Route path="/admin/trips/:tripId/manifest" element={<ManifestPage />} />
      </Routes>,
      { route: '/admin/trips/trip1/manifest' },
    );
    expect(
      await screen.findByRole('heading', { name: /Passenger list: VAN/ }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Confirmed passengers' });
    expect(within(table).getByText('ABCDE1234F')).toBeInTheDocument();
    expect(within(table).getByText('PAN card')).toBeInTheDocument();
    expect(within(table).getByText('Guest of Ravi')).toBeInTheDocument();
    expect(screen.getByText(/Wait Person/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download CSV' })).toHaveAttribute(
      'href',
      '/api/v1/admin/trips/trip1/manifest.csv',
    );
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });
});

describe('users & blocks', () => {
  it('blocks a user with a date range and reason', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/users': () => ({
        body: {
          items: [
            {
              id: 'u2',
              name: 'Some Student',
              email: 's@iitd.ac.in',
              subject: 'cs1',
              role: 'USER',
              lastLoginAt: null,
              activeBlock: null,
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
        },
      }),
      'GET /admin/blocks': () => ({ body: { blocks: [] } }),
      'GET /admin/users/u2/travel': () => ({
        body: {
          from: '2026-04-16',
          entries: [
            {
              reference: 'SNP-HIST-0001',
              status: 'CONFIRMED',
              travelDate: '2026-10-13',
              departureTime: '07:30',
              direction: 'DELHI_TO_SONIPAT',
              origin: 'DELHI',
              destination: 'SONIPAT',
              serviceLabel: 'BUS',
              passengerName: 'Some Student',
              passengerType: 'SELF',
            },
          ],
        },
      }),
      'POST /admin/blocks': () => ({ status: 201, body: { block: {}, cancelledBookings: 2 } }),
    });
    renderWithProviders(<UsersPage />, { route: '/admin/users' });
    await userEvent.click(await screen.findByRole('button', { name: 'Block' }));
    const dialog = screen.getByRole('dialog', { name: 'Block Some Student' });
    const confirm = within(dialog).getByRole('button', { name: 'Block user' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Repeated no-shows');
    await userEvent.click(confirm);
    expect(await screen.findByText(/2 booking\(s\) cancelled/)).toBeInTheDocument();
    const body = JSON.parse(calls.find((c) => c.key === 'POST /admin/blocks')!.init.body as string);
    expect(body).toMatchObject({ userId: 'u2', reason: 'Repeated no-shows' });
    expect(body.startsOn <= body.endsOn).toBe(true);
    expect(await screen.findByText('SNP-HIST-0001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Travel history: Some Student' })).toBeInTheDocument();
  });
});

describe('holiday closures', () => {
  it('requires a reason before stopping buses on a date', async () => {
    const calls = mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/closures': () => ({ body: { closures: [] } }),
      'POST /admin/closures': () => ({
        status: 201,
        body: { closure: {}, cancelledTrips: 6, affectedBookings: 4 },
      }),
    });
    renderWithProviders(<ClosuresSection />);
    await userEvent.type(await screen.findByLabelText('Date'), '2030-01-26');
    await userEvent.click(screen.getByRole('button', { name: 'Stop buses on this date' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Republic Day');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop buses' }));
    expect(
      await screen.findByText(/6 trip\(s\) cancelled, 4 passenger\(s\) emailed/),
    ).toBeInTheDocument();
    expect(
      JSON.parse(calls.find((c) => c.key === 'POST /admin/closures')!.init.body as string),
    ).toEqual({
      date: '2030-01-26',
      reason: 'Republic Day',
    });
  });
});

describe('analytics', () => {
  it('renders KPI tiles and charts, each with a table view', async () => {
    const data: AnalyticsResponse = {
      range: { from: '2026-10-01', to: '2026-10-07' },
      totals: {
        bookings: 40,
        cancelled: 4,
        cancellationRate: 9.1,
        seatsOffered: 100,
        seatsFilled: 40,
        occupancy: 40,
        trips: 6,
        cancelledTrips: 1,
      },
      daily: [{ date: '2026-10-05', confirmed: 40, cancelled: 4, capacity: 100, occupancy: 40 }],
      byDeparture: [
        {
          key: 'k',
          serviceLabel: 'BUS',
          departureTime: '07:30',
          direction: 'DELHI_TO_SONIPAT',
          trips: 1,
          confirmed: 20,
          capacity: 24,
          occupancy: 83.3,
        },
      ],
      byWeekday: [{ weekday: 1, confirmed: 40, capacity: 100, occupancy: 40 }],
      byDirection: [
        { direction: 'DELHI_TO_SONIPAT', confirmed: 25, capacity: 50 },
        { direction: 'SONIPAT_TO_DELHI', confirmed: 15, capacity: 50 },
      ],
      leadTime: [{ bucket: '1 day', bookings: 30 }],
    };
    mockFetch({
      'GET /auth/me': () => ({ body: adminMe }),
      'GET /admin/analytics': () => ({ body: data }),
    });
    renderWithProviders(<AnalyticsPage />, { route: '/admin/analytics' });
    expect(await screen.findByText('Occupancy', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Seats booked per day' })).toBeInTheDocument();
    expect(screen.getByText('83.3%')).toBeInTheDocument();
    expect(screen.getByText(/Hauz Khas Campus → IIT Delhi Sonipat Campus:/)).toBeInTheDocument();
    const toggles = screen.getAllByRole('button', { name: 'Show table' });
    expect(toggles).toHaveLength(5);
    await userEvent.click(toggles[0]!);
    expect(screen.getByRole('columnheader', { name: 'Seats booked' })).toBeInTheDocument();
  });
});
