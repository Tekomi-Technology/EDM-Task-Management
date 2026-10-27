import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox } from '../src/db/schema';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

const PAULO_BO = '+258840000005';
const HELENA = '+258840000002';
const ARMANDO = '+258840000006';

describe('help requests from the field to the back office', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  const smsTo = async (phone: string) =>
    (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).map(
      (r) => r.body
    );

  async function armandosJob() {
    const c = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: 'CC-H1',
      contractNo: '40217735',
      problemType: 'no_power_street',
      description: 'Street dark'
    });
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${c.body.ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    return c.body.ticketId as string;
  }

  it('lets staff ask for help on their job; BO and the team manager are told', async () => {
    const job = await armandosJob();
    const res = await t.as('armando.cossa').post('/api/help-requests', {
      kind: 'truck',
      message: 'Need a bucket truck to lift the cable',
      ticketId: job
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'new',
      kind: 'truck',
      ticket: { id: job },
      teamName: 'South 1',
      messages: [
        { fromField: true, body: 'Need a bucket truck to lift the cable', authorName: 'Armando Cossa' }
      ]
    });
    expect((await smsTo(PAULO_BO))[0]).toContain('Armando Cossa pede ajuda');
    expect((await smsTo(HELENA)).some((m) => m.includes('pede ajuda'))).toBe(true);
    const history = (await t.as('helena.mondlane').get(`/api/tickets/${job}`)).body.events;
    expect(history.at(-1)).toMatchObject({ type: 'help_requested', data: { kind: 'truck' } });

    expect(
      (
        await t
          .as('ana.sitoe')
          .post('/api/help-requests', { kind: 'other', message: 'Can I help?', ticketId: job })
      ).status
    ).toBe(403);
    expect((await t.as('joao.matsinhe').get('/api/help-requests')).body).toEqual([]);
    expect((await t.as('helena.mondlane').get('/api/tickets/counts')).body.help).toBe(1);
  });

  it('answers and solves the request; the staff member gets the reply and can write back', async () => {
    const created = await t
      .as('armando.cossa')
      .post('/api/help-requests', { kind: 'advice', message: 'Meter number not found' });
    const id = created.body.id as string;

    const answered = await t
      .as('paulo.bo')
      .post(`/api/help-requests/${id}/messages`, { body: 'Use the old meter number from billing: 0412-77' });
    expect(answered.body).toMatchObject({ status: 'in_progress', handledBy: 'Paulo Machava' });
    expect((await smsTo(ARMANDO)).at(-1)).toContain('0412-77');

    await t.as('armando.cossa').post(`/api/help-requests/${id}/messages`, { body: 'Found it, thanks' });
    const solved = await t
      .as('paulo.bo')
      .post(`/api/help-requests/${id}/messages`, { body: 'Good', status: 'solved' });
    expect(solved.body.status).toBe('solved');
    expect(solved.body.messages.map((m: { fromField: boolean }) => m.fromField)).toEqual([
      true,
      false,
      true,
      false
    ]);

    const mine = (await t.as('armando.cossa').get('/api/me/help-requests')).body;
    expect(mine).toHaveLength(1);
    expect((await t.as('ana.sitoe').get(`/api/help-requests/${id}`)).status).toBe(404);
    expect((await t.as('paulo.bo').get('/api/tickets/counts')).body.help).toBe(0);
  });
});
