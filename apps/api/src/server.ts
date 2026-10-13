import { createApp } from './app';
import { createAuthProvider } from './auth';
import { EnvValidationError, loadEnv } from './config/env';
import { createMailer } from './email/mailer';
import { configureDatabase, createPrisma } from './lib/db';
import { createLogger } from './lib/logger';
import type { AppContext } from './context';
import { startBackgroundJobs } from './jobs';

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const logger = createLogger(env.LOG_LEVEL);
  const prisma = createPrisma(env.DATABASE_URL);
  await prisma.$connect();
  await configureDatabase(prisma, env.DATABASE_URL);

  const ctx: AppContext = {
    env,
    prisma,
    logger,
    authProvider: createAuthProvider(env),
    mailer: createMailer(env),
    now: () => new Date(),
  };
  if (env.AUTH_PROVIDER === 'dev-mock') {
    logger.warn('Using the DEVELOPMENT-ONLY mock auth provider. Real KEBROS sign-in is disabled.');
  }

  const app = createApp(ctx);
  // Loopback only: Apache on this machine proxies /MoveIITD/api here.
  const server = app.listen(env.PORT, '127.0.0.1', () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, auth: env.AUTH_PROVIDER }, 'API listening');
  });
  const jobs = env.ENABLE_BACKGROUND_JOBS ? startBackgroundJobs(ctx) : undefined;

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    await jobs?.stop();
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
