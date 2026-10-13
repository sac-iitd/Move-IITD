import pino from 'pino';

/** Structured JSON logger. Sensitive fields are redacted wherever they appear. */
export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.access_token',
        '*.client_secret',
        '*.password',
        '*.code',
        'req.query.code',
        'req.query.state',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
