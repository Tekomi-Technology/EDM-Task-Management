import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from '../src/config/env';
import { createTestApp, tokenFor, type Caller, type TestContext } from './helpers';

const ANY_ID = '00000000-0000-4000-8000-0000000000aa';
/** Routes anyone may call: the health check (load balancers) and the API description. */
const PUBLIC = ['GET /api/health'];

/** Checks that hold for every route, read from the API description so a new route cannot be forgotten. */
describe('security of every route', () => {
  let t: TestContext;
  let routes: { method: string; path: string }[];
  beforeAll(async () => {
    t = await createTestApp();
    const doc = SwaggerModule.createDocument(t.app, new DocumentBuilder().build());
    routes = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
        .map((method) => ({ method, path: path.replace(/\{[^}]+\}/g, ANY_ID) }))
    );
  });
  afterAll(() => t.close());

  const send = (method: string, path: string, token?: string) => {
    const req = (t.anonymous() as unknown as Record<string, (p: string) => import('supertest').Test>)[
      method
    ]!(path);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('finds the routes to check', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('refuses every route without a valid token, except the public ones', async () => {
    const expired = await tokenFor('admin.edm', { expired: true });
    const open: string[] = [];
    for (const r of routes) {
      const name = `${r.method.toUpperCase()} ${r.path}`;
      if (PUBLIC.includes(name)) continue;
      const [none, old, forged] = await Promise.all([
        send(r.method, r.path),
        send(r.method, r.path, expired),
        send(r.method, r.path, `${expired.slice(0, -10)}AAAAAAAAAA`)
      ]);
      for (const res of [none, old, forged]) if (res.status !== 401) open.push(`${name} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it('refuses a signed-in person with no role on every route', async () => {
    const nobody = await tokenFor('nobody');
    const allowed: string[] = [];
    for (const r of routes) {
      const name = `${r.method.toUpperCase()} ${r.path}`;
      if (PUBLIC.includes(name)) continue;
      const res = await send(r.method, r.path, nobody);
      if (res.status !== 403) allowed.push(`${name} → ${res.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it('lets each other system reach only its own /intake routes', async () => {
    const own: Record<string, string> = {
      'call-center': '/api/intake/call-center/',
      nms: '/api/intake/nms/',
      sales: '/api/intake/sales/',
      stock: '/api/intake/stock/'
    };
    const wrong: string[] = [];
    for (const [caller, prefix] of Object.entries(own)) {
      const token = await tokenFor(caller as Caller);
      for (const r of routes) {
        const name = `${r.method.toUpperCase()} ${r.path}`;
        if (PUBLIC.includes(name)) continue;
        const res = await send(r.method, r.path, token);
        const mine = r.path.startsWith(prefix);
        if (mine ? res.status === 401 || res.status === 403 : res.status !== 403) {
          wrong.push(`${caller}: ${name} → ${res.status}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('sends headers that stop sniffing, framing and caching, and does not say what it runs on', async () => {
    const res = await t.anonymous().get('/api/health');
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store'
    });
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('only lets the web app’s own address read answers from a browser', async () => {
    const allowed = loadEnv().CORS_ORIGINS.split(',')[0]!.trim();
    const ok = await t
      .anonymous()
      .options('/api/me')
      .set('Origin', allowed)
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(allowed);
    const evil = await t
      .anonymous()
      .options('/api/me')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses request bodies over 100 KB before reading them (no huge arrays to validate)', async () => {
    const alarms = Array.from({ length: 2000 }, (_, i) => ({ alarmId: `A-${i}`, padding: 'x'.repeat(60) }));
    const res = await t
      .anonymous()
      .post('/api/intake/nms/alarms')
      .set('Authorization', `Bearer ${await tokenFor('nms')}`)
      .send({ alarms });
    expect(res.body).toMatchObject({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
    const broken = await t
      .anonymous()
      .post('/api/intake/nms/alarms')
      .set('Authorization', `Bearer ${await tokenFor('nms')}`)
      .set('Content-Type', 'application/json')
      .send('{"alarms": [');
    expect(broken.status).toBe(400);
  });

  it('does not leak internals in errors', async () => {
    const res = await t.as('admin.edm').get('/api/tickets/not-a-uuid');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|at .*\.ts/);
  });
});
