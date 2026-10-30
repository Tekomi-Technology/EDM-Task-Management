import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { notificationOutbox, tickets } from '../src/db/schema';
import { createTestApp, resetData, type TestContext } from './helpers';

/** Near customer 40217735 (Rosa Chissano, Matola). */
const MATOLA = { lat: -25.931, lng: 32.471 };

/** New ticket screen (W05): EDM staff who take a call themselves. */
describe('tickets entered by EDM staff', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetData(t.db);
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
  });

  const lookup = async (q: string) =>
    (await t.as('paulo.bo').get(`/api/customers/lookup?q=${encodeURIComponent(q)}`)).body;
  const rosa = async () => (await lookup('40217735'))[0] as { id: string };

  it('finds the caller by contract, phone (as people say it), meter number or name', async () => {
    const byContract = await lookup('40217735');
    expect(byContract).toEqual([
      expect.objectContaining({
        fullName: 'Rosa Chissano',
        contractNo: '40217735',
        areaName: 'Matola',
        teamName: 'South 1',
        openTickets: []
      })
    ]);
    expect((await lookup('84 111 0001'))[0]?.fullName).toBe('Rosa Chissano');
    expect((await lookup('Sitoe')).map((c: { fullName: string }) => c.fullName)).toEqual(['Manuel Sitoe']);

    // The meter on the customer's premises, written with or without spaces.
    expect((await lookup('0421 7735 901'))[0]).toMatchObject({
      fullName: 'Rosa Chissano',
      meterNumber: '04217735901'
    });
    expect(await lookup('nobody-like-this')).toEqual([]);
  });

  it('shows what will happen before creating: team, who goes, time limit and the SMS', async () => {
    const customerId = (await rosa()).id;
    const res = await t.as('paulo.bo').post('/api/tickets/preview', {
      type: 'customer_complaint',
      customerId,
      problemType: 'no_power_single'
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      team: { name: 'South 1' },
      areaName: 'Matola',
      assignee: { fullName: 'Armando Cossa', openJobs: 0 },
      priority: 2,
      slaMinutes: 240,
      incident: null,
      sms: { newJob: expect.stringContaining('Recebemos o seu pedido'), knownOutage: null }
    });
    expect(Date.parse(res.body.dueAt) - Date.now()).toBeGreaterThan(239 * 60_000);
    expect(await t.db.select().from(tickets)).toEqual([]); // nothing created

    const other = await t.as('paulo.bo').post('/api/tickets/preview', {
      type: 'customer_complaint',
      customerId,
      problemType: 'other',
      priority: 1
    });
    expect(other.body).toMatchObject({ priority: 1, slaMinutes: 120 });
  });

  it('creates the ticket, assigns it and texts the caller', async () => {
    const res = await t.as('paulo.bo').post('/api/tickets', {
      type: 'customer_complaint',
      customerId: (await rosa()).id,
      problemType: 'no_power_single',
      description: 'Whole house without power since 07:15. Neighbours have power.'
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'assigned', assigneeName: 'Armando Cossa', incident: null });
    const detail = (await t.as('helena.mondlane').get(`/api/tickets/${res.body.id}`)).body;
    expect(detail).toMatchObject({
      source: 'office',
      type: 'customer_complaint',
      title: 'No power, one home'
    });
    expect(detail.events[0]).toMatchObject({ type: 'created', actorName: 'Paulo Machava' });
    const texts = await t.db
      .select()
      .from(notificationOutbox)
      .where(eq(notificationOutbox.recipient, '+258841110001'));
    expect(texts.map((m) => m.body)).toEqual([expect.stringContaining(res.body.code)]);
  });

  it('asks whether it is the open incident nearby, and follows the answer', async () => {
    await t.as('nms').post('/api/intake/nms/alarms', {
      alarms: [
        {
          alarmId: 'A-1',
          event: 'raise',
          elementCode: 'PT-4471',
          elementName: 'Transformer PT-4471',
          alarmType: 'Voltage loss',
          severity: 'major',
          occurredAt: new Date().toISOString(),
          location: MATOLA
        }
      ]
    });
    const customerId = (await rosa()).id;
    const preview = (
      await t.as('paulo.bo').post('/api/tickets/preview', {
        type: 'customer_complaint',
        customerId,
        problemType: 'no_power_single'
      })
    ).body;
    expect(preview.incident).toMatchObject({ elementName: 'Transformer PT-4471', linkedCustomers: 0 });
    expect(preview.sms.knownOutage).toContain('Já sabemos da avaria');

    const joined = await t.as('paulo.bo').post('/api/tickets', {
      type: 'customer_complaint',
      customerId,
      problemType: 'no_power_single',
      description: 'No power'
    });
    expect(joined.body).toMatchObject({ status: 'new', incident: { id: preview.incident.id } });

    const separate = await t.as('paulo.bo').post('/api/tickets', {
      type: 'customer_complaint',
      customerId,
      problemType: 'no_power_single',
      description: 'No power, but only in the kitchen',
      joinIncident: false
    });
    expect(separate.body.incident).toBeNull();
    const [row] = await t.db.select().from(tickets).where(eq(tickets.id, separate.body.id));
    expect(row!.incidentId).toBeNull();
  });

  it('takes a report from a member of the public as a network ticket for the place', async () => {
    const res = await t.as('nadia.mussa').post('/api/tickets', {
      type: 'network_incident',
      reportType: 'cable_down',
      address: 'Rua 4, near the market, Matola Gare',
      location: MATOLA,
      description: 'Cable hanging over the road',
      callerName: 'João',
      callerPhone: '843334444'
    });
    expect(res.status).toBe(201);
    const detail = (await t.as('nadia.mussa').get(`/api/tickets/${res.body.id}`)).body;
    expect(detail).toMatchObject({
      type: 'network_incident',
      source: 'office',
      title: 'Cable down or hanging low',
      priority: 1,
      teamName: 'South 1'
    });
    expect(detail.description).toContain('Place: Rua 4, near the market');
    expect(detail.description).toContain('Reported by: João, 843334444');
  });

  it('is for office staff who take calls, and checks what is entered', async () => {
    const customerId = (await rosa()).id;
    const body = {
      type: 'customer_complaint',
      customerId,
      problemType: 'low_voltage',
      description: 'Lights flicker'
    };
    expect((await t.as('armando.cossa').post('/api/tickets', body)).status).toBe(403);
    expect((await t.as('carlos.nhantumbo').post('/api/tickets', body)).status).toBe(403);
    expect((await t.as('call-center').get('/api/customers/lookup?q=40217735')).status).toBe(403);
    expect((await t.as('paulo.bo').post('/api/tickets', { ...body, description: '' })).status).toBe(400);
    expect(
      (
        await t
          .as('paulo.bo')
          .post('/api/tickets', { ...body, customerId: '00000000-0000-4000-8000-0000000000aa' })
      ).status
    ).toBe(404);
  });

  it('takes an "other" ticket with the priority chosen, and lets the team manager check it', async () => {
    const res = await t.as('paulo.bo').post('/api/tickets', {
      type: 'other',
      title: 'Meter box door broken',
      description: 'The box is open to the street.',
      priority: 2,
      location: MATOLA
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'assigned', assigneeName: 'Armando Cossa' });
    const detail = (await t.as('helena.mondlane').get(`/api/tickets/${res.body.id}`)).body;
    expect(detail).toMatchObject({
      type: 'other',
      source: 'office',
      title: 'Meter box door broken',
      priority: 2
    });
    expect(Date.parse(detail.dueAt) - Date.now()).toBeGreaterThan(239 * 60_000);

    for (const step of ['accept', 'start'])
      await t.as('armando.cossa').post(`/api/tickets/${res.body.id}/${step}`);
    await t.as('armando.cossa').post(`/api/tickets/${res.body.id}/resolve`, { note: 'New door fitted' });
    // Another team's manager cannot check it; the team manager of the area can.
    expect((await t.as('joao.matsinhe').post(`/api/tickets/${res.body.id}/close`, {})).status).toBe(403);
    const closed = await t
      .as('helena.mondlane')
      .post(`/api/tickets/${res.body.id}/close`, { note: 'Checked' });
    expect(closed.body.status).toBe('closed');
  });

  const teamId = async (name: string) =>
    ((await t.as('nadia.mussa').get('/api/lookups')).body.teams as { id: string; name: string }[]).find(
      (x) => x.name === name
    )!.id;
  const otherTicket = {
    type: 'other',
    title: 'Meter box door broken',
    description: 'The box is open to the street.',
    priority: 2,
    location: MATOLA
  };
  type Event = { type: string; data: Record<string, unknown> };

  it('lets NOC, technical managers and administrators send a new ticket to another team, keeping the reason', async () => {
    const south2 = await teamId('South 2');
    const res = await t.as('carla.manhica').post('/api/tickets', {
      ...otherTicket,
      teamId: south2,
      teamReason: 'South 1 is on the big outage'
    });
    expect(res.status).toBe(201);
    // Nobody of South 2 is on duty: it waits for their manager instead of going to Armando (South 1).
    expect(res.body).toMatchObject({ status: 'new', assigneeName: null });
    const detail = (await t.as('nadia.mussa').get(`/api/tickets/${res.body.id}`)).body;
    // The team chosen goes; the place stays in its own area.
    expect(detail).toMatchObject({ teamId: south2, teamName: 'South 2', areaName: 'Matola' });
    const chosen = (detail.events as Event[]).find((e) => e.type === 'team_changed');
    expect(chosen?.data).toMatchObject({
      fromName: 'South 1',
      teamName: 'South 2',
      reason: 'South 1 is on the big outage',
      atCreation: true
    });
  });

  it('asks why another team goes, and lets only NOC, technical managers and administrators choose it', async () => {
    const body = { ...otherTicket, teamId: await teamId('South 2') };
    expect((await t.as('nadia.mussa').post('/api/tickets', body)).status).toBe(400);
    for (const who of ['paulo.bo', 'helena.mondlane'] as const) {
      expect(
        (await t.as(who).post('/api/tickets', { ...body, teamReason: 'Closer to the place' })).status
      ).toBe(403);
    }
  });

  it('shows the team of the place and the team chosen instead, before creating', async () => {
    const auto = await t
      .as('paulo.bo')
      .post('/api/tickets/preview', { type: 'other', priority: 2, location: MATOLA });
    expect(auto.body).toMatchObject({
      team: { name: 'South 1' },
      autoTeam: { name: 'South 1' },
      areaName: 'Matola'
    });
    const chosen = await t.as('nadia.mussa').post('/api/tickets/preview', {
      type: 'other',
      priority: 2,
      location: MATOLA,
      teamId: await teamId('South 2')
    });
    expect(chosen.body).toMatchObject({
      team: { name: 'South 2' },
      autoTeam: { name: 'South 1' },
      areaName: 'Matola'
    });
    // For forms with only a place (surveys): which team the place would get.
    const place = await t.as('carla.manhica').get(`/api/places/team?lat=${MATOLA.lat}&lng=${MATOLA.lng}`);
    expect(place.body).toMatchObject({ areaName: 'Matola', team: { name: 'South 1' } });
  });

  it('moves a ticket someone is working on to another team, with a reason, and tells that staff member', async () => {
    const south2 = await teamId('South 2');
    const id = (await t.as('paulo.bo').post('/api/tickets', otherTicket)).body.id as string;
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);

    expect((await t.as('nadia.mussa').post(`/api/tickets/${id}/team`, { teamId: south2 })).status).toBe(422);
    expect(
      (
        await t
          .as('helena.mondlane')
          .post(`/api/tickets/${id}/team`, { teamId: south2, reason: 'Closer team' })
      ).status
    ).toBe(403);
    const moved = await t
      .as('nadia.mussa')
      .post(`/api/tickets/${id}/team`, { teamId: south2, reason: 'The place was marked wrongly' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ teamId: south2, status: 'new', assignee: null });
    const event = (moved.body.events as Event[]).find((e) => e.type === 'team_changed');
    expect(event?.data).toMatchObject({
      fromName: 'South 1',
      teamName: 'South 2',
      reason: 'The place was marked wrongly',
      unassignedName: 'Armando Cossa'
    });
    const told = await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.ticketId, id));
    expect(told.some((m) => m.recipient === '+258840000006' && m.body.includes('passado'))).toBe(true);

    // Moving it to the team it is already in, or once the work is done, is refused.
    expect(
      (await t.as('nadia.mussa').post(`/api/tickets/${id}/team`, { teamId: south2, reason: 'Again' })).status
    ).toBe(422);
  });

  it('sends an "other" ticket with no place to NOC, and asks for a priority', async () => {
    const body = { type: 'other', title: 'Wrong address on a bill', description: 'Customer asks to fix it.' };
    expect((await t.as('paulo.bo').post('/api/tickets', body)).status).toBe(400);
    const res = await t.as('paulo.bo').post('/api/tickets', { ...body, priority: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'new', assigneeName: null });
    const inbox = (await t.as('nadia.mussa').get('/api/me/notifications')).body;
    expect(inbox.items[0]).toMatchObject({ title: expect.stringContaining(res.body.code) });

    // A team manager does not close customer complaints: the Call Center checks those.
    const complaint = await t.as('paulo.bo').post('/api/tickets', {
      type: 'customer_complaint',
      customerId: (await rosa()).id,
      problemType: 'low_voltage',
      description: 'Lights flicker'
    });
    const id = complaint.body.id as string;
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, { note: 'Tightened the neutral' });
    expect((await t.as('helena.mondlane').post(`/api/tickets/${id}/close`, {})).status).toBe(403);
  });
});
