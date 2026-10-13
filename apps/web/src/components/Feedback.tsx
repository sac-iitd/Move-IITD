import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const logoSrc = `${import.meta.env.BASE_URL}sac-logo.png`;

/** Full-page branded loader (session check, lazy-loaded admin pages). */
export function LoadingScreen({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fade-in flex min-h-[50vh] flex-col items-center justify-center gap-4"
    >
      <img src={logoSrc} alt="" className="logo-pulse h-20 w-20" width={80} height={80} />
      <p className="text-sm font-medium text-ink-800">{label}…</p>
    </div>
  );
}

/** Thin banner while the browser reports no network connection. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  if (!offline) return null;
  return (
    <div
      role="alert"
      className="no-print fade-in bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-ink-950"
    >
      You're offline. Bookings can't be made until your connection is back.
    </div>
  );
}

/** Shown when the API cannot be reached at all (server down, maintenance, network). */
export function ServerUnavailable({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div className="pop-in mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <img src={logoSrc} alt="" className="h-20 w-20 opacity-80" width={80} height={80} />
      <h1 className="text-xl font-bold">MoveIITD is unreachable</h1>
      <p className="text-sm text-ink-800">
        {message ?? 'We could not reach the server.'} Your existing bookings are safe.
      </p>
      <button type="button" className="btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="pop-in mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <img src={logoSrc} alt="" className="h-20 w-20" width={80} height={80} />
      <p className="text-5xl font-bold text-brand-500">404</p>
      <h1 className="text-xl font-bold">This page doesn't exist</h1>
      <p className="text-sm text-ink-800">The link may be old or mistyped.</p>
      <div className="flex gap-2">
        <Link to="/dashboard" className="btn-primary">
          Find a bus
        </Link>
        <Link to="/" className="btn-secondary">
          Home
        </Link>
      </div>
    </div>
  );
}
