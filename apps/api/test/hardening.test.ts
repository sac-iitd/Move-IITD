import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, identity, signIn } from './app-helpers';
import { resetDb, testPrisma } from './helpers';

const db = testPrisma();
beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe('health and readiness', () => {
  it('reports health and DB readiness', async () => {
    const t = createTestApp();
    expect((await request(t.app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    expect((await request(t.app).get('/api/v1/ready')).body).toEqual({ status: 'ready' });
  });
});

describe('security headers and CORS', () => {
  it('sets a strict CSP and hardening headers on API responses', async () => {
    const t = createTestApp();
    const res = await request(t.app).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows CORS only for the configured web origin', async () => {
    const t = createTestApp();
    const ok = await request(t.app)
      .options('/api/v1/trips')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const bad = await request(t.app)
      .options('/api/v1/trips')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).not.toBe('https://evil.example');
  });
});

describe('error handling', () => {
  it('returns JSON 404s for unknown API routes', async () => {
    const t = createTestApp();
    const res = await request(t.app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed and oversized JSON without leaking internals', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    const bad = await s.agent
      .post('/api/v1/bookings/SNP-AAAA-BBBB/cancel')
      .set('X-CSRF-Token', s.csrf)
      .set('Content-Type', 'application/json')
      .send('{"reason":');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at \w+ \(|node_modules|prisma/i);
    const big = await s.agent
      .post('/api/v1/bookings/SNP-AAAA-BBBB/cancel')
      .set('X-CSRF-Token', s.csrf)
      .send({ reason: 'x'.repeat(50_000) });
    expect(big.status).toBe(413);
  });

  it('hides database errors behind a generic 500', async () => {
    const t = createTestApp();
    const s = await signIn(t, identity('u1'));
    const original = t.ctx.prisma.trip.findMany;
    t.ctx.prisma.trip.findMany = (() =>
      Promise.reject(new Error('SQLITE_ERROR: no such table secret_internal'))) as never;
    try {
      const res = await s.agent.get('/api/v1/trips');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' },
      });
    } finally {
      t.ctx.prisma.trip.findMany = original;
    }
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per IP', async () => {
    const t = createTestApp({ env: { RATE_LIMIT_ENABLED: 'true' } });
    let last = 0;
    for (let i = 0; i < 41; i++) last = (await request(t.app).get('/api/v1/auth/login')).status;
    expect(last).toBe(429);
  });
});

describe('serving the web build', () => {
  it('serves index.html for client routes with a self-only CSP, and assets with long caching', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bus-web-'));
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
    fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    try {
      const t = createTestApp({ env: { SERVE_WEB_DIR: dir } });
      const page = await request(t.app).get('/bookings/SNP-AAAA-BBBB');
      expect(page.status).toBe(200);
      expect(page.text).toContain('id="root"');
      expect(page.headers['content-security-policy']).toContain("script-src 'self'");
      expect(page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      const asset = await request(t.app).get('/assets/app-abc123.js');
      expect(asset.headers['cache-control']).toContain('immutable');
      // API routes are never swallowed by the SPA fallback
      expect((await request(t.app).get('/api/v1/nope')).status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
