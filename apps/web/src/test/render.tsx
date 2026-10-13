import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../auth/AuthContext';

export function renderWithProviders(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>{ui}</AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (url: string, init: RequestInit) => { status?: number; body?: unknown };

/** Routes fetch calls to handlers keyed by "METHOD /path" (path without the /api/v1 prefix or query). */
export function mockFetch(handlers: Record<string, Handler>) {
  const calls: { key: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.replace(/^\/api\/v1/, '').split('?')[0];
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ key, init });
    const handler = handlers[key];
    if (!handler)
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'nf' } }), {
        status: 404,
      });
    const { status = 200, body } = handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

export const meResponse = {
  user: {
    id: 'u1',
    name: 'Asha Kumar',
    email: 'asha@iitd.ac.in',
    role: 'USER',
    category: 'student',
  },
  csrfToken: 'csrf-token-abc',
  lastPhone: '9876543210',
  block: null,
};
