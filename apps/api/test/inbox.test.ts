import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox, users } from '../src/db/schema';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

const HELENA_PHONE = '+258840000002';

/** The bell in the web app: the alerts office staff get by SMS, in English, with a link. */
describe('notifications under the bell', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  const complain = (ref: string) =>
    t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'no_power_single',
      description: 'No power'
    });
  const inbox = async (who: Parameters<TestContext['as']>[0]) =>
    (await t.as(who).get('/api/me/notifications')).body;

  it('tells the team manager about a ticket nobody could take, with a link to it', async () => {
    const created = (await complain('CC-1')).body;
    expect(await inbox('helena.mondlane')).toEqual({
      unread: 1,
      items: [
        expect.objectContaining({
          title: `${created.code} No power, one home is waiting to be assigned`,
          link: `/tickets/${created.ticketId}`,
          read: false
        })
      ]
    });
    // The manager of the other team and the field staff are not told.
    expect((await inbox('joao.matsinhe')).unread).toBe(0);
    expect((await inbox('armando.cossa')).unread).toBe(0);
  });

  it('still reaches a manager without a phone number, who then gets no SMS', async () => {
    await t.db.update(users).set({ phone: null }).where(eq(users.id, ids['helena.mondlane']));
    await complain('CC-2');
    expect((await inbox('helena.mondlane')).unread).toBe(1);
    expect(
      await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, HELENA_PHONE))
    ).toEqual([]);
  });

  it('tells BO about help requests, linking to the help screen', async () => {
    await t
      .as('armando.cossa')
      .post('/api/help-requests', { kind: 'truck', message: 'Need the crane truck' });
    const bo = await inbox('paulo.bo');
    expect(bo.items[0]).toMatchObject({ title: 'Armando Cossa asks for help: truck', link: '/help' });
    // Helena manages Armando's team, so she is told too, once.
    expect(
      (await inbox('helena.mondlane')).items.filter((i: { link: string }) => i.link === '/help')
    ).toHaveLength(1);
  });

  it('marks notifications read, one or all, and only the person’s own', async () => {
    await complain('CC-3');
    await complain('CC-4');
    const items = (await inbox('helena.mondlane')).items as { id: string }[];
    expect(
      (await t.as('joao.matsinhe').post('/api/me/notifications/read', { ids: [items[0]!.id] })).status
    ).toBe(204);
    expect((await inbox('helena.mondlane')).unread).toBe(2);

    await t.as('helena.mondlane').post('/api/me/notifications/read', { ids: [items[0]!.id] });
    expect((await inbox('helena.mondlane')).unread).toBe(1);
    await t.as('helena.mondlane').post('/api/me/notifications/read', {});
    const after = await inbox('helena.mondlane');
    expect(after.unread).toBe(0);
    expect(after.items.every((i: { read: boolean }) => i.read)).toBe(true);
  });
});
