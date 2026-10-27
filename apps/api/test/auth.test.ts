import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { users } from '../src/db/schema';
import { createTestApp, resetData, tokenFor, type TestContext } from './helpers';

describe('health and sign-in', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  it('reports every dependency as up without a token', async () => {
    const res = await t.anonymous().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok', storage: 'ok' } });
  });

  it('rejects requests without a token', async () => {
    const res = await t.anonymous().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.body.requestId).toBeTruthy();
  });

  it('tells the client when the token has expired', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/me')
      .set('Authorization', `Bearer ${await tokenFor('armando.cossa', { expired: true })}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token signed by someone else', async () => {
    const forged = (await tokenFor('admin.edm')).replace(/\.[^.]+$/, '.invalidsignature');
    const res = await request(t.app.getHttpServer()).get('/api/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user with team and roles', async () => {
    const res = await t.as('helena.mondlane').get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      username: 'helena.mondlane',
      fullName: 'Helena Mondlane',
      roles: ['team_manager']
    });
    expect(res.body.teamId).toBeTruthy();
  });

  it('creates a user row the first time a new Keycloak account signs in', async () => {
    const res = await t.as('stranger').get('/api/me');
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(users).where(eq(users.username, 'new.person'));
    expect(row).toMatchObject({ fullName: 'New Person', roles: ['bo_support'], teamId: null });
  });

  it('keeps people out of routes for other roles', async () => {
    const res = await t.as('armando.cossa').post('/api/intake/call-center/complaints', {});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN_ROLE');
  });
});
