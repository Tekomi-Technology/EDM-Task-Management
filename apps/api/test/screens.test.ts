import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { tickets, users } from '../src/db/schema';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

/** Data behind the web screens: ticket tabs and filters, Overview, Assign suggestions, notes and messages. */
describe('data for the web screens', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const onDuty = (who: 'ana.sitoe' | 'armando.cossa') =>
    t.db.update(users).set({ onDuty: true }).where(eq(users.id, ids[who]));
  beforeEach(() => resetData(t.db));

  async function complain(ref: string, contractNo = '40217735', problemType = 'no_power_single') {
    const res = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo,
      problemType,
      description: 'No power'
    });
    expect(res.status).toBe(201);
    return res.body.ticketId as string;
  }

  /** Four tickets in Matola (South 1) in different states, one in Maputo Central (South 2). */
  async function scenario() {
    const fresh = await complain('CC-1');
    const working = await complain('CC-2');
    const waiting = await complain('CC-3');
    const closed = await complain('CC-4');
    const other = await complain('CC-5', '40188210');
    const assign = (id: string) =>
      t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    for (const id of [working, waiting, closed]) {
      await assign(id);
      await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
      await t.as('armando.cossa').post(`/api/tickets/${id}/start`);
    }
    for (const id of [waiting, closed]) {
      await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, { note: 'Fixed the fuse' });
    }
    await t.as('call-center').post('/api/intake/call-center/tickets/CC-4/check-result', { result: 'fixed' });
    // Nobody was left to take these two (as when the whole team is away): they wait for someone.
    await t.db
      .update(tickets)
      .set({ status: 'new', assigneeId: null })
      .where(inArray(tickets.id, [fresh, other]));
    // The new ticket is already past its time limit.
    await t.db
      .update(tickets)
      .set({ dueAt: sql`now() - interval '10 minutes'` })
      .where(eq(tickets.id, fresh));
    return { fresh, working, waiting, closed, other };
  }

  const listIds = async (query: string, who: Parameters<TestContext['as']>[0] = 'nadia.mussa') => {
    const res = await t.as(who).get(`/api/tickets?${query}`);
    expect(res.status).toBe(200);
    return res.body.items.map((i: { id: string }) => i.id) as string[];
  };

  it('fills each tab with the right tickets, most urgent first, and counts them', async () => {
    const s = await scenario();
    const active = await listIds('');
    expect(active[0]).toBe(s.fresh); // late, so first
    expect(active).toHaveLength(4);
    expect(active).not.toContain(s.closed);
    expect(await listIds('view=unassigned')).toEqual(expect.arrayContaining([s.fresh, s.other]));
    expect(await listIds('view=late')).toEqual([s.fresh]);
    expect(await listIds('view=waiting_check')).toEqual([s.waiting]);
    expect(await listIds('view=closed_today')).toEqual([s.closed]);
    expect(await listIds('view=all')).toHaveLength(5);

    const counts = await t.as('nadia.mussa').get('/api/tickets/counts');
    expect(counts.body).toEqual({
      active: 4,
      unassigned: 2,
      late: 1,
      waiting_check: 1,
      closed_today: 1,
      incidents: 0,
      help: 0
    });
    const southTwo = await t.as('joao.matsinhe').get('/api/tickets/counts');
    expect(southTwo.body).toEqual({
      active: 1,
      unassigned: 1,
      late: 0,
      waiting_check: 0,
      closed_today: 0,
      incidents: 0,
      help: 0
    });
  });

  it('searches by code, customer, contract, phone or address, and filters by area and team', async () => {
    const s = await scenario();
    const lookups = (await t.as('nadia.mussa').get('/api/lookups')).body;
    const maputo = lookups.areas.find((a: { name: string }) => a.name === 'Maputo Central').id;
    const south1 = lookups.teams.find((x: { name: string }) => x.name === 'South 1').id;

    expect(await listIds('view=all&q=Manuel')).toEqual([s.other]);
    expect(await listIds('view=all&q=40188210')).toEqual([s.other]);
    expect(await listIds('view=all&q=kankhomba')).toEqual([s.other]);
    expect(await listIds('view=all&q=%2B258841110002')).toEqual([s.other]);
    const code = (await t.as('nadia.mussa').get(`/api/tickets/${s.working}`)).body.code;
    expect(await listIds(`view=all&q=${code}`)).toEqual([s.working]);
    expect(await listIds('view=all&q=50%25')).toEqual([]);
    expect(await listIds(`view=all&areaId=${maputo}`)).toEqual([s.other]);
    expect(await listIds(`view=all&teamId=${south1}`)).toHaveLength(4);
    expect(await listIds('view=all&source=sales')).toEqual([]);

    const row = (await t.as('nadia.mussa').get(`/api/tickets?view=all&q=Manuel`)).body.items[0];
    expect(row).toMatchObject({
      customerName: 'Manuel Sitoe',
      address: expect.stringContaining('Kankhomba')
    });
  });

  it('gives the Overview figures, the tickets needing attention and the map, within the caller’s scope', async () => {
    const s = await scenario();
    // Set directly: switching duty on in the app would also give out the waiting tickets.
    await onDuty('armando.cossa');
    const all = (await t.as('nadia.mussa').get('/api/overview')).body;
    expect(all).toMatchObject({
      open: 4,
      newToday: 5,
      beingFixed: 1,
      staffOnDuty: 1,
      waitingCheck: 1,
      waitingCallCenter: 1,
      late: 1
    });
    expect(all.attention[0].id).toBe(s.fresh);
    expect(all.attention.map((x: { id: string }) => x.id)).not.toContain(s.waiting);
    expect(all.unassigned.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([s.fresh, s.other])
    );
    expect(all.map).toHaveLength(4);
    expect(all.map.find((m: { id: string }) => m.id === s.fresh)).toMatchObject({
      late: true,
      lat: -25.93,
      lng: 32.47
    });

    const joao = (await t.as('joao.matsinhe').get('/api/overview')).body;
    expect(joao).toMatchObject({ open: 1, staffOnDuty: 0 });
    expect((await t.as('armando.cossa').get('/api/overview')).status).toBe(403);
  });

  it('suggests staff in the order automatic assignment would use, marking the best match', async () => {
    const south1 = (await t.as('nadia.mussa').get('/api/lookups')).body.teams.find(
      (x: { name: string }) => x.name === 'South 1'
    ).id;
    await scenario();
    await onDuty('ana.sitoe');
    await onDuty('armando.cossa');

    const res = await t.as('helena.mondlane').get(`/api/teams/${south1}/suggestions`);
    expect(
      res.body.map((x: { fullName: string; bestMatch: boolean; openJobs: number; doneToday: number }) => [
        x.fullName,
        x.bestMatch,
        x.openJobs,
        x.doneToday
      ])
    ).toEqual([
      ['Ana Sitoe', true, 0, 0],
      ['Armando Cossa', false, 1, 2]
    ]);
    expect((await t.as('joao.matsinhe').get(`/api/teams/${south1}/suggestions`)).status).toBe(403);
  });

  it('lets the office add a note, optionally sent to the staff member, and lists the messages sent', async () => {
    const s = await scenario();
    const quiet = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${s.working}/notes`, { text: 'Customer called again' });
    expect(quiet.status).toBe(200);
    const sent = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${s.working}/notes`, { text: 'Bring a ladder', notifyAssignee: true });
    const notes = sent.body.events.filter((e: { type: string }) => e.type === 'note');
    expect(notes.map((n: { data: object }) => n.data)).toEqual([
      { note: 'Customer called again', notified: false },
      { note: 'Bring a ladder', notified: true }
    ]);
    expect((await t.as('armando.cossa').post(`/api/tickets/${s.working}/notes`, { text: 'x' })).status).toBe(
      403
    );
    expect((await t.as('joao.matsinhe').post(`/api/tickets/${s.working}/notes`, { text: 'x' })).status).toBe(
      404
    );

    const messages = (await t.as('helena.mondlane').get(`/api/tickets/${s.working}/messages`)).body;
    expect(messages.map((m: { to: string }) => m.to)).toEqual([
      'Customer',
      'Armando Cossa (field staff)', // named by the manager (the team offer went through the app, not by SMS)
      'Customer',
      'Armando Cossa (field staff)'
    ]);
    expect(messages.at(-1).body).toContain('Bring a ladder');
  });

  it('tells the app how many jobs were done today and the team name, and remembers who has signed in', async () => {
    await scenario();
    expect((await t.as('armando.cossa').get('/api/me/today')).body).toEqual({ done: 2 });
    expect((await t.as('armando.cossa').get('/api/me')).body.teamName).toBe('South 1');
    const [ana] = await t.db.select().from(users).where(eq(users.id, ids['ana.sitoe']));
    expect(ana.lastSeenAt).toBeNull();
    const admin = (await t.as('admin.edm').get('/api/admin/users')).body;
    expect(admin.find((u: { username: string }) => u.username === 'armando.cossa').lastSeenAt).not.toBeNull();
  });
});
