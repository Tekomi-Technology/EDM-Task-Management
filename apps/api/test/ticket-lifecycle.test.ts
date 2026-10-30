import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { notificationOutbox, pushDevices, tickets, users } from '../src/db/schema';
import { TicketsService } from '../src/tickets/tickets.service';
import { createTestApp, ids, resetData, type Caller, type TestContext } from './helpers';

const complaint = (ref: string, contractNo = '40217735') => ({
  externalRef: ref,
  contractNo,
  problemType: 'no_power_single',
  description: 'House without power since the morning'
});

const PHONES = {
  helena: '+258840000002',
  armando: '+258840000006',
  ana: '+258840000009'
};

describe('full ticket lifecycle: offered to the team, claimed, given back, paused, cancelled', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  async function onDuty(who: Caller, value = true) {
    const res = await t.as(who).post('/api/me/duty', { onDuty: value });
    expect(res.status).toBe(200);
  }

  const block = (who: 'ana.sitoe' | 'armando.cossa') =>
    t.db.update(users).set({ status: 'blocked' }).where(eq(users.id, ids[who]));

  async function complain(ref: string, contractNo?: string) {
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/complaints', complaint(ref, contractNo));
    expect(res.status).toBe(201);
    return res.body as { ticketId: string; code: string; status: string; assigneeName: string | null };
  }

  async function register(who: 'armando.cossa' | 'ana.sitoe') {
    const res = await t
      .as(who)
      .post('/api/me/devices', { token: `ExponentPushToken[${who}]`, platform: 'android' });
    expect(res.status).toBe(204);
  }

  async function pushTitles(who: 'armando.cossa' | 'ana.sitoe'): Promise<string[]> {
    const rows = await t.db
      .select({ payload: notificationOutbox.payload })
      .from(notificationOutbox)
      .innerJoin(pushDevices, eq(pushDevices.token, notificationOutbox.recipient))
      .where(and(eq(notificationOutbox.channel, 'push'), eq(pushDevices.userId, ids[who])))
      .orderBy(notificationOutbox.createdAt);
    return rows.map((r) => r.payload!.title);
  }

  async function smsTo(phone: string): Promise<string[]> {
    const rows = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone));
    return rows.map((r) => r.body);
  }

  async function detail(id: string, who: Caller = 'admin.edm') {
    return (await t.as(who).get(`/api/tickets/${id}`)).body;
  }

  it('lets field staff switch duty on and off, and shows it in /me', async () => {
    expect((await t.as('armando.cossa').get('/api/me')).body.onDuty).toBe(false);
    const res = await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    expect(res.body.onDuty).toBe(true);
    expect((await t.as('armando.cossa').get('/api/me')).body.onDuty).toBe(true);
    expect((await t.as('helena.mondlane').post('/api/me/duty', { onDuty: true })).status).toBe(403);
    expect((await t.as('armando.cossa').post('/api/me/duty', { onDuty: 'yes' })).status).toBe(400);
  });

  it('offers a new ticket to the whole team through the app, on duty or not, without bothering the manager', async () => {
    await register('armando.cossa');
    await onDuty('ofelia.tembe'); // on duty, but in the other team
    const ticket = await complain('CC-A1');
    expect(ticket).toMatchObject({ status: 'new', assigneeName: null });

    const history = (await detail(ticket.ticketId)).events;
    expect(history.at(-1)).toMatchObject({
      type: 'offered',
      actorName: 'System',
      data: { notified: ['Ana Sitoe', 'Armando Cossa'], round: 1, teamName: 'South 1' }
    });
    // App only: Armando has it installed and gets a push; Ana does not, and gets no SMS either.
    expect(await pushTitles('armando.cossa')).toEqual(['Novo trabalho para a equipa']);
    expect(await smsTo(PHONES.ana)).toEqual([]);
    expect(await smsTo(PHONES.helena)).toEqual([]);

    const offers = (await t.as('ana.sitoe').get('/api/me/offers')).body;
    expect(offers).toEqual([
      expect.objectContaining({
        id: ticket.ticketId,
        code: ticket.code,
        offer: expect.objectContaining({ notified: ['Ana Sitoe', 'Armando Cossa'], round: 1 })
      })
    ]);
    expect((await t.as('ofelia.tembe').get('/api/me/offers')).body).toEqual([]);
    // Staff of the team may open the offered job before claiming it, and see that they can claim it.
    expect((await t.as('ana.sitoe').get(`/api/tickets/${ticket.ticketId}`)).body).toMatchObject({
      allowedActions: ['claim'],
      offer: { round: 1 }
    });
    expect((await t.as('ofelia.tembe').get(`/api/tickets/${ticket.ticketId}`)).status).toBe(404);
  });

  it('gives the job to whoever claims it first; it leaves everyone else’s list', async () => {
    const { ticketId, code } = await complain('CC-B1');
    expect((await t.as('helena.mondlane').post(`/api/tickets/${ticketId}/claim`)).status).toBe(403);
    const otherTeam = await t.as('ofelia.tembe').post(`/api/tickets/${ticketId}/claim`);
    expect([otherTeam.status, otherTeam.body.code]).toEqual([403, 'NOT_IN_TEAM']);

    const claimed = await t.as('ana.sitoe').post(`/api/tickets/${ticketId}/claim`);
    expect(claimed.status).toBe(200);
    expect(claimed.body).toMatchObject({
      status: 'accepted',
      assignee: { fullName: 'Ana Sitoe' },
      offer: null
    });
    expect(claimed.body.allowedActions).toEqual(expect.arrayContaining(['start', 'decline']));
    expect(claimed.body.events.at(-1)).toMatchObject({
      type: 'claim',
      actorName: 'Ana Sitoe',
      data: { from: 'new', to: 'accepted', assigneeName: 'Ana Sitoe' }
    });

    const late = await t.as('armando.cossa').post(`/api/tickets/${ticketId}/claim`);
    expect([late.status, late.body.code]).toEqual([409, 'ALREADY_TAKEN']);
    expect((await t.as('armando.cossa').get('/api/me/offers')).body).toEqual([]);
    expect((await t.as('ana.sitoe').get('/api/me/jobs')).body.map((j: { code: string }) => j.code)).toEqual([
      code
    ]);
  });

  it('lets only one of two people claiming at the same moment have the job', async () => {
    const { ticketId } = await complain('CC-B2');
    const both = await Promise.all([
      t.as('ana.sitoe').post(`/api/tickets/${ticketId}/claim`),
      t.as('armando.cossa').post(`/api/tickets/${ticketId}/claim`)
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.status === 409)!.body.code).toBe('ALREADY_TAKEN');
    const claims = (await detail(ticketId)).events.filter((e: { type: string }) => e.type === 'claim');
    expect(claims).toHaveLength(1);
  });

  it('does not offer jobs to blocked staff, and leaves the ticket for the manager when nobody is left', async () => {
    await block('armando.cossa');
    const first = await complain('CC-B3');
    expect((await detail(first.ticketId)).offer).toMatchObject({ notified: ['Ana Sitoe'] });
    await block('ana.sitoe');
    const second = await complain('CC-B4');
    const d = await detail(second.ticketId);
    expect(d).toMatchObject({ status: 'new', offer: null });
    expect(d.events.map((e: { type: string }) => e.type)).not.toContain('offered');
    expect(await smsTo(PHONES.helena)).toHaveLength(1);
  });

  it('offers a job given back to the rest of the team, and tells the manager once everyone has given it back', async () => {
    const ticket = await complain('CC-C1');
    await t.as('ana.sitoe').post(`/api/tickets/${ticket.ticketId}/claim`);

    expect((await t.as('ana.sitoe').post(`/api/tickets/${ticket.ticketId}/decline`, {})).status).toBe(400);
    const declined = await t
      .as('ana.sitoe')
      .post(`/api/tickets/${ticket.ticketId}/decline`, { reason: 'Vehicle broken down' });
    expect(declined.status).toBe(200);
    expect(declined.body).toEqual({ id: ticket.ticketId, status: 'new' });
    expect((await t.as('ana.sitoe').get('/api/me/jobs')).body).toEqual([]);
    // Ana gave it back: it is not offered to her again.
    expect((await t.as('ana.sitoe').get('/api/me/offers')).body).toEqual([]);
    expect((await detail(ticket.ticketId)).offer).toMatchObject({ notified: ['Armando Cossa'] });
    expect((await t.as('armando.cossa').get('/api/me/offers')).body).toHaveLength(1);

    await t.as('armando.cossa').post(`/api/tickets/${ticket.ticketId}/claim`);
    const again = await t
      .as('armando.cossa')
      .post(`/api/tickets/${ticket.ticketId}/decline`, { reason: 'Needs a bucket truck' });
    expect(again.body.status).toBe('new');

    const d = await detail(ticket.ticketId);
    expect(d.assignee).toBeNull();
    expect(
      d.events.filter((e: { type: string }) => e.type === 'decline').map((e: { data: object }) => e.data)
    ).toEqual([
      expect.objectContaining({ reason: 'Vehicle broken down' }),
      expect.objectContaining({ reason: 'Needs a bucket truck' })
    ]);
    expect(
      (await smsTo(PHONES.helena)).some((b) => b.includes('Armando Cossa') && b.includes(ticket.code))
    ).toBe(true);
  });

  it('tells the team again every 15 minutes until someone claims it; the office can tell them at once', async () => {
    await register('armando.cossa');
    const { ticketId } = await complain('CC-R1');
    const reminders = t.app.get(TicketsService);
    // Not 15 minutes yet: nothing happens.
    expect(await reminders.remindOffers()).toBe(0);
    await t.db
      .update(tickets)
      .set({ offeredAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(tickets.id, ticketId));
    expect(await reminders.remindOffers()).toBe(1);
    expect(await reminders.remindOffers()).toBe(0);
    expect((await detail(ticketId)).offer).toMatchObject({
      round: 2,
      notified: ['Ana Sitoe', 'Armando Cossa']
    });
    expect(await pushTitles('armando.cossa')).toEqual([
      'Novo trabalho para a equipa',
      'Trabalho ainda sem técnico'
    ]);

    const path = `/api/tickets/${ticketId}/offer`;
    expect((await t.as('armando.cossa').post(path)).status).toBe(403);
    expect((await t.as('joao.matsinhe').post(path)).status).toBe(404);
    const now = await t.as('helena.mondlane').post(path);
    expect(now.status).toBe(200);
    expect(now.body.offer).toMatchObject({ round: 3 });
    expect(now.body.events.at(-1)).toMatchObject({ type: 'offered', actorName: 'Helena Mondlane' });

    await t.as('ana.sitoe').post(`/api/tickets/${ticketId}/claim`);
    expect((await t.as('helena.mondlane').post(path)).body.code).toBe('NOT_WAITING');
    await t.db
      .update(tickets)
      .set({ offeredAt: new Date(Date.now() - 60 * 60_000) })
      .where(eq(tickets.id, ticketId));
    expect(await reminders.remindOffers()).toBe(0);
  });

  it('does not give jobs out when someone switches duty on: they are already offered to everyone', async () => {
    const { ticketId } = await complain('CC-W1');
    await onDuty('armando.cossa');
    expect(await detail(ticketId)).toMatchObject({ status: 'new', assignee: null });
  });

  it('takes a job back with a reason, tells that person and offers it to the rest of the team', async () => {
    const { ticketId, code } = await complain('CC-T1');
    await t.as('ana.sitoe').post(`/api/tickets/${ticketId}/claim`);

    const path = `/api/tickets/${ticketId}/take-back`;
    expect((await t.as('helena.mondlane').post(path, {})).status).toBe(400);
    expect((await t.as('paulo.bo').post(path, { reason: 'Ana is sick' })).status).toBe(403);
    expect((await t.as('joao.matsinhe').post(path, { reason: 'Ana is sick' })).status).toBe(404);
    const back = await t.as('helena.mondlane').post(path, { reason: 'Ana is sick' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({
      status: 'new',
      assignee: null,
      offer: { notified: ['Armando Cossa'] }
    });
    const event = (back.body.events as { type: string; data: object }[]).find((e) => e.type === 'take_back');
    expect(event?.data).toMatchObject({
      reason: 'Ana is sick',
      unassignedName: 'Ana Sitoe',
      from: 'accepted'
    });
    expect((await smsTo(PHONES.ana)).some((b) => b.includes(code) && b.includes('outro técnico'))).toBe(true);

    // Taken back again with nobody else left: it waits, and the manager is told.
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/claim`);
    const again = await t.as('carla.manhica').post(path, { reason: 'Armando went home' });
    expect(again.body).toMatchObject({ status: 'new', assignee: null });
    expect((await smsTo(PHONES.helena)).some((b) => b.includes(code))).toBe(true);
    // Nobody holds it now.
    expect((await t.as('carla.manhica').post(path, { reason: 'Once more' })).status).toBe(409);
  });

  it('pauses and resumes work; a paused job cannot be reported done', async () => {
    const ticket = await complain('CC-D1');
    const id = ticket.ticketId;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/start`);

    expect((await t.as('armando.cossa').post(`/api/tickets/${id}/hold`, {})).status).toBe(400);
    const held = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/hold`, { reason: 'Waiting for a new fuse' });
    expect(held.body).toMatchObject({ status: 'on_hold', allowedActions: ['resume'] });
    expect((await t.as('armando.cossa').get('/api/me/jobs')).body.map((j: { id: string }) => j.id)).toEqual([
      id
    ]);

    const resolve = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, { note: 'done' });
    expect(resolve.status).toBe(409);
    expect(resolve.body.code).toBe('INVALID_TRANSITION');
    expect((await t.as('ana.sitoe').post(`/api/tickets/${id}/resume`)).status).toBe(403);

    const resumed = await t.as('armando.cossa').post(`/api/tickets/${id}/resume`);
    expect(resumed.body.status).toBe('in_progress');
  });

  it('tells the previous staff member when a manager moves the job to someone else', async () => {
    const { ticketId, code } = await complain('CC-E1');
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/accept`);
    const moved = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['ana.sitoe'] });
    expect(moved.body).toMatchObject({ status: 'assigned', assignee: { id: ids['ana.sitoe'] } });
    expect((await smsTo(PHONES.armando)).some((b) => b.includes(code) && b.includes('outro técnico'))).toBe(
      true
    );
  });

  it('cancels with a reason; managers only in their team, never once closed', async () => {
    const { ticketId, code } = await complain('CC-F1');
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });

    expect(
      (await t.as('joao.matsinhe').post(`/api/tickets/${ticketId}/cancel`, { reason: 'Duplicate' })).status
    ).toBe(403);
    expect(
      (await t.as('armando.cossa').post(`/api/tickets/${ticketId}/cancel`, { reason: 'Duplicate' })).status
    ).toBe(403);
    expect((await t.as('helena.mondlane').post(`/api/tickets/${ticketId}/cancel`, {})).status).toBe(400);

    const cancelled = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/cancel`, { reason: 'Duplicate of CC-F0' });
    expect(cancelled.body).toMatchObject({ status: 'cancelled', allowedActions: [] });
    expect((await smsTo(PHONES.armando)).some((b) => b.includes(code) && b.includes('cancelado'))).toBe(true);
    expect((await t.as('armando.cossa').get('/api/me/jobs')).body).toEqual([]);

    const again = await t.as('nadia.mussa').post(`/api/tickets/${ticketId}/cancel`, { reason: 'Again' });
    expect(again.status).toBe(409);
  });

  it('lets the Call Center cancel by its own reference', async () => {
    await complain('CC-G1');
    const res = await t.as('call-center').post('/api/intake/call-center/tickets/CC-G1/cancel', {
      reason: 'Customer called back: power is back'
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const check = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/CC-G1/check-result', { result: 'fixed' });
    expect(check.status).toBe(409);
  });

  it('offers a reopened ticket to the whole team again', async () => {
    const { ticketId } = await complain('CC-H1');
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/claim`);
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/start`);
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/resolve`, { note: 'Replaced the fuse' });
    const check = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/CC-H1/check-result', { result: 'not_fixed' });
    expect(check.body).toMatchObject({ status: 'reopened', assigneeName: null });
    const d = await detail(ticketId);
    expect(d.events.map((e: { type: string }) => e.type).slice(-2)).toEqual(['reopen', 'offered']);
    expect(d.offer).toMatchObject({ notified: ['Ana Sitoe', 'Armando Cossa'], round: 1 });
    expect((await t.as('armando.cossa').get('/api/me/offers')).body).toHaveLength(1);
  });
});
