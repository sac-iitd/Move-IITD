import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert } from './ui';
import { LoadingScreen } from './Feedback';

/**
 * UX-only guard. The API independently enforces authentication and roles on
 * every request, so hiding a route here is never the security boundary.
 */
export function ProtectedRoute({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const { user, loading, sessionExpired } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen label="Checking your session" />;
  if (!user) {
    const returnTo = location.pathname + location.search;
    const params = new URLSearchParams({ returnTo });
    if (sessionExpired) params.set('expired', '1');
    return <Navigate to={`/login?${params}`} replace />;
  }
  if (admin && user.role !== 'ADMIN') {
    return (
      <Alert tone="error" title="Administrator access required">
        Your account does not have access to the admin portal.
      </Alert>
    );
  }
  return <>{children}</>;
}
