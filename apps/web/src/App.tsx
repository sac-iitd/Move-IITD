import { lazy, Suspense } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppShell } from './components/AppShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen, NotFound, ServerUnavailable } from './components/Feedback';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyBookingsPage } from './pages/MyBookingsPage';
import { BookingDetailsPage } from './pages/BookingDetailsPage';

// The admin portal (incl. charts) is split into its own chunk; regular users never download it.
const AdminRoutes = lazy(() =>
  import('./admin/AdminRoutes').then((m) => ({ default: m.AdminRoutes })),
);

export function App() {
  const location = useLocation();
  const { error, loading, retry } = useAuth();
  // Admin sub-pages animate inside the admin layout, so the shell keys on the top-level section.
  const section = location.pathname.startsWith('/admin') ? '/admin' : location.pathname;

  const serverDown = !loading && error !== null && (error.status === 0 || error.status >= 500);

  return (
    <AppShell>
      {serverDown ? (
        <ServerUnavailable message={error.message} onRetry={retry} />
      ) : (
        <ErrorBoundary resetKey={location.pathname}>
          <div key={section} className="page-enter">
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bookings"
                element={
                  <ProtectedRoute>
                    <MyBookingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/bookings/:reference"
                element={
                  <ProtectedRoute>
                    <BookingDetailsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute admin>
                    <Suspense fallback={<LoadingScreen label="Loading admin portal" />}>
                      <AdminRoutes />
                    </Suspense>
                  </ProtectedRoute>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>
        </ErrorBoundary>
      )}
    </AppShell>
  );
}
