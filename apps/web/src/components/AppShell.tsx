import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { OfflineBanner } from './Feedback';

const logoSrc = `${import.meta.env.BASE_URL}sac-logo.png`;

/** Full load of the public page so no signed-in React state survives. */
function goToSignedOutPage() {
  const base = import.meta.env.BASE_URL || '/';
  window.location.assign(`${base.endsWith('/') ? base : `${base}/`}?signedOut=1`);
}

function NavItem({ to, children, end }: { to: string; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-400 text-ink-950' : 'text-brand-100 hover:bg-ink-700'
        }`
      }
    >
      {children}
    </NavLink>
  );
}

export function Header() {
  const { user, logout, login } = useAuth();
  const [open, setOpen] = useState(false);
  const signOut = async () => {
    await logout();
    goToSignedOutPage();
  };
  const isAdmin = user?.role === 'ADMIN';

  const nav = user && (
    <>
      <NavItem to="/dashboard">Book a bus</NavItem>
      <NavItem to="/bookings" end>
        My bookings
      </NavItem>
      {isAdmin && <NavItem to="/admin">Admin</NavItem>}
    </>
  );

  return (
    <header className="sticky top-0 z-40 bg-ink-900 text-brand-100 shadow">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <Link to={user ? '/dashboard' : '/'} className="flex items-center gap-3">
          <img src={logoSrc} alt="" className="h-11 w-11" width={44} height={44} />
          <span className="leading-tight">
            <span className="block text-sm font-bold text-brand-300 sm:text-base">MoveIITD</span>
            <span className="block text-[11px] text-brand-100/80">Student Affairs Council</span>
          </span>
        </Link>
        <nav aria-label="Main" className="ml-6 hidden items-center gap-1 md:flex">
          {nav}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          {user ? (
            <>
              <span
                className="max-w-48 truncate text-sm text-brand-100/90"
                title={user.email ?? undefined}
              >
                {user.name}
              </span>
              <button
                type="button"
                className="btn-gold min-h-9 px-3 py-1"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn-gold min-h-9 px-3 py-1" onClick={() => login()}>
              Sign in with KEBROS
            </button>
          )}
        </div>
        <button
          type="button"
          className="ml-auto inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-md hover:bg-ink-700 md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true" className="text-xl">
            {open ? '✕' : '☰'}
          </span>
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className="border-t border-ink-700 px-4 pb-4 md:hidden">
          <nav
            aria-label="Mobile"
            className="flex flex-col gap-1 pt-2"
            onClick={() => setOpen(false)}
          >
            {nav}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3">
            {user ? (
              <>
                <span className="truncate text-sm">{user.name}</span>
                <button
                  type="button"
                  className="btn-gold"
                  onClick={() => {
                    setOpen(false);
                    void signOut();
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button type="button" className="btn-gold w-full" onClick={() => login()}>
                Sign in with KEBROS
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <OfflineBanner />
      <Header />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-ink-900/10 bg-white/60">
        <div className="mx-auto max-w-6xl px-4 py-4 text-xs text-ink-800">
          IIT Delhi ↔ Sonipat campus shuttle · Monday to Friday · All times IST (Asia/Kolkata)
        </div>
      </footer>
    </div>
  );
}
