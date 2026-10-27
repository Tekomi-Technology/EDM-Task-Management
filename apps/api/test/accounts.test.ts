import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../src/db/schema';
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
    t.identity.reset();
    const teams = (await t.as('admin.edm').get('/api/admin/teams')).body as { id: string; code: string }[];
    south1 = teams.find((x) => x.code === 'SOUTH_1')!.id;
    south2 = teams.find((x) => x.code === 'SOUTH_2')!.id;
  });

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

    const account = [...t.identity.accounts.values()].find((a) => a.username === 'rui.langa')!;
    expect(account).toMatchObject({
      firstName: 'Rui',
      lastName: 'Langa',
      roles: ['field_staff'],
      password: { value: res.body.temporaryPassword, temporary: true }
    });
    const [row] = await t.db.select().from(users).where(eq(users.username, 'rui.langa'));
    expect(row.keycloakSub).toBe(account.id);

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

  it('leaves nothing behind when the sign-in server fails half-way', async () => {
    t.identity.failNext = 'setRoles';
    const res = await t.as('admin.edm').post('/api/admin/users', newStaff({ teamId: south1 }));
    expect(res.status).toBe(502);
    expect([...t.identity.accounts.values()].some((a) => a.username === 'rui.langa')).toBe(false);
    expect(await t.db.select().from(users).where(eq(users.username, 'rui.langa'))).toEqual([]);
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
    expect(t.identity.accounts.get(ids['ana.sitoe'])).toMatchObject({
      roles: ['team_manager'],
      logouts: 1,
      firstName: 'Ana Maria',
      lastName: 'Sitoe'
    });

    const noTeam = await t.as('admin.edm').patch(`/api/admin/users/${ids['ana.sitoe']}`, { teamId: null });
    expect(noTeam.body.code).toBe('TEAM_REQUIRED');
    const self = await t.as('admin.edm').patch(`/api/admin/users/${ids['admin.edm']}`, { roles: ['noc'] });
    expect([self.status, self.body.code]).toEqual([422, 'CANNOT_CHANGE_SELF']);
  });

  it('blocks a person at once, even with a token still valid, and unblocks them', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const blocked = await t.as('admin.edm').post(`/api/admin/users/${ids['armando.cossa']}/block`);
    expect(blocked.body).toMatchObject({ status: 'blocked', onDuty: false });
    expect(t.identity.accounts.get(ids['armando.cossa'])).toMatchObject({ enabled: false, logouts: 1 });

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
    expect(t.identity.accounts.get(ids['armando.cossa'])!.enabled).toBe(true);
    expect((await t.as('armando.cossa').get('/api/me')).status).toBe(200);
  });

  it('cancels an account for good but keeps it for history', async () => {
    const res = await t.as('admin.edm').post(`/api/admin/users/${ids['ofelia.tembe']}/cancel`);
    expect(res.body.status).toBe('cancelled');
    expect(t.identity.accounts.get(ids['ofelia.tembe'])!.enabled).toBe(false);
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
    expect(t.identity.accounts.get(ids['helena.mondlane'])!.password).toEqual({
      value: res.body.temporaryPassword,
      temporary: true
    });
    expect((await t.as('admin.edm').post('/api/admin/users/not-a-uuid/reset-password')).status).toBe(400);
    expect(
      (await t.as('admin.edm').post('/api/admin/users/22222222-2222-4222-8222-222222222222/reset-password'))
        .status
    ).toBe(404);
  });
});
