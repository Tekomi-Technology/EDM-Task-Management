import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox, users } from '../src/db/schema';
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

describe('full ticket lifecycle: auto-assignment, decline, pause, cancel', () => {
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

  async function complain(ref: string, contractNo?: string) {
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/complaints', complaint(ref, contractNo));
    expect(res.status).toBe(201);
    return res.body as { ticketId: string; code: string; status: string; assigneeName: string | null };
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

  it('gives new tickets to the least busy staff member on duty, by SMS, without bothering the manager', async () => {
    await onDuty('armando.cossa');
    await onDuty('ana.sitoe');
    const first = await complain('CC-A1');
    const second = await complain('CC-A2');
    const third = await complain('CC-A3');
    // Both start with no jobs, so the first goes by name; then the one with fewer jobs; then whoever waited longer.
    expect([first, second, third].map((x) => [x.status, x.assigneeName])).toEqual([
      ['assigned', 'Ana Sitoe'],
      ['assigned', 'Armando Cossa'],
      ['assigned', 'Ana Sitoe']
    ]);
    expect(await smsTo(PHONES.helena)).toEqual([]);
    expect((await smsTo(PHONES.ana)).some((b) => b.includes(first.code))).toBe(true);

    const history = (await detail(first.ticketId)).events;
    expect(history.at(-1)).toMatchObject({
      type: 'assign',
      actorName: 'System (auto-assign)',
      data: { auto: true, assigneeId: ids['ana.sitoe'] }
    });
  });

  it('prefers whoever has fewer unfinished jobs over whoever waited longer', async () => {
    await onDuty('armando.cossa');
    await onDuty('ana.sitoe');
    const first = await complain('CC-W1'); // Ana: by name
    const second = await complain('CC-W2'); // Armando: Ana now has a job
    expect([first.assigneeName, second.assigneeName]).toEqual(['Ana Sitoe', 'Armando Cossa']);
    for (const step of ['accept', 'start']) {
      await t.as('armando.cossa').post(`/api/tickets/${second.ticketId}/${step}`);
    }
    await t.as('armando.cossa').post(`/api/tickets/${second.ticketId}/resolve`, { note: 'Done' });
    // Armando was assigned more recently, but has no unfinished job; Ana still has one.
    expect((await complain('CC-W3')).assigneeName).toBe('Armando Cossa');
  });

  it('leaves the ticket for the manager when nobody in the team is on duty', async () => {
    await onDuty('ana.sitoe');
    await onDuty('ana.sitoe', false);
    await onDuty('ofelia.tembe'); // on duty, but in the other team
    const ticket = await complain('CC-B1');
    expect(ticket.status).toBe('new');
    expect(await smsTo(PHONES.helena)).toHaveLength(1);
  });

  it('does not give jobs to blocked staff even if they were on duty', async () => {
    await onDuty('armando.cossa');
    await t.db.update(users).set({ status: 'blocked' }).where(eq(users.id, ids['armando.cossa']));
    expect((await complain('CC-B2')).status).toBe('new');
  });

  it('passes a declined job to someone else, and to the manager once everyone has declined', async () => {
    await onDuty('armando.cossa');
    await onDuty('ana.sitoe');
    const ticket = await complain('CC-C1');
    expect(ticket.assigneeName).toBe('Ana Sitoe');

    expect((await t.as('ana.sitoe').post(`/api/tickets/${ticket.ticketId}/decline`, {})).status).toBe(400);
    const declined = await t
      .as('ana.sitoe')
      .post(`/api/tickets/${ticket.ticketId}/decline`, { reason: 'Vehicle broken down' });
    expect(declined.status).toBe(200);
    expect(declined.body).toEqual({ id: ticket.ticketId, status: 'assigned' });
    expect((await t.as('ana.sitoe').get(`/api/tickets/${ticket.ticketId}`)).status).toBe(404);
    expect((await t.as('ana.sitoe').get('/api/me/jobs')).body).toEqual([]);
    expect((await detail(ticket.ticketId)).assignee.fullName).toBe('Armando Cossa');

    await t.as('armando.cossa').post(`/api/tickets/${ticket.ticketId}/accept`);
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

  it('gives a reopened ticket straight back to someone on duty', async () => {
    await onDuty('armando.cossa');
    const { ticketId } = await complain('CC-H1');
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/accept`);
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/start`);
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/resolve`, { note: 'Replaced the fuse' });
    const check = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/CC-H1/check-result', { result: 'not_fixed' });
    expect(check.body).toMatchObject({ status: 'assigned', assigneeName: 'Armando Cossa' });
    const types = (await detail(ticketId)).events.map((e: { type: string }) => e.type);
    expect(types.slice(-2)).toEqual(['reopen', 'assign']);
  });
});
