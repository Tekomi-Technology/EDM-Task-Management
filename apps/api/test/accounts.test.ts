import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_PASSWORD } from '../src/db/seed-data';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

const newStaff = (overrides: object = {}) => ({
  username: 'Rui.Langa',
  fullName: 'Rui Langa',
  phone: '+258840000010',
  roles: ['field_staff'],
  ...overrides
});

describe('account management (Users & roles)', () => {
  let t: TestContext;
  let south1: string;
  let south2: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetData(t.db);
    const teams = (await t.as('admin.edm').get('/api/admin/teams')).body as { id: string; code: string }[];
    south1 = teams.find((x) => x.code === 'SOUTH_1')!.id;
    south2 = teams.find((x) => x.code === 'SOUTH_2')!.id;
  });

  const signIn = (username: string, password: string) =>
    t.anonymous().post('/api/auth/sign-in').send({ username, password, client: 'app' });

  it('is only open to admins', async () => {
    expect((await t.as('helena.mondlane').get('/api/admin/users')).status).toBe(403);
    expect((await t.as('call-center').get('/api/admin/users')).status).toBe(403);
    expect((await t.as('nadia.mussa').post('/api/admin/users', newStaff({ teamId: south1 }))).status).toBe(
      403
    );
  });

  it('lists people with their team and area, and filters them', async () => {
    const all = (await t.as('admin.edm').get('/api/admin/users')).body;
    expect(all).toHaveLength(10);
    expect(all.find((u: { username: string }) => u.username === 'ana.sitoe')).toMatchObject({
      teamName: 'South 1',
      areaName: 'Matola',
      status: 'active',
      roles: ['field_staff']
    });
    const staff = (await t.as('admin.edm').get('/api/admin/users?role=field_staff')).body;
    expect(staff.map((u: { username: string }) => u.username).sort()).toEqual([
      'ana.sitoe',
      'armando.cossa',
      'ofelia.tembe'
    ]);
    const found = (await t.as('admin.edm').get('/api/admin/users?search=SITOE')).body;
    expect(found.map((u: { fullName: string }) => u.fullName)).toEqual(['Ana Sitoe']);
    expect((await t.as('admin.edm').get('/api/admin/users?search=100%25')).body).toEqual([]);
  });

  it('creates an account with a one-time password the person must change', async () => {
    const res = await t.as('admin.edm').post('/api/admin/users', newStaff({ teamId: south1 }));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      username: 'rui.langa',
      fullName: 'Rui Langa',
      teamName: 'South 1',
      status: 'active',
      onDuty: false
    });
    expect(res.body.temporaryPassword).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z\d]{12}$/);

    const first = await signIn('rui.langa', res.body.temporaryPassword);
    expect(first.body).toMatchObject({ mustChangePassword: true });

    // The new person shows up for the manager to assign.
    const teamStaff = (await t.as('helena.mondlane').get(`/api/teams/${south1}/staff`)).body;
    expect(teamStaff.map((s: { fullName: string }) => s.fullName)).toContain('Rui Langa');
  });

  it('refuses duplicates, missing teams and bad usernames with clear codes', async () => {
    const dup = await t
      .as('admin.edm')
      .post('/api/admin/users', newStaff({ username: 'ana.sitoe', teamId: south1 }));
    expect([dup.status, dup.body.code]).toEqual([409, 'USERNAME_TAKEN']);
    const noTeam = await t.as('admin.edm').post('/api/admin/users', newStaff());
    expect([noTeam.status, noTeam.body.code]).toEqual([422, 'TEAM_REQUIRED']);
    const badTeam = await t
      .as('admin.edm')
      .post('/api/admin/users', newStaff({ teamId: '22222222-2222-4222-8222-222222222222' }));
    expect([badTeam.status, badTeam.body.code]).toEqual([422, 'TEAM_NOT_FOUND']);
    const badName = await t
      .as('admin.edm')
      .post('/api/admin/users', newStaff({ username: 'a b', teamId: south1 }));
    expect([badName.status, badName.body.code]).toEqual([400, 'VALIDATION_FAILED']);
    const noRoles = await t.as('admin.edm').post('/api/admin/users', newStaff({ roles: [], teamId: south1 }));
    expect(noRoles.status).toBe(400);
    const systemRole = await t
      .as('admin.edm')
      .post('/api/admin/users', newStaff({ roles: ['integration_call_center'] }));
    expect(systemRole.status).toBe(400);
  });

  it('changes team and roles; someone who is no longer field staff goes off duty', async () => {
    await t.as('ana.sitoe').post('/api/me/duty', { onDuty: true });
    const moved = await t.as('admin.edm').patch(`/api/admin/users/${ids['ana.sitoe']}`, { teamId: south2 });
    expect(moved.body).toMatchObject({ teamName: 'South 2', onDuty: true });

    const promoted = await t.as('admin.edm').patch(`/api/admin/users/${ids['ana.sitoe']}`, {
      roles: ['team_manager'],
      fullName: 'Ana Maria Sitoe'
    });
    expect(promoted.body).toMatchObject({
      roles: ['team_manager'],
      fullName: 'Ana Maria Sitoe',
      onDuty: false
    });
    // Applies at once, without signing the person out.
    expect((await t.as('ana.sitoe').get('/api/me')).body.roles).toEqual(['team_manager']);

    const noTeam = await t.as('admin.edm').patch(`/api/admin/users/${ids['ana.sitoe']}`, { teamId: null });
    expect(noTeam.body.code).toBe('TEAM_REQUIRED');
    const self = await t.as('admin.edm').patch(`/api/admin/users/${ids['admin.edm']}`, { roles: ['noc'] });
    expect([self.status, self.body.code]).toEqual([422, 'CANNOT_CHANGE_SELF']);
  });

  it('blocks a person at once, even with a token still valid, and unblocks them', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const phone = (await signIn('armando.cossa', SEED_PASSWORD)).body.refreshToken as string;
    const blocked = await t.as('admin.edm').post(`/api/admin/users/${ids['armando.cossa']}/block`);
    expect(blocked.body).toMatchObject({ status: 'blocked', onDuty: false });
    // Signed out everywhere, and cannot sign in again.
    expect((await t.anonymous().post('/api/auth/refresh').send({ refreshToken: phone })).body.code).toBe(
      'SESSION_ENDED'
    );
    expect((await signIn('armando.cossa', SEED_PASSWORD)).body.code).toBe('INVALID_CREDENTIALS');

    const me = await t.as('armando.cossa').get('/api/me');
    expect([me.status, me.body.code]).toEqual([403, 'ACCOUNT_DISABLED']);
    expect((await t.as('helena.mondlane').get(`/api/teams/${blocked.body.teamId}/staff`)).body).toHaveLength(
      1
    );

    expect((await t.as('admin.edm').post(`/api/admin/users/${ids['armando.cossa']}/block`)).status).toBe(409);
    const self = await t.as('admin.edm').post(`/api/admin/users/${ids['admin.edm']}/block`);
    expect(self.body.code).toBe('CANNOT_CHANGE_SELF');

    const unblocked = await t.as('admin.edm').post(`/api/admin/users/${ids['armando.cossa']}/unblock`);
    expect(unblocked.body.status).toBe('active');
    expect((await signIn('armando.cossa', SEED_PASSWORD)).status).toBe(200);
    expect((await t.as('armando.cossa').get('/api/me')).status).toBe(200);
  });

  it('cancels an account for good but keeps it for history', async () => {
    const res = await t.as('admin.edm').post(`/api/admin/users/${ids['ofelia.tembe']}/cancel`);
    expect(res.body.status).toBe('cancelled');
    expect((await signIn('ofelia.tembe', SEED_PASSWORD)).status).toBe(401);
    expect((await t.as('admin.edm').post(`/api/admin/users/${ids['ofelia.tembe']}/unblock`)).status).toBe(
      409
    );
    expect(
      (await t.as('admin.edm').patch(`/api/admin/users/${ids['ofelia.tembe']}`, { fullName: 'X Y' })).body
        .code
    ).toBe('ACCOUNT_CANCELLED');
    expect(
      (await t.as('admin.edm').post(`/api/admin/users/${ids['ofelia.tembe']}/reset-password`)).status
    ).toBe(409);
    expect((await t.as('admin.edm').get('/api/admin/users?status=cancelled')).body).toHaveLength(1);
  });

  it('resets a password to a new temporary one', async () => {
    const res = await t.as('admin.edm').post(`/api/admin/users/${ids['helena.mondlane']}/reset-password`);
    expect(res.status).toBe(200);
    expect((await signIn('helena.mondlane', SEED_PASSWORD)).status).toBe(401);
    expect((await signIn('helena.mondlane', res.body.temporaryPassword)).body.mustChangePassword).toBe(true);
    expect((await t.as('admin.edm').post('/api/admin/users/not-a-uuid/reset-password')).status).toBe(400);
    expect(
      (await t.as('admin.edm').post('/api/admin/users/22222222-2222-4222-8222-222222222222/reset-password'))
        .status
    ).toBe(404);
  });
});
