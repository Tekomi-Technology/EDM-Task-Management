import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { loadEnv } from '../src/config/env';
import { DB, type Db } from '../src/db/db.module';
import { seed } from '../src/db/seed';
import { SEED_API_KEYS, SEED_USERS } from '../src/db/seed-data';

type SeedUsername = (typeof SEED_USERS)[number]['username'];
/** A sample person, another EDM system (its sample API key), or any account by id. */
export type Caller = SeedUsername | 'call-center' | 'nms' | 'sales' | 'stock' | { userId: string };

const SYSTEM_OF = { 'call-center': 'call_center', nms: 'nms', sales: 'sales', stock: 'stock' } as const;

/** What the caller sends as "Authorization: Bearer …": an access token like /auth/sign-in gives, or an API key. */
export async function tokenFor(caller: Caller, opts: { expired?: boolean } = {}): Promise<string> {
  if (typeof caller === 'string' && caller in SYSTEM_OF) {
    return SEED_API_KEYS.find((k) => k.system === SYSTEM_OF[caller as keyof typeof SYSTEM_OF])!.key;
  }
  const userId =
    typeof caller === 'string' ? SEED_USERS.find((x) => x.username === caller)!.id : caller.userId;
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: randomUUID() })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('edm-tasks')
    .setSubject(userId)
    .setIssuedAt(opts.expired ? now - 3600 : now)
    .setExpirationTime(opts.expired ? now - 60 : now + 900)
    .sign(new TextEncoder().encode(loadEnv().AUTH_SECRET));
}

export interface TestContext {
  app: INestApplication;
  db: Db;
  as: (caller: Caller) => {
    get: (url: string) => Promise<request.Response>;
    post: (url: string, body?: object, headers?: Record<string, string>) => Promise<request.Response>;
    patch: (url: string, body?: object) => Promise<request.Response>;
    put: (url: string, body?: object) => Promise<request.Response>;
    delete: (url: string) => Promise<request.Response>;
  };
  anonymous: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, loadEnv());
  await app.init();
  const server = app.getHttpServer();
  const db = app.get<Db>(DB);
  return {
    app,
    db,
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
      delete: async (url) =>
        request(server)
          .delete(url)
          .set('Authorization', `Bearer ${await tokenFor(caller)}`),
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
    truncate sessions, api_keys, settings, ticket_events, staff_locations, integration_calls, user_notifications, attachments, notification_outbox, push_devices, alarms, help_messages,
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
