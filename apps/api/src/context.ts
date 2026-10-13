import type { PrismaClient } from '@prisma/client';
import type { Env } from './config/env';
import type { Logger } from './lib/logger';
import type { AuthProvider } from './auth/provider';
import type { Mailer } from './email/mailer';

/** Dependencies shared by routes and services; injected so tests can control time, auth and mail. */
export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  authProvider: AuthProvider;
  mailer: Mailer;
  /** Current time. Overridable in tests to exercise booking-window boundaries. */
  now: () => Date;
}
