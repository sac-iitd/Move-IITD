import type { Session, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by the session middleware when a valid session cookie is present. */
      auth?: { user: User; session: Session };
      /** True when a session cookie was sent but is unknown or expired. */
      sessionExpired?: boolean;
    }
  }
}

export {};
