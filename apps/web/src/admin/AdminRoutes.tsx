import { NavLink, Route, Routes } from 'react-router-dom';
import { OverviewPage } from './OverviewPage';
import { TripsPage } from './TripsPage';
import { BookingsPage } from './BookingsPage';
import { NotificationsPage } from './NotificationsPage';
import { AuditLogPage } from './AuditLogPage';
import { AnalyticsPage } from './AnalyticsPage';
import { ManifestPage } from './ManifestPage';
import { UsersPage } from './UsersPage';
import { useLocation } from 'react-router-dom';

const tabs = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/trips', label: 'Trips & schedule' },
  { to: '/admin/bookings', label: 'Bookings' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/users', label: 'Users & blocks' },
  { to: '/admin/notifications', label: 'Email' },
  { to: '/admin/audit-logs', label: 'Audit log' },
];

export function AdminRoutes() {
  const location = useLocation();
  return (
    <div>
      <p className="no-print text-xs font-semibold uppercase tracking-widest text-brand-600">
        Admin portal
      </p>
      <nav
        aria-label="Admin"
        className="no-print -mx-4 mb-6 mt-2 flex gap-1 overflow-x-auto border-b border-ink-900/15 px-4"
      >
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? 'border-brand-500 text-ink-900'
                  : 'border-transparent text-ink-800 hover:text-ink-900'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <div key={location.pathname} className="page-enter">
        <Routes>
          <Route index element={<OverviewPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="audit-logs" element={<AuditLogPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="trips/:tripId/manifest" element={<ManifestPage />} />
        </Routes>
      </div>
    </div>
  );
}
