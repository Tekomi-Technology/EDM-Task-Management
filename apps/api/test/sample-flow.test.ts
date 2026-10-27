import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { notificationOutbox } from '../src/db/schema';
import { createTestApp, ids, resetData, waitFor, type TestContext } from './helpers';

const complaint = (ref: string, contractNo = '40217735') => ({
  externalRef: ref,
  contractNo,
  problemType: 'no_power_single',
  description: 'Whole house without power since 07:15. Neighbours have power.'
});

describe('sample flow: Call Center complaint to closed ticket', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  async function newTicket(ref = 'CC-1001') {
    const res = await t.as('call-center').post('/api/intake/call-center/complaints', complaint(ref));
    expect(res.status).toBe(201);
    return res.body as { ticketId: string; code: string; status: string };
  }

  async function workUntilResolved(ticketId: string, withPhoto = true) {
    expect(
      (
        await t
          .as('helena.mondlane')
          .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] })
      ).status
    ).toBe(200);
    expect((await t.as('armando.cossa').post(`/api/tickets/${ticketId}/accept`)).status).toBe(200);
    expect((await t.as('armando.cossa').post(`/api/tickets/${ticketId}/start`)).status).toBe(200);
    const attachmentIds: string[] = [];
    if (withPhoto) {
      const upload = await t.as('armando.cossa').post(`/api/tickets/${ticketId}/attachments`, {
        fileName: 'pole.jpg',
        contentType: 'image/jpeg',
        size: 4
      });
      expect(upload.status).toBe(201);
      const put = await fetch(upload.body.uploadUrl, {
        method: 'PUT',
        headers: upload.body.headers,
        body: 'jpeg'
      });
      expect(put.ok).toBe(true);
      attachmentIds.push(upload.body.attachmentId);
    }
    const resolved = await t.as('armando.cossa').post(`/api/tickets/${ticketId}/resolve`, {
      note: 'Replaced 12 m of service cable at pole P-4471.',
      attachmentIds
    });
    expect(resolved.status).toBe(200);
    return resolved.body;
  }

  it('creates a ticket routed to the team covering the customer, with a TK-YY-NNNNN code', async () => {
    const created = await newTicket();
    expect(created.code).toMatch(/^TK-\d{2}-00001$/);
    expect(created.status).toBe('new');

    const detail = await t.as('helena.mondlane').get(`/api/tickets/${created.ticketId}`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      teamName: 'South 1',
      areaName: 'Matola',
      priority: 2,
      title: 'No power, one home',
      customer: { contractNo: '40217735', fullName: 'Rosa Chissano' },
      allowedActions: ['assign', 'cancel']
    });
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual(['created']);
    expect(detail.body.events[0].actorName).toBe('Call Center system');
  });

  it('runs the whole flow and closes the ticket after the Call Center confirms with the customer', async () => {
    const { ticketId } = await newTicket();
    const resolved = await workUntilResolved(ticketId);
    expect(resolved.status).toBe('resolved');
    expect(resolved.attachments).toHaveLength(1);
    expect(resolved.attachments[0].url).toContain('edm-test-attachments');

    const status = await t.as('call-center').get('/api/intake/call-center/tickets/CC-1001');
    expect(status.body).toMatchObject({
      status: 'resolved',
      assigneeName: 'Armando Cossa',
      resolutionNote: 'Replaced 12 m of service cable at pole P-4471.'
    });

    const check = await t.as('call-center').post('/api/intake/call-center/tickets/CC-1001/check-result', {
      result: 'fixed',
      note: 'Customer confirms power is back'
    });
    expect(check.status).toBe(201);
    expect(check.body.status).toBe('closed');

    const detail = await t.as('nadia.mussa').get(`/api/tickets/${ticketId}`);
    expect(detail.body.events.map((e: { type: string }) => e.type)).toEqual([
      'created',
      'assign',
      'accept',
      'start',
      'resolve',
      'close'
    ]);
    expect(detail.body.allowedActions).toEqual([]);
  });

  it('reopens the ticket when the customer says it is not fixed, so the manager can assign it again', async () => {
    const { ticketId } = await newTicket();
    await workUntilResolved(ticketId, false);
    const check = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/CC-1001/check-result', { result: 'not_fixed' });
    expect(check.body.status).toBe('reopened');

    const again = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['ana.sitoe'] });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('assigned');
    expect(again.body.assignee.fullName).toBe('Ana Sitoe');
  });

  it('sends the SMS messages through the outbox', async () => {
    const { ticketId } = await newTicket();
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    const rows = await waitFor(
      () =>
        t.db
          .select()
          .from(notificationOutbox)
          .where(eq(notificationOutbox.ticketId, ticketId))
          .orderBy(asc(notificationOutbox.createdAt)),
      (r) => r.length === 3 && r.every((x) => x.status === 'sent')
    );
    expect(rows.map((r) => [r.recipient, r.status])).toEqual([
      ['+258841110001', 'sent'], // customer: request received
      ['+258840000002', 'sent'], // team manager: new ticket
      ['+258840000006', 'sent'] // Armando: new job
    ]);
    expect(rows[0].body).toContain('Recebemos o seu pedido');
  });

  it('lists only the tickets each person may see', async () => {
    const { ticketId } = await newTicket();
    await t.as('call-center').post('/api/intake/call-center/complaints', complaint('CC-2002', '40188210'));

    const helena = await t.as('helena.mondlane').get('/api/tickets');
    expect(helena.body.items.map((i: { teamName: string }) => i.teamName)).toEqual(['South 1']);
    const joao = await t.as('joao.matsinhe').get('/api/tickets');
    expect(joao.body.items.map((i: { teamName: string }) => i.teamName)).toEqual(['South 2']);
    expect((await t.as('nadia.mussa').get('/api/tickets')).body.total).toBe(2);

    expect((await t.as('armando.cossa').get('/api/me/jobs')).body).toEqual([]);
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    const jobs = await t.as('armando.cossa').get('/api/me/jobs');
    expect(jobs.body.map((j: { id: string }) => j.id)).toEqual([ticketId]);
    expect((await t.as('ana.sitoe').get(`/api/tickets/${ticketId}`)).status).toBe(404);
  });

  it('shows a team manager the field staff of their team with open job counts', async () => {
    const me = await t.as('helena.mondlane').get('/api/me');
    const staff = await t.as('helena.mondlane').get(`/api/teams/${me.body.teamId}/staff`);
    expect(staff.body.map((s: { fullName: string; openJobs: number }) => [s.fullName, s.openJobs])).toEqual([
      ['Ana Sitoe', 0],
      ['Armando Cossa', 0]
    ]);
    const joaoMe = await t.as('joao.matsinhe').get('/api/me');
    expect((await t.as('helena.mondlane').get(`/api/teams/${joaoMe.body.teamId}/staff`)).status).toBe(403);
  });
});
