import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { notificationOutbox, tickets } from '../src/db/schema';
import { EscalationService } from '../src/escalation/escalation.service';
import { createTestApp, ids, resetData, type Caller, type TestContext } from './helpers';

/** Customer 40217735 lives at 32.47, -25.93 (Matola). */
const NEAR = { lat: -25.931, lng: 32.471 };
const FAR = { lat: -25.99, lng: 32.41 };
const PHONES = {
  armando: '+258840000006',
  helena: '+258840000002',
  nadia: '+258840000003',
  carla: '+258840000011'
};

describe('field staff: positions, distance, time limits and performance', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  const onDuty = (who: Caller, value = true) => t.as(who).post('/api/me/duty', { onDuty: value });
  const at = (who: Caller, p: { lat: number; lng: number }, minutesAgo = 0) =>
    t.as(who).post('/api/me/locations', {
      points: [{ ...p, accuracy: 8, recordedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString() }]
    });
  const complain = async (ref: string, contractNo = '40217735') =>
    (
      await t.as('call-center').post('/api/intake/call-center/complaints', {
        externalRef: ref,
        contractNo,
        problemType: 'prepaid_meter',
        description: 'Meter'
      })
    ).body as { ticketId: string; code: string; assigneeName: string | null; status: string };
  const smsTo = async (phone: string) =>
    (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).map(
      (r) => r.body
    );

  it('keeps positions only while on duty, and ignores impossible times', async () => {
    expect((await at('armando.cossa', NEAR)).body).toEqual({ accepted: 0 });
    await onDuty('armando.cossa');
    const res = await t.as('armando.cossa').post('/api/me/locations', {
      points: [
        { ...NEAR, recordedAt: new Date(Date.now() - 5 * 60_000).toISOString() },
        { ...FAR, recordedAt: new Date(Date.now() + 3600_000).toISOString() },
        { ...FAR, recordedAt: '2020-01-01T00:00:00Z' }
      ]
    });
    expect(res.body).toEqual({ accepted: 1 });
    expect(
      (
        await t
          .as('armando.cossa')
          .post('/api/me/locations', { points: [{ lat: 200, lng: 0, recordedAt: new Date().toISOString() }] })
      ).status
    ).toBe(400);
  });

  it('shows who is on a job, free, offline or off duty on the live map, within the caller’s scope', async () => {
    await onDuty('armando.cossa');
    await onDuty('ana.sitoe');
    await onDuty('ofelia.tembe');
    await at('armando.cossa', NEAR);
    await at('ofelia.tembe', FAR, 30); // too long ago: offline
    const { ticketId } = await complain('CC-1');
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${ticketId}/accept`);

    const live = (await t.as('nadia.mussa').get('/api/live')).body;
    const state = Object.fromEntries(
      live.staff.map((s: { fullName: string; state: string }) => [s.fullName, s.state])
    );
    expect(state).toEqual({
      'Ana Sitoe': 'offline',
      'Armando Cossa': 'on_job',
      'Ofélia Tembe': 'offline'
    });
    const armando = live.staff.find((s: { fullName: string }) => s.fullName === 'Armando Cossa');
    expect(armando).toMatchObject({
      location: { lat: NEAR.lat, lng: NEAR.lng, accuracy: 8 },
      currentJob: { id: ticketId }
    });
    expect(live.areas.map((a: { name: string }) => a.name)).toEqual(['Maputo Central', 'Matola']);
    expect(live.areas[0].boundary[0][0][0]).toHaveLength(2);
    await onDuty('ana.sitoe', false);
    const joao = (await t.as('joao.matsinhe').get('/api/live')).body;
    expect(joao.staff.map((s: { fullName: string }) => s.fullName)).toEqual(['Ofélia Tembe']);
    expect((await t.as('armando.cossa').get('/api/live')).status).toBe(403);
  });

  it('gives a new job to the nearest of equally busy staff, and suggests by distance', async () => {
    await onDuty('armando.cossa');
    await onDuty('ana.sitoe');
    await at('armando.cossa', NEAR);
    await at('ana.sitoe', FAR);
    // By name Ana would come first; Armando is much closer.
    const first = await complain('CC-2');
    expect(first.assigneeName).toBe('Armando Cossa');
    const history = (await t.as('helena.mondlane').get(`/api/tickets/${first.ticketId}`)).body.events;
    expect(history.at(-1).data.distanceM).toBeLessThan(500);

    const south1 = (await t.as('helena.mondlane').get('/api/me')).body.teamId;
    // Fewer unfinished jobs comes before distance: the next job goes to Ana, although she is far.
    const second = await complain('CC-3');
    expect(second.assigneeName).toBe('Ana Sitoe');
    // Now both have one job: the nearest one is suggested first.
    const s = (
      await t.as('helena.mondlane').get(`/api/teams/${south1}/suggestions?ticketId=${second.ticketId}`)
    ).body;
    expect(
      s.map((x: { fullName: string; openJobs: number; bestMatch: boolean }) => [
        x.fullName,
        x.openJobs,
        x.bestMatch
      ])
    ).toEqual([
      ['Armando Cossa', 1, true],
      ['Ana Sitoe', 1, false]
    ]);
    expect(s[0].distanceM).toBeLessThan(500);
    expect(s[1].distanceM).toBeGreaterThan(5000);
  });

  it('reminds, then escalates late tickets step by step, once each', async () => {
    const escalation = t.app.get(EscalationService);
    const { ticketId, code } = await complain('CC-4');
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
    const setTimes = (createdMinAgo: number, dueInMin: number) =>
      t.db
        .update(tickets)
        .set({
          createdAt: sql`now() - make_interval(mins => ${createdMinAgo})`,
          dueAt: sql`now() + make_interval(mins => ${dueInMin})`
        })
        .where(eq(tickets.id, ticketId));

    await setTimes(50, 50); // half the time left
    expect(await escalation.run()).toBe(0);
    await setTimes(80, 20); // a fifth left
    expect(await escalation.run()).toBe(1);
    expect(await escalation.run()).toBe(0); // sent once
    expect((await smsTo(PHONES.armando)).at(-1)).toContain(`${code} tem de ficar pronto em 20 min`);

    await setTimes(110, -10); // late
    await escalation.run();
    expect((await smsTo(PHONES.helena)).at(-1)).toContain('passou o prazo');
    expect((await smsTo(PHONES.nadia)).at(-1)).toContain('passou o prazo');
    expect(await smsTo(PHONES.carla)).toEqual([]);

    await setTimes(160, -60); // one and a half times the limit
    await escalation.run();
    expect((await smsTo(PHONES.carla)).at(-1)).toContain('muito atrasado');

    const d = (await t.as('carla.manhica').get(`/api/tickets/${ticketId}`)).body;
    expect(d.escalationLevel).toBe(3);
    expect(
      d.events
        .filter((e: { type: string }) => e.type === 'escalate')
        .map((e: { data: { level: number; notified: string[] } }) => [e.data.level, e.data.notified])
    ).toEqual([
      [1, ['Armando Cossa']],
      [2, ['Armando Cossa', 'team manager', 'NOC']],
      [3, ['technical managers']]
    ]);
  });

  it('skips the reminder for a ticket found already late, and leaves fixed or linked tickets alone', async () => {
    const escalation = t.app.get(EscalationService);
    const late = await complain('CC-5');
    const fixed = await complain('CC-6');
    await t.db
      .update(tickets)
      .set({ createdAt: sql`now() - interval '2 hours'`, dueAt: sql`now() - interval '1 minute'` })
      .where(sql`${tickets.id} in (${late.ticketId}, ${fixed.ticketId})`);
    await t.db.update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, fixed.ticketId));
    expect(await escalation.run()).toBe(1);
    const events = (await t.as('nadia.mussa').get(`/api/tickets/${late.ticketId}`)).body.events;
    expect(
      events
        .filter((e: { type: string }) => e.type === 'escalate')
        .map((e: { data: { level: number } }) => e.data.level)
    ).toEqual([2]);
  });

  it('measures each staff member’s work: jobs done, on time, time to arrive and first-time fixes', async () => {
    const work = async (ref: string, outcome: 'fixed' | 'not_fixed') => {
      const { ticketId } = await complain(ref);
      await t
        .as('helena.mondlane')
        .post(`/api/tickets/${ticketId}/assign`, { assigneeId: ids['armando.cossa'] });
      for (const step of ['accept', 'start'])
        await t.as('armando.cossa').post(`/api/tickets/${ticketId}/${step}`);
      await t.as('armando.cossa').post(`/api/tickets/${ticketId}/resolve`, { note: 'Done' });
      await t
        .as('call-center')
        .post(`/api/intake/call-center/tickets/${ref}/check-result`, { result: outcome });
      return ticketId;
    };
    await work('CC-7', 'fixed');
    await work('CC-8', 'not_fixed');
    // Ana has the reopened job, so this one goes to Armando automatically.
    const declined = await complain('CC-9');
    expect(declined.assigneeName).toBe('Armando Cossa');
    await t
      .as('armando.cossa')
      .post(`/api/tickets/${declined.ticketId}/decline`, { reason: 'Too far today' });

    const staff = (await t.as('helena.mondlane').get('/api/field-staff?days=30')).body;
    const armando = staff.find((s: { fullName: string }) => s.fullName === 'Armando Cossa');
    expect(armando).toMatchObject({
      jobsAssigned: 3,
      jobsDone: 2,
      onTimeRate: 1,
      firstTimeFixRate: 0.5,
      reopened: 1,
      declined: 1,
      avgToArriveMin: 0,
      avgFixMin: 0
    });
    expect(staff.map((s: { fullName: string }) => s.fullName)).toEqual(['Ana Sitoe', 'Armando Cossa']);
    const all = (await t.as('carla.manhica').get('/api/field-staff')).body;
    expect(all).toHaveLength(3);
  });
});
