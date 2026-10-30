import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { alarms, notificationOutbox, tickets } from '../src/db/schema';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

const NADIA_NOC = '+258840000003';
const HELENA = '+258840000002';
const ARMANDO = '+258840000006';
const ROSA = '+258841110001';
/** Near customer 40217735 (Rosa Chissano, Matola). */
const MATOLA = { lat: -25.931, lng: 32.471 };

let n = 0;
function alarm(overrides: Record<string, unknown> = {}) {
  n += 1;
  return {
    alarmId: `A-${n}`,
    event: 'raise',
    elementCode: 'F-12',
    elementName: 'Feeder F-12',
    alarmType: 'Breaker trip, overcurrent',
    severity: 'critical',
    occurredAt: new Date().toISOString(),
    location: MATOLA,
    ...overrides
  };
}

describe('network incidents from the NMS and the public, and planned work', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  async function send(...events: object[]) {
    const res = await t.as('nms').post('/api/intake/nms/alarms', { alarms: events });
    expect(res.status).toBe(200);
    return res.body.results as {
      alarmId: string;
      result: string;
      ticketId: string | null;
      code: string | null;
    }[];
  }
  const smsTo = async (phone: string) =>
    (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).map(
      (r) => r.body
    );
  const detail = async (id: string, who: Parameters<TestContext['as']>[0] = 'nadia.mussa') =>
    (await t.as(who).get(`/api/tickets/${id}`)).body;

  it('opens a network incident for an alarm, routed to the team of the place, and tells NOC', async () => {
    const [r] = await send(alarm());
    expect(r).toMatchObject({ result: 'created', code: expect.stringMatching(/^TK-/) });
    const d = await detail(r!.ticketId!);
    expect(d).toMatchObject({
      type: 'network_incident',
      source: 'nms',
      priority: 1,
      teamName: 'South 1',
      title: 'Breaker trip, overcurrent · Feeder F-12',
      network: { elementCode: 'F-12', severity: 'critical', activeAlarms: 1 }
    });
    expect((await smsTo(NADIA_NOC)).some((b) => b.includes(r!.code!))).toBe(true);
    // Nobody on duty: it still goes straight to someone of the team, and the manager is not bothered.
    expect(d.assignee).not.toBeNull();
    expect(await smsTo(HELENA)).toHaveLength(0);
    expect((await t.as('call-center').post('/api/intake/nms/alarms', { alarms: [alarm()] })).status).toBe(
      403
    );
  });

  it('groups alarms with the same cause into one incident, and keeps others apart', async () => {
    const [first] = await send(alarm({ correlationId: 'C-1' }));
    const results = await send(
      alarm({
        elementCode: 'RMU-207',
        parentElementCode: 'F-12',
        alarmType: 'Voltage loss downstream',
        severity: 'major'
      }),
      alarm({ elementCode: 'R-12A', correlationId: 'C-1', alarmType: 'Earth fault detected' }),
      alarm({ elementCode: 'F-12', alarmType: 'Feeder protection operated' }),
      alarm({
        elementCode: 'PT-4471',
        elementName: 'Transformer PT-4471',
        severity: 'major',
        location: undefined
      })
    );
    expect(results.map((r) => r.result)).toEqual(['grouped', 'grouped', 'grouped', 'created']);
    expect(results.slice(0, 3).every((r) => r.ticketId === first!.ticketId)).toBe(true);

    const list = (await t.as('nadia.mussa').get('/api/incidents')).body;
    expect(
      list.map((i: { elementCode: string; alarmCount: number }) => [i.elementCode, i.alarmCount])
    ).toEqual([
      ['F-12', 4],
      ['PT-4471', 1]
    ]);
    // An alarm on the feeder of a transformer already in an incident joins it too (seen from upstream).
    const [up] = await send(alarm({ elementCode: 'F-30', alarmType: 'Feeder trip' }));
    const [down] = await send(alarm({ elementCode: 'PT-9', parentElementCode: 'F-30', severity: 'minor' }));
    expect(down!.ticketId).toBe(up!.ticketId);
  });

  it('only records warnings, ignores repeats, and tells the crew when every alarm has cleared', async () => {
    const [warning] = await send(alarm({ severity: 'warning', elementCode: 'SE-3' }));
    expect(warning).toMatchObject({ result: 'recorded', ticketId: null });

    const a = alarm();
    const b = alarm({ elementCode: 'RMU-1', parentElementCode: 'F-12' });
    const [created] = await send(a, b);
    expect((await send(a))[0]!.result).toBe('updated');
    await t
      .as('helena.mondlane')
      .post(`/api/tickets/${created!.ticketId}/assign`, { assigneeId: ids['armando.cossa'] });

    const cleared = await send({ ...a, event: 'clear' }, { ...a, event: 'clear' }, { ...b, event: 'clear' });
    expect(cleared.map((r) => r.result)).toEqual(['cleared', 'ignored', 'cleared']);
    const d = await detail(created!.ticketId!);
    expect(d.network.activeAlarms).toBe(0);
    expect(d.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['alarm_cleared', 'all_alarms_cleared'])
    );
    expect((await smsTo(ARMANDO)).some((m) => m.includes('alarmes'))).toBe(true);
    // NOC still decides: the incident stays open.
    expect(d.status).toBe('assigned');
  });

  it('raises the incident severity when a worse alarm joins', async () => {
    const [r] = await send(alarm({ severity: 'minor' }));
    expect((await detail(r!.ticketId!)).priority).toBe(3);
    await send(alarm({ severity: 'major', elementCode: 'F-12', customersAffected: 1900 }));
    expect(await detail(r!.ticketId!)).toMatchObject({
      priority: 2,
      network: { severity: 'major', customersAffected: 1900 }
    });
  });

  it('links no-power complaints near an incident instead of sending someone, and closes them with it', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const [inc] = await send(alarm());
    expect((await detail(inc!.ticketId!)).assignee.fullName).toBe('Armando Cossa');

    const complaint = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: 'CC-L1',
      contractNo: '40217735',
      problemType: 'no_power_single',
      description: 'No power'
    });
    const linked = await detail(complaint.body.ticketId);
    expect(linked).toMatchObject({ status: 'new', assignee: null, incident: { id: inc!.ticketId } });
    expect((await smsTo(ROSA)).at(-1)).toContain('Já sabemos da avaria');
    const overview = (await t.as('helena.mondlane').get('/api/overview')).body;
    expect(overview.unassigned.map((x: { id: string }) => x.id)).not.toContain(complaint.body.ticketId);
    expect((await detail(inc!.ticketId!)).network.linkedTickets).toHaveLength(1);

    // A meter problem is not about the outage: it is not linked.
    const meter = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: 'CC-L2',
      contractNo: '40217735',
      problemType: 'prepaid_meter',
      description: 'Meter'
    });
    expect((await detail(meter.body.ticketId)).incident).toBeNull();

    for (const step of ['accept', 'start'])
      await t.as('armando.cossa').post(`/api/tickets/${inc!.ticketId}/${step}`);
    await t
      .as('armando.cossa')
      .post(`/api/tickets/${inc!.ticketId}/resolve`, { note: 'Replaced the fuse at F-12' });
    // The Call Center checks customers, not the network.
    const byCallCenter = await t
      .as('call-center')
      .post(`/api/intake/call-center/tickets/CC-L1/check-result`, { result: 'fixed' });
    expect(byCallCenter.status).toBe(409); // the customer ticket itself is not resolved
    const closed = await t
      .as('nadia.mussa')
      .post(`/api/tickets/${inc!.ticketId}/close`, { note: 'Feeder back' });
    expect(closed.body.status).toBe('closed');

    const after = await detail(complaint.body.ticketId);
    expect(after.status).toBe('closed');
    expect(after.events.at(-1).type).toBe('closed_with_incident');
    expect((await smsTo(ROSA)).at(-1)).toContain('foi reparada');
  });

  it('does not let the Call Center close network tickets', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const report = await t.as('call-center').post('/api/intake/call-center/network-reports', {
      externalRef: 'NR-9',
      reportType: 'pole_damaged',
      description: 'Pole leaning over the road',
      address: 'Rua da Machava, near the school',
      location: MATOLA
    });
    const id = report.body.ticketId;
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, { note: 'Pole straightened' });
    const res = await t
      .as('call-center')
      .post('/api/intake/call-center/tickets/NR-9/check-result', { result: 'fixed' });
    expect([res.status, res.body.code]).toEqual([403, 'NOC_CHECKS_NETWORK']);
  });

  it('frees linked tickets when the incident turns out to be a false alarm', async () => {
    const [inc] = await send(alarm());
    const complaint = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: 'CC-F1',
      contractNo: '40217735',
      problemType: 'no_power_street',
      description: 'Street dark'
    });
    await t.as('ana.sitoe').post('/api/me/duty', { onDuty: true });
    await t.as('nadia.mussa').post(`/api/tickets/${inc!.ticketId}/cancel`, { reason: 'NMS false alarm' });
    const d = await detail(complaint.body.ticketId);
    expect(d).toMatchObject({ incident: null, status: 'assigned', assignee: { fullName: 'Ana Sitoe' } });
  });

  it('lets NOC link and unlink by hand, acknowledge, and text the linked customers', async () => {
    const [inc] = await send(alarm());
    const far = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: 'CC-M1',
      contractNo: '40188210',
      problemType: 'no_power_single',
      description: 'No power'
    });
    expect((await detail(far.body.ticketId)).incident).toBeNull();

    const linked = await t
      .as('nadia.mussa')
      .post(`/api/incidents/${inc!.ticketId}/link`, { ticketIds: [far.body.ticketId] });
    expect(linked.body.network.linkedTickets).toHaveLength(1);
    const sent = await t.as('nadia.mussa').post(`/api/incidents/${inc!.ticketId}/notify-customers`, {});
    expect(sent.body).toEqual({ sent: 1 });
    expect((await smsTo('+258841110002')).at(-1)).toContain('continua a trabalhar');

    const ack = await t.as('nadia.mussa').post(`/api/tickets/${inc!.ticketId}/acknowledge`);
    expect(ack.body.network).toMatchObject({ acknowledgedBy: 'Nádia Mussa' });
    expect((await t.as('nadia.mussa').post(`/api/tickets/${far.body.ticketId}/acknowledge`)).status).toBe(
      422
    );
    expect((await t.as('armando.cossa').post(`/api/tickets/${inc!.ticketId}/acknowledge`)).status).toBe(403);

    const unlinked = await t
      .as('nadia.mussa')
      .post(`/api/incidents/${inc!.ticketId}/unlink`, { ticketIds: [far.body.ticketId] });
    expect(unlinked.body.network.linkedTickets).toEqual([]);
    const badLink = await t
      .as('nadia.mussa')
      .post(`/api/incidents/${inc!.ticketId}/link`, { ticketIds: [inc!.ticketId] });
    expect(badLink.body.code).toBe('CANNOT_LINK');
  });

  it('takes network problems reported by the public, and lets NOC route those outside every area', async () => {
    const report = await t.as('call-center').post('/api/intake/call-center/network-reports', {
      externalRef: 'NR-1',
      reportType: 'cable_down',
      description: 'Cable on the ground, children nearby',
      address: 'Av. de Moçambique km 7',
      callerPhone: '+258849999999'
    });
    expect(report.status).toBe(201);
    const d = await detail(report.body.ticketId);
    expect(d).toMatchObject({ type: 'network_incident', source: 'call_center', priority: 1, teamId: null });
    expect((await smsTo('+258849999999'))[0]).toContain('Recebemos');

    const teams = (await t.as('nadia.mussa').get('/api/lookups')).body.teams;
    const south1 = teams.find((x: { name: string }) => x.name === 'South 1').id;
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const routed = await t
      .as('nadia.mussa')
      .post(`/api/tickets/${report.body.ticketId}/team`, { teamId: south1 });
    expect(routed.body).toMatchObject({
      teamName: 'South 1',
      status: 'assigned',
      assignee: { fullName: 'Armando Cossa' }
    });
    // Already in that team (moving it to another team is tested in office-tickets.test.ts).
    const again = await t
      .as('nadia.mussa')
      .post(`/api/tickets/${report.body.ticketId}/team`, { teamId: south1, reason: 'Again' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('SAME_TEAM');
    expect(
      (await t.as('helena.mondlane').post(`/api/tickets/${report.body.ticketId}/team`, { teamId: south1 }))
        .status
    ).toBe(403);
  });

  it('lets the network team plan work for a team, not assigned until the manager does, and tells the Call Center', async () => {
    const teams = (await t.as('nadia.mussa').get('/api/lookups')).body.teams;
    const south2 = teams.find((x: { name: string }) => x.name === 'South 2').id;
    await t.as('ofelia.tembe').post('/api/me/duty', { onDuty: true });
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    const day = tomorrow.toISOString().slice(0, 10);
    const work = {
      kind: 'maintenance',
      title: 'Replace transformer PT-1180',
      element: 'PT-1180 · Liberdade',
      teamId: south2,
      scheduledStart: `${day}T06:00:00Z`,
      scheduledEnd: `${day}T11:00:00Z`,
      outage: true,
      customersAffected: 240
    };
    const created = await t.as('carlos.nhantumbo').post('/api/planned-work', work);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      type: 'planned_work',
      status: 'new',
      teamName: 'South 2',
      dueAt: `${day}T11:00:00.000Z`,
      planned: { kind: 'maintenance', outage: true, customersAffected: 240, element: 'PT-1180 · Liberdade' }
    });

    const week = (
      await t
        .as('joao.matsinhe')
        .get(`/api/planned-work?from=${new Date().toISOString().slice(0, 10)}&to=${day}`)
    ).body;
    expect(week.map((w: { title: string }) => w.title)).toEqual(['Replace transformer PT-1180']);
    const outages = (await t.as('call-center').get('/api/intake/call-center/planned-outages')).body;
    expect(outages[0]).toMatchObject({ code: created.body.code, customersAffected: 240 });

    expect((await t.as('armando.cossa').post('/api/planned-work', work)).status).toBe(403);
    const backwards = await t
      .as('carlos.nhantumbo')
      .post('/api/planned-work', { ...work, scheduledEnd: work.scheduledStart });
    expect(backwards.status).toBe(400);
  });

  it('keeps every alarm, linked to its incident', async () => {
    const [r] = await send(alarm(), alarm({ elementCode: 'RMU-9', parentElementCode: 'F-12' }));
    const rows = await t.db.select().from(alarms).where(eq(alarms.ticketId, r!.ticketId!));
    expect(rows).toHaveLength(2);
    const [ticket] = await t.db.select().from(tickets).where(eq(tickets.id, r!.ticketId!));
    expect(ticket!.elementCode).toBe('F-12');
  });
});
