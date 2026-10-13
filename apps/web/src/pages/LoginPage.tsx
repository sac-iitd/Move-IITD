import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Spinner } from '../components/ui';
import { LOGIN_ERRORS } from '../lib/format';

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [params] = useSearchParams();
  const returnTo = params.get('returnTo') ?? '/dashboard';
  const error = params.get('error');
  const expired = params.has('expired');

  if (loading) {
    return (
      <div className="py-12 text-center">
        <Spinner label="Checking your session" />
      </div>
    );
  }
  if (user && !error)
    return <Navigate to={returnTo.startsWith('/') ? returnTo : '/dashboard'} replace />;

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {error && (
        <Alert tone="error" title="Sign-in failed">
          {LOGIN_ERRORS[error] ?? 'Sign-in failed. Please try again.'}
        </Alert>
      )}
      {expired && !error && (
        <Alert tone="warning" title="Session expired">
          Please sign in again to continue.
        </Alert>
      )}
      <div className="card space-y-4 p-6">
        <p className="text-sm">
          Use your IIT Delhi Kerberos account. You'll be sent to the institute sign-in page
          and brought back here afterwards.
        </p>
        <button
          type="button"
          className="btn-primary w-full text-base"
          onClick={() => login(returnTo)}
        >
          Sign in with Kerberos
        </button>
      </div>
    </div>
  );
}
