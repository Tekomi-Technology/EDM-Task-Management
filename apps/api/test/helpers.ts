import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import request from 'supertest';
import { IdentityAdmin } from '../src/admin/identity-admin';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { JWKS } from '../src/auth/jwks';
import { loadEnv } from '../src/config/env';
import { DB, type Db } from '../src/db/db.module';
import { seed } from '../src/db/seed';
import { SEED_USERS } from '../src/db/seed-data';
import { FakeIdentityAdmin } from './fake-identity';

type SeedUsername = (typeof SEED_USERS)[number]['username'];
/** "stranger": a new BO account signing in for the first time; "nobody": a Keycloak account with no role here. */
export type Caller = SeedUsername | 'call-center' | 'nms' | 'sales' | 'stock' | 'stranger' | 'nobody';

const keys = generateKeyPair('RS256');
let jwk: JWK | undefined;

async function signingKey() {
  const pair = await keys;
  if (!jwk) jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256' };
  return pair.privateKey;
}

/** A token shaped like the ones Keycloak issues for the realm `edm`. */
export async function tokenFor(caller: Caller, opts: { expired?: boolean } = {}): Promise<string> {
  const key = await signingKey();
  let claims: Record<string, unknown>;
  let sub: string;
  if (caller === 'call-center') {
    sub = 'service-account-call-center';
    claims = {
      preferred_username: 'service-account-call-center-system',
      azp: 'call-center-system',
      realm_access: { roles: ['integration_call_center'] }
    };
  } else if (caller === 'nms') {
    sub = 'service-account-nms';
    claims = {
      preferred_username: 'service-account-nms-system',
      azp: 'nms-system',
      realm_access: { roles: ['integration_nms'] }
    };
  } else if (caller === 'sales' || caller === 'stock') {
    sub = `service-account-${caller}`;
    claims = {
      preferred_username: `service-account-${caller}-system`,
      azp: `${caller}-system`,
      realm_access: { roles: [`integration_${caller}`] }
    };
  } else if (caller === 'nobody') {
    sub = '22222222-2222-4222-8222-222222222222';
    claims = {
      preferred_username: 'no.role',
      realm_access: { roles: ['offline_access', 'uma_authorization'] }
    };
  } else if (caller === 'stranger') {
    sub = '11111111-1111-4111-8111-111111111111';
    claims = {
      preferred_username: 'new.person',
      given_name: 'New',
      family_name: 'Person',
      realm_access: { roles: ['bo_support'] }
    };
  } else {
    const u = SEED_USERS.find((x) => x.username === caller)!;
    sub = u.id;
    const [given, ...family] = u.fullName.split(' ');
    claims = {
      preferred_username: u.username,
      given_name: given,
      family_name: family.join(' '),
      realm_access: { roles: [...u.roles] }
    };
  }
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('http://keycloak.test/realms/edm')
    .setAudience('edm-api')
    .setSubject(sub)
    .setIssuedAt(opts.expired ? now - 3600 : now)
    .setExpirationTime(opts.expired ? now - 60 : now + 900)
    .sign(key);
}

export interface TestContext {
  app: INestApplication;
  db: Db;
  identity: FakeIdentityAdmin;
  as: (caller: Caller) => {
    get: (url: string) => Promise<request.Response>;
    post: (url: string, body?: object, headers?: Record<string, string>) => Promise<request.Response>;
    patch: (url: string, body?: object) => Promise<request.Response>;
    put: (url: string, body?: object) => Promise<request.Response>;
  };
  anonymous: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  await signingKey();
  const identity = new FakeIdentityAdmin();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(JWKS)
    .useValue(createLocalJWKSet({ keys: [jwk!] }))
    .overrideProvider(IdentityAdmin)
    .useValue(identity)
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  const server = app.getHttpServer();
  const db = app.get<Db>(DB);
  return {
    app,
    db,
    identity,
    as: (caller) => ({
      get: async (url) =>
        request(server)
          .get(url)
          .set('Authorization', `Bearer ${await tokenFor(caller)}`),
      post: async (url, body, headers = {}) =>
        request(server)
          .post(url)
          .set({ ...headers, Authorization: `Bearer ${await tokenFor(caller)}` })
          .send(body ?? {}),
      put: async (url, body) =>
        request(server)
          .put(url)
          .set('Authorization', `Bearer ${await tokenFor(caller)}`)
          .send(body ?? {}),
      patch: async (url, body) =>
        request(server)
          .patch(url)
          .set('Authorization', `Bearer ${await tokenFor(caller)}`)
          .send(body ?? {})
    }),
    anonymous: () => request(server),
    close: () => app.close()
  };
}

/** Empties all tables and loads the sample data again; also clears queued jobs. */
export async function resetData(db: Db): Promise<void> {
  await db.execute(sql`
    truncate ticket_events, staff_locations, integration_calls, user_notifications, attachments, notification_outbox, push_devices, alarms, help_messages,
      help_requests, handover_codes, ticket_materials, stock_reservations, stock_movements, vehicles, stock_locations,
      stock_items, tickets, ticket_counters, customers, users, teams, areas restart identity cascade`);
  await seed(db);
  const redis = new IORedis(loadEnv().REDIS_URL);
  await redis.flushdb();
  await redis.quit();
}

export async function waitFor<T>(
  fn: () => Promise<T>,
  done: (v: T) => boolean,
  timeoutMs = 10_000
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (done(value)) return value;
    if (Date.now() - start > timeoutMs) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
}

export const ids = Object.fromEntries(SEED_USERS.map((u) => [u.username, u.id])) as Record<
  SeedUsername,
  string
>;
