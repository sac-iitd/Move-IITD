import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@iitd-bus/shared';
import { ApiError, api, loginUrl, setCsrfToken } from '../api/client';

type User = MeResponse['user'];

interface AuthState {
  user: User | null;
  loading: boolean;
  /** True when the server reported an expired session (vs never signed in). */
  sessionExpired: boolean;
  error: ApiError | null;
  /** Phone from the user's last booking (form prefill). */
  lastPhone: string | null;
  /** Set while an admin has blocked this user from booking. */
  block: MeResponse['block'];
  /** Re-check the session (e.g. after the server was unreachable). */
  retry: () => void;
  login: (returnTo?: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const data = await api<MeResponse>('/auth/me');
        setCsrfToken(data.csrfToken);
        return { user: data.user, expired: false, lastPhone: data.lastPhone, block: data.block };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setCsrfToken(null);
          return {
            user: null,
            expired: err.code === 'SESSION_EXPIRED',
            lastPhone: null,
            block: null,
          };
        }
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const login = useCallback((returnTo?: string) => {
    window.location.assign(loginUrl(returnTo));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      // Drop the signed-in cache in place. queryClient.clear() detaches this
      // query and a later refetch paints the old name over a dead session.
      await qc.cancelQueries();
      qc.setQueryData(['me'], { user: null, expired: false, lastPhone: null, block: null });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    }
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user: me.data?.user ?? null,
      loading: me.isPending,
      sessionExpired: me.data?.expired ?? false,
      error: me.error instanceof ApiError ? me.error : null,
      lastPhone: me.data?.lastPhone ?? null,
      block: me.data?.block ?? null,
      retry: () => void me.refetch(),
      login,
      logout,
    }),
    [me, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
