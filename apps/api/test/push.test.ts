import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { ENV, type Env } from '../src/config/env';
import { integrationCalls, notificationOutbox, pushDevices } from '../src/db/schema';
import { createTestApp, ids, resetData, waitFor, type Caller, type TestContext } from './helpers';
import { mockServer, type Received } from './mock-server';

const ARMANDO_PHONE = '+258840000006';
const CUSTOMER_PHONE = '+258841110001';

/** Stand-in for Expo: tokens containing "gone" are uninstalled apps, "flaky" fails once with a 503. */
function expoReply(req: Received, flakySeen: Set<string>) {
  const [message] = JSON.parse(req.body) as { to: string }[];
  if (message!.to.includes('gone')) {
    return {
      status: 200,
      body: JSON.stringify({
        data: [{ status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }]
      })
    };
  }
  if (message!.to.includes('flaky') && !flakySeen.has(message!.to)) {
    flakySeen.add(message!.to);
    return { status: 503, body: 'busy' };
  }
  return { status: 200, body: JSON.stringify({ data: [{ status: 'ok', id: 'receipt-1' }] }) };
}

describe('push notifications to the EDM Field app', () => {
  let t: TestContext;
  let expo: Awaited<ReturnType<typeof mockServer>>;
  const flakySeen = new Set<string>();

  beforeAll(async () => {
    expo = await mockServer(59871, (req) => expoReply(req, flakySeen));
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
    await expo.close();
  });
  beforeEach(async () => {
    await resetData(t.db);
    expo.received.length = 0;
    t.app.get<Env>(ENV).STAFF_ALERTS = 'push_or_sms';
  });

  async function register(who: Caller, token: string) {
    const res = await t.as(who).post('/api/me/devices', { token, platform: 'android' });
    expect(res.status).toBe(204);
  }

  async function assignedTicket(ref: string) {
    const created = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'no_power_single',
      description: 'No power'
    });
    const id = created.body.ticketId as string;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    return { id, code: created.body.code as string };
  }

  const outbox = () => t.db.select().from(notificationOutbox).orderBy(asc(notificationOutbox.createdAt));

  it('tells staff with the app by push instead of SMS; customers still get SMS', async () => {
    await register('armando.cossa', 'ExponentPushToken[armando-phone]');
    const { id, code } = await assignedTicket('CC-P1');

    const rows = await waitFor(outbox, (r) => r.filter((x) => x.status === 'sent').length === r.length);
    expect(rows.filter((r) => r.recipient === ARMANDO_PHONE)).toEqual([]);
    expect(rows.find((r) => r.channel === 'push')).toMatchObject({
      recipient: 'ExponentPushToken[armando-phone]',
      status: 'sent',
      payload: { title: 'Novo trabalho', data: { ticketId: id }, fallbackPhone: ARMANDO_PHONE }
    });
    expect(rows.some((r) => r.channel === 'sms' && r.recipient === CUSTOMER_PHONE)).toBe(true);

    const [sent] = JSON.parse(expo.received[0]!.body);
    expect(sent).toMatchObject({
      to: 'ExponentPushToken[armando-phone]',
      title: 'Novo trabalho',
      data: { ticketId: id },
      channelId: 'jobs',
      priority: 'high'
    });
    expect(sent.body).toContain(code);
  });

  it('sends both when STAFF_ALERTS=push_and_sms, and only SMS when sms_only', async () => {
    await register('armando.cossa', 'ExponentPushToken[armando-phone]');
    t.app.get<Env>(ENV).STAFF_ALERTS = 'push_and_sms';
    await assignedTicket('CC-P2');
    let rows = await outbox();
    expect(rows.filter((r) => r.channel === 'push')).toHaveLength(1);
    expect(rows.filter((r) => r.recipient === ARMANDO_PHONE)).toHaveLength(1);

    await resetData(t.db);
    await register('armando.cossa', 'ExponentPushToken[armando-phone]');
    t.app.get<Env>(ENV).STAFF_ALERTS = 'sms_only';
    await assignedTicket('CC-P3');
    rows = await outbox();
    expect(rows.filter((r) => r.channel === 'push')).toEqual([]);
    expect(rows.filter((r) => r.recipient === ARMANDO_PHONE)).toHaveLength(1);
  });

  it('forgets an uninstalled app and texts the person instead', async () => {
    await register('armando.cossa', 'ExponentPushToken[gone-phone]');
    await assignedTicket('CC-P4');
    const rows = await waitFor(outbox, (r) =>
      r.some((x) => x.recipient === ARMANDO_PHONE && x.status === 'sent')
    );
    expect(rows.find((r) => r.channel === 'push')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(rows.find((r) => r.recipient === ARMANDO_PHONE)).toMatchObject({ channel: 'sms', status: 'sent' });
    expect(await t.db.select().from(pushDevices)).toEqual([]);
    // Expo answered; an uninstalled app does not make the push service look broken on Connected systems.
    const [call] = await t.db.select().from(integrationCalls).where(eq(integrationCalls.system, 'push'));
    expect(call).toMatchObject({ ok: true, error: expect.stringContaining('DeviceNotRegistered') });
  });

  it('tries a push again when Expo is briefly unavailable', async () => {
    await register('armando.cossa', 'ExponentPushToken[flaky-phone]');
    await assignedTicket('CC-P5');
    const rows = await waitFor(outbox, (r) => r.find((x) => x.channel === 'push')?.status === 'sent', 20_000);
    expect(rows.find((r) => r.channel === 'push')).toMatchObject({ status: 'sent', attempts: 2 });
    expect(rows.filter((r) => r.recipient === ARMANDO_PHONE)).toEqual([]);
  });

  it('moves a phone to whoever signed in on it last, and stops after sign-out', async () => {
    await register('armando.cossa', 'ExponentPushToken[shared-phone]');
    await register('ana.sitoe', 'ExponentPushToken[shared-phone]');
    const devices = await t.db.select().from(pushDevices);
    expect(devices).toMatchObject([{ userId: ids['ana.sitoe'] }]);

    // Armando cannot remove a phone that is no longer his.
    await t.as('armando.cossa').post('/api/me/devices/remove', { token: 'ExponentPushToken[shared-phone]' });
    expect(await t.db.select().from(pushDevices)).toHaveLength(1);
    await t.as('ana.sitoe').post('/api/me/devices/remove', { token: 'ExponentPushToken[shared-phone]' });
    expect(await t.db.select().from(pushDevices)).toEqual([]);
  });

  it('only accepts Expo tokens from people', async () => {
    const bad = await t.as('armando.cossa').post('/api/me/devices', { token: 'abc', platform: 'android' });
    expect(bad.status).toBe(400);
    const system = await t
      .as('call-center')
      .post('/api/me/devices', { token: 'ExponentPushToken[x]', platform: 'android' });
    expect(system.status).toBe(403);
  });

  it('keeps the time an offline action really happened in the history', async () => {
    const { id } = await assignedTicket('CC-P6');
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
    // Start is replayed from the app's queue with the time it was really pressed.
    const happened = new Date(Date.now() - 30 * 60_000).toISOString();
    const started = await t
      .as('armando.cossa')
      .post(`/api/tickets/${id}/start`, {}, { 'X-Occurred-At': happened });
    expect(started.status).toBe(200);
    const byType = (type: string) => started.body.events.find((e: { type: string }) => e.type === type);
    expect(byType('start').data.occurredAt).toBe(happened);
    expect(byType('accept').data.occurredAt).toBeUndefined();
  });
});
