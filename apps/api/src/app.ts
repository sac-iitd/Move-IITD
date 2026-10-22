import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { errorHandler, notFoundHandler } from './lib/errors';
import { configureIdCipher } from './lib/id-cipher';
import { csrfProtection, sessionMiddleware } from './auth/middleware';
import { apiRateLimit } from './lib/rate-limit';
import { authRouter } from './routes/auth';
import { bookingsRouter } from './routes/bookings';
import { tripsRouter } from './routes/trips';
import { scheduleRouter } from './routes/schedule';
import { adminRouter } from './routes/admin';
import { boardingRouter } from './routes/boarding';

export function createApp(ctx: AppContext) {
  configureIdCipher(ctx.env);
  const app = express();
  app.disable('x-powered-by');
  if (ctx.env.TRUST_PROXY > 0) app.set('trust proxy', ctx.env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger: ctx.logger,
      autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      customProps: () => ({}),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: (req.url as string).split('?')[0] }),
      },
    }),
  );

  // Works whether the reverse proxy strips the sub-path (/MoveIITD/x -> /x) or forwards it as-is.
  const base = ctx.env.APP_BASE_PATH;
  if (base) {
    app.use((req, _res, next) => {
      if (req.url === base || req.url.startsWith(`${base}/`) || req.url.startsWith(`${base}?`)) {
        req.url = req.url.slice(base.length) || '/';
      }
      next();
    });
  }

  // The redirect URI registered with IIT Delhi OAuth is /api/auth/iitd/callback; route it to the v1 handler.
  app.use((req, _res, next) => {
    if (req.path === '/api/auth/iitd/callback') {
      req.url = req.url.replace('/api/auth/iitd/callback', '/api/v1/auth/callback');
    }
    next();
  });

  // API responses are JSON only, so the API CSP is maximally strict.
  app.use(
    '/api',
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(
    '/api',
    cors({
      origin: ctx.env.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'],
    }),
  );
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/v1/ready', async (_req, res) => {
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const v1 = express.Router();
  v1.use(apiRateLimit(ctx));
  v1.use(sessionMiddleware(ctx));
  v1.use(csrfProtection(ctx));
  v1.use('/auth', authRouter(ctx));
  v1.use('/schedule', scheduleRouter(ctx));
  v1.use('/trips', tripsRouter(ctx));
  v1.use('/bookings', bookingsRouter(ctx));
  v1.use('/boarding', boardingRouter(ctx));
  v1.use('/admin', adminRouter(ctx));
  app.use('/api/v1', v1);

  app.use('/api', notFoundHandler);

  // Optional: serve the built SPA from this process (same origin as the API).
  if (ctx.env.SERVE_WEB_DIR) {
    const webDir = path.resolve(ctx.env.SERVE_WEB_DIR);
    const indexHtml = path.join(webDir, 'index.html');
    if (!fs.existsSync(indexHtml)) throw new Error(`SERVE_WEB_DIR has no index.html: ${webDir}`);
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
          },
        },
      }),
    );
    app.use(
      express.static(webDir, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          // Vite fingerprints assets, so they can be cached for a long time.
          if (file.includes(`${path.sep}assets${path.sep}`))
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
