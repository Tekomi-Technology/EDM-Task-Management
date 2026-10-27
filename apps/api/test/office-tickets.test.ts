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
      caller: 'customer',
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
      caller: 'customer',
      customerId,
      problemType: 'other',
      priority: 1
    });
    expect(other.body).toMatchObject({ priority: 1, slaMinutes: 120 });
  });

  it('creates the ticket, assigns it and texts the caller', async () => {
    const res = await t.as('paulo.bo').post('/api/tickets', {
      caller: 'customer',
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
      await t
        .as('paulo.bo')
        .post('/api/tickets/preview', { caller: 'customer', customerId, problemType: 'no_power_single' })
    ).body;
    expect(preview.incident).toMatchObject({ elementName: 'Transformer PT-4471', linkedCustomers: 0 });
    expect(preview.sms.knownOutage).toContain('Já sabemos da avaria');

    const joined = await t.as('paulo.bo').post('/api/tickets', {
      caller: 'customer',
      customerId,
      problemType: 'no_power_single',
      description: 'No power'
    });
    expect(joined.body).toMatchObject({ status: 'new', incident: { id: preview.incident.id } });

    const separate = await t.as('paulo.bo').post('/api/tickets', {
      caller: 'customer',
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
      caller: 'public',
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
      caller: 'customer',
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
});
