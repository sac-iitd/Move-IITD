import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_MESSAGES, type ApiErrorBody, type ErrorCode } from '@iitd-bus/shared';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  CSRF_INVALID: 403,
  NOT_ELIGIBLE: 403,
  USER_BLOCKED: 403,
  SEAT_LIMIT: 409,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  TRIP_NOT_OPERATIONAL: 409,
  BOOKING_NOT_OPEN: 409,
  BOOKING_CLOSED: 409,
  TRIP_FULL: 409,
  TRIP_CANCELLED: 409,
  TRIP_DEPARTED: 409,
  ALREADY_BOOKED: 409,
  CANCELLATION_CLOSED: 409,
  BOOKING_ALREADY_CANCELLED: 409,
  CAPACITY_BELOW_BOOKED: 409,
  CONFLICT: 409,
  INTERNAL: 500,
};

export class HttpError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? ERROR_MESSAGES[code] ?? code);
    this.status = STATUS_BY_CODE[code];
  }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Not found' } };
  res.status(404).json(body);
};

/** Converts thrown errors to the consistent `{ error: { code, message } }` shape. Never leaks internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let body: ApiErrorBody;
  let status: number;
  if (err instanceof HttpError) {
    status = err.status;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err instanceof ZodError) {
    status = 400;
    body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    };
  } else if (
    err &&
    typeof err === 'object' &&
    'type' in err &&
    err.type === 'entity.parse.failed'
  ) {
    status = 400;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } };
  } else if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.too.large') {
    status = 413;
    body = { error: { code: 'VALIDATION_ERROR', message: 'Request body too large' } };
  } else {
    status = 500;
    req.log?.error({ err }, 'Unhandled error');
    body = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  }
  if (res.headersSent) return;
  res.status(status).json(body);
};
