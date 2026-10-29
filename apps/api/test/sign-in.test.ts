import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED_PASSWORD } from '../src/db/seed-data';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

/** Signing in without Keycloak: sessions, renewal, locking, temporary passwords, API keys, settings. */
describe('signing in', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  const server = () => request(t.app.getHttpServer());
  const signIn = (username: string, password: string, client: 'web' | 'app' = 'app') =>
    server().post('/api/auth/sign-in').send({ username, password, client });
  const sessionCookie = (res: request.Response) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('edm_session='));

  it('keeps the web app signed in with an httpOnly cookie that changes on each renewal', async () => {
    const res = await signIn('Helena.Mondlane', SEED_PASSWORD, 'web');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accessToken: expect.any(String), expiresIn: 900, mustChangePassword: false });
    const cookie = sessionCookie(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).toMatch(/SameSite=Strict/i);

    const me = await server().get('/api/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.body).toMatchObject({ username: 'helena.mondlane', roles: ['team_manager'] });

    const renewed = await server().post('/api/auth/refresh').set('Cookie', cookie.split(';')[0]!).send({});
    expect(renewed.status).toBe(200);
    expect(renewed.body.accessToken).toEqual(expect.any(String));
    expect(sessionCookie(renewed)).not.toEqual(cookie);
    // The old cookie no longer works once renewed.
    const again = await server().post('/api/auth/refresh').set('Cookie', cookie.split(';')[0]!).send({});
    expect(again.body.code).toBe('SESSION_ENDED');
  });

  it('gives the phone app its renewal token, and signing out ends the session', async () => {
    const res = await signIn('armando.cossa', SEED_PASSWORD);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(sessionCookie(res)).toBeUndefined();
    const renewed = await server().post('/api/auth/refresh').send({ refreshToken: res.body.refreshToken });
    expect(renewed.body.refreshToken).toEqual(expect.any(String));
    await server().post('/api/auth/sign-out').send({ refreshToken: renewed.body.refreshToken }).expect(204);
    const after = await server().post('/api/auth/refresh').send({ refreshToken: renewed.body.refreshToken });
    expect([after.status, after.body.code]).toEqual([401, 'SESSION_ENDED']);
  });

  it('answers the same for a wrong username or password, and locks after too many wrong passwords', async () => {
    const unknown = await signIn('nobody.here', SEED_PASSWORD);
    const wrong = await signIn('nadia.mussa', 'wrong-password-1');
    expect([unknown.status, unknown.body.code]).toEqual([401, 'INVALID_CREDENTIALS']);
    expect([wrong.status, wrong.body.code]).toEqual([401, 'INVALID_CREDENTIALS']);

    for (let i = 0; i < 3; i++) await signIn('nadia.mussa', 'wrong-password-1');
    const fifth = await signIn('nadia.mussa', 'wrong-password-1');
    expect([fifth.status, fifth.body.code]).toEqual([429, 'ACCOUNT_LOCKED']);
    // Locked even with the right password, until the time is up.
    expect((await signIn('nadia.mussa', SEED_PASSWORD)).body.code).toBe('ACCOUNT_LOCKED');
    // An administrator's new temporary password unlocks it.
    const reset = await t.as('admin.edm').post(`/api/admin/users/${ids['nadia.mussa']}/reset-password`);
    expect((await signIn('nadia.mussa', reset.body.temporaryPassword)).status).toBe(200);
  });

  it('makes a person with a temporary password choose their own before anything else', async () => {
    const temp = (await t.as('admin.edm').post(`/api/admin/users/${ids['ana.sitoe']}/reset-password`)).body
      .temporaryPassword as string;
    const res = await signIn('ana.sitoe', temp);
    expect(res.body.mustChangePassword).toBe(true);
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };

    expect((await server().get('/api/me').set(auth)).status).toBe(200);
    const blocked = await server().get('/api/me/jobs').set(auth);
    expect([blocked.status, blocked.body.code]).toEqual([403, 'PASSWORD_CHANGE_REQUIRED']);

    const change = (newPassword: string, currentPassword = temp) =>
      server().post('/api/auth/change-password').set(auth).send({ currentPassword, newPassword });
    expect((await change('short1')).body.code).toBe('WEAK_PASSWORD');
    expect((await change('onlyletters')).body.code).toBe('WEAK_PASSWORD');
    expect((await change('ana.sitoe2026')).body.code).toBe('WEAK_PASSWORD');
    expect((await change('Good-pass-2026', 'not-it')).body.code).toBe('WRONG_PASSWORD');
    expect((await change('Good-pass-2026')).status).toBe(204);

    expect((await server().get('/api/me/jobs').set(auth)).status).toBe(200);
    expect((await signIn('ana.sitoe', 'Good-pass-2026')).body.mustChangePassword).toBe(false);
  });

  it('lets administrators change the sign-in rules', async () => {
    expect((await t.as('carla.manhica').get('/api/admin/settings/sign-in')).status).toBe(403);
    expect((await t.as('admin.edm').get('/api/admin/settings/sign-in')).body).toEqual({
      minPasswordLength: 8,
      maxFailedSignIns: 5,
      lockMinutes: 15,
      webSessionDays: 7,
      appSessionDays: 30
    });
    const rules = {
      minPasswordLength: 10,
      maxFailedSignIns: 3,
      lockMinutes: 5,
      webSessionDays: 1,
      appSessionDays: 60
    };
    expect((await t.as('admin.edm').put('/api/admin/settings/sign-in', rules)).body).toEqual(rules);
    expect(
      (await t.as('admin.edm').put('/api/admin/settings/sign-in', { ...rules, minPasswordLength: 4 })).status
    ).toBe(400);

    for (let i = 0; i < 2; i++) await signIn('paulo.bo', 'wrong-password-1');
    expect((await signIn('paulo.bo', 'wrong-password-1')).body.code).toBe('ACCOUNT_LOCKED');
  });

  it('lets administrators make and revoke API keys for the other systems', async () => {
    expect((await t.as('carla.manhica').get('/api/admin/api-keys')).status).toBe(403);
    const made = await t
      .as('admin.edm')
      .post('/api/admin/api-keys', { system: 'nms', name: 'NMS production' });
    expect(made.status).toBe(201);
    expect(made.body.key).toMatch(/^edm_/);
    expect(made.body.apiKey).toMatchObject({
      system: 'nms',
      name: 'NMS production',
      prefix: made.body.key.slice(0, 12),
      createdByName: 'Admin EDM',
      revokedAt: null
    });
    // The list never shows a key again.
    const list = (await t.as('admin.edm').get('/api/admin/api-keys')).body;
    expect(JSON.stringify(list)).not.toContain(made.body.key);

    const send = () =>
      server()
        .post('/api/intake/nms/alarms')
        .set('Authorization', `Bearer ${made.body.key}`)
        .send({
          alarms: [
            {
              alarmId: 'K-1',
              event: 'raise',
              elementCode: 'F-12',
              alarmType: 'Breaker trip',
              severity: 'minor',
              occurredAt: new Date().toISOString()
            }
          ]
        });
    expect((await send()).status).toBe(200);
    expect((await t.as('admin.edm').post(`/api/admin/api-keys/${made.body.apiKey.id}/revoke`)).status).toBe(
      200
    );
    const after = await send();
    expect([after.status, after.body.code]).toEqual([401, 'UNAUTHENTICATED']);
  });
});
