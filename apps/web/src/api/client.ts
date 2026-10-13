import type { ApiErrorBody, ErrorCode } from '@iitd-bus/shared';

/** Same-origin API base. In dev, Vite proxies /api to the Express server. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '/api/v1';

const REQUEST_TIMEOUT_MS = 20_000;

let csrfToken: string | null = null;

/** Set from GET /auth/me; required on every state-changing request. */
export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  // Abort slow requests so the UI can offer a retry instead of spinning forever.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (timeout.aborted) {
      throw new ApiError(
        0,
        'NETWORK',
        'The server is taking too long to respond. Please try again.',
      );
    }
    if (opts.signal?.aborted) throw err;
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw new ApiError(
      0,
      'NETWORK',
      offline
        ? 'You appear to be offline. Reconnect and try again.'
        : 'Could not reach the server. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (data as ApiErrorBody | undefined)?.error;
    const fallback =
      res.status === 502 || res.status === 503 || res.status === 504
        ? 'MoveIITD is temporarily unavailable (maintenance or restart). Please try again in a minute.'
        : res.status >= 500
          ? 'Something went wrong on our side. Please try again.'
          : `Request failed (${res.status})`;
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? fallback, err?.details);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Full-page navigation to begin KEBROS sign-in (server sets the state cookie and redirects). */
export function loginUrl(returnTo = '/dashboard'): string {
  return `${API_BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
