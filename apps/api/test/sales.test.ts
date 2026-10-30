import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { customers, notificationOutbox } from '../src/db/schema';
import { createTestApp, ids, JPEG, resetData, waitFor, type TestContext } from './helpers';
import { mockServer, type Received } from './mock-server';

const PROSPECT_PHONE = '+258849000001';
const MATOLA = { lat: -25.931, lng: 32.471 };

const survey = (ref: string, overrides: object = {}) => ({
  externalRef: ref,
  customer: {
    fullName: 'Loja Esperança',
    phone: PROSPECT_PHONE,
    address: 'Matola Gare, Rua 4',
    location: MATOLA
  },
  premises: 'shop',
  supply: 'single_phase',
  requestedLoadKw: 6,
  ...overrides
});

describe('new customers from the Sales system: survey, connection, handover, activation', () => {
  let t: TestContext;
  let sales: Awaited<ReturnType<typeof mockServer>>;
  let items: Record<string, string>;
  beforeAll(async () => {
    sales = await mockServer(59873, () => ({ status: 200, body: '{"ok":true}' }));
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
    await sales.close();
  });
  beforeEach(async () => {
    await resetData(t.db);
    sales.received.length = 0;
    items = Object.fromEntries(
      ((await t.as('admin.edm').get('/api/stock/items')).body as { id: string; code: string }[]).map((i) => [
        i.code,
        i.id
      ])
    );
  });

  const smsTo = async (phone: string) =>
    (await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.recipient, phone))).map(
      (r) => r.body
    );
  const webhooks = () =>
    waitFor(
      async () => sales.received,
      (r) => r.length > 0
    );
  const event = (r: Received) =>
    JSON.parse(r.body) as { event: string; externalRef: string; data: Record<string, unknown> };

  async function doSurvey(ref: string, result: 'feasible' | 'feasible_with_works' | 'not_feasible') {
    await t.as('ana.sitoe').post('/api/me/duty', { onDuty: true });
    const created = await t.as('sales').post('/api/intake/sales/survey-requests', survey(ref));
    const id = created.body.ticketId as string;
    for (const step of ['accept', 'start']) await t.as('ana.sitoe').post(`/api/tickets/${id}/${step}`);
    const done = await t.as('ana.sitoe').post(`/api/tickets/${id}/resolve`, {
      note: 'Pole P-77 at 35 m; service cable needed',
      survey: {
        result,
        distanceToNetworkM: 35,
        nearestElement: 'P-77',
        worksNeeded: result === 'feasible' ? undefined : 'One new pole',
        estimatedMaterials: [
          { itemId: items['CAB-216'], quantity: 40 },
          { itemId: items['MTR-P1'], quantity: 1 }
        ]
      }
    });
    return { id, done };
  }

  it('turns a survey request into a job for the area, tells the prospect, and ignores repeats', async () => {
    await t.as('ana.sitoe').post('/api/me/duty', { onDuty: true });
    const first = await t.as('sales').post('/api/intake/sales/survey-requests', survey('S-1'));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ kind: 'survey', status: 'assigned', assigneeName: 'Ana Sitoe' });
    expect((await t.as('sales').post('/api/intake/sales/survey-requests', survey('S-1'))).status).toBe(200);
    const d = (await t.as('helena.mondlane').get(`/api/tickets/${first.body.ticketId}`)).body;
    expect(d).toMatchObject({
      type: 'new_customer_survey',
      title: 'Survey for new shop',
      teamName: 'South 1',
      customer: { fullName: 'Loja Esperança', contractNo: null },
      newCustomer: { kind: 'survey', premises: 'shop', supply: 'single_phase', requestedLoadKw: 6 }
    });
    expect((await smsTo(PROSPECT_PHONE))[0]).toContain('vistoria');
    expect((await t.as('call-center').post('/api/intake/sales/survey-requests', survey('S-2'))).status).toBe(
      403
    );
  });

  it('closes the survey when the report is sent, and posts the result to Sales, signed', async () => {
    const { id: noReport } = await (async () => {
      await t.as('ana.sitoe').post('/api/me/duty', { onDuty: true });
      const c = await t.as('sales').post('/api/intake/sales/survey-requests', survey('S-0'));
      for (const step of ['accept', 'start'])
        await t.as('ana.sitoe').post(`/api/tickets/${c.body.ticketId}/${step}`);
      return { id: c.body.ticketId as string };
    })();
    const missing = await t.as('ana.sitoe').post(`/api/tickets/${noReport}/resolve`, { note: 'Done' });
    expect(missing.body.code).toBe('SURVEY_REPORT_REQUIRED');

    const { id, done } = await doSurvey('S-3', 'feasible_with_works');
    expect(done.body.status).toBe('closed');
    expect(done.body.newCustomer.survey).toMatchObject({
      result: 'feasible_with_works',
      nearestElement: 'P-77',
      estimatedMaterials: [
        expect.objectContaining({ code: 'CAB-216', quantity: 40 }),
        expect.objectContaining({ code: 'MTR-P1' })
      ]
    });

    const [hook] = await webhooks();
    expect(hook!.headers['x-edm-event']).toBe('survey_completed');
    expect(hook!.headers['x-edm-signature']).toBe(
      `sha256=${createHmac('sha256', 'test-webhook-secret').update(hook!.body).digest('hex')}`
    );
    expect(event(hook!)).toMatchObject({
      event: 'survey_completed',
      externalRef: 'S-3',
      data: {
        result: 'feasible_with_works',
        distanceToNetworkM: 35,
        estimatedMaterials: expect.arrayContaining([
          expect.objectContaining({ code: 'CAB-216', quantity: 40 })
        ])
      }
    });
    const status = (await t.as('sales').get('/api/intake/sales/requests/S-3')).body;
    expect(status).toMatchObject({
      kind: 'survey',
      status: 'closed',
      survey: { result: 'feasible_with_works' }
    });
    expect((await smsTo(PROSPECT_PHONE)).at(-1)).toContain('vistoria');
    expect(id).toBeTruthy();
  });

  it('builds the connection after the contract, with the surveyed customer and the estimate set aside', async () => {
    await doSurvey('S-4', 'feasible');
    const conn = await t.as('sales').post('/api/intake/sales/connection-requests', {
      externalRef: 'C-4',
      contractNo: '88213',
      surveyRef: 'S-4',
      supply: 'single_phase'
    });
    expect(conn.status).toBe(201);
    const d = (await t.as('helena.mondlane').get(`/api/tickets/${conn.body.ticketId}`)).body;
    expect(d).toMatchObject({
      type: 'new_connection',
      title: 'New connection, contract 88213',
      customer: { fullName: 'Loja Esperança', contractNo: '88213' },
      newCustomer: { kind: 'connection', contractNo: '88213', surveyTicket: { code: expect.any(String) } }
    });
    expect(d.reservations.map((r: { code: string; quantity: number }) => [r.code, r.quantity])).toEqual(
      expect.arrayContaining([
        ['CAB-216', 40],
        ['MTR-P1', 1]
      ])
    );
    const [customer] = await t.db.select().from(customers).where(eq(customers.contractNo, '88213'));
    expect(customer!.fullName).toBe('Loja Esperança');

    const board = (await t.as('helena.mondlane').get('/api/new-customers')).body;
    expect(board.map((c: { stage: string; title: string }) => [c.stage, c.title])).toEqual([
      ['contract_signed', 'Contract 88213']
    ]);
  });

  it('refuses a connection the survey found not feasible', async () => {
    await doSurvey('S-5', 'not_feasible');
    const res = await t.as('sales').post('/api/intake/sales/connection-requests', {
      externalRef: 'C-5',
      contractNo: '88214',
      surveyRef: 'S-5',
      supply: 'single_phase'
    });
    expect(res.body.code).toBe('NOT_FEASIBLE');
  });

  it('confirms the handover with a code texted to the customer, then Sales activates the service', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const conn = await t.as('sales').post('/api/intake/sales/connection-requests', {
      externalRef: 'C-6',
      contractNo: '88219',
      customer: {
        fullName: 'Fátima Cuna',
        phone: PROSPECT_PHONE,
        address: 'Matola, Liberdade',
        location: MATOLA
      },
      premises: 'home',
      supply: 'single_phase'
    });
    const id = conn.body.ticketId as string;
    expect((await t.as('armando.cossa').post(`/api/tickets/${id}/handover-code`)).status).toBe(409); // not started yet
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);

    expect((await t.as('armando.cossa').post(`/api/tickets/${id}/handover-code`)).status).toBe(200);
    expect((await t.as('armando.cossa').post(`/api/tickets/${id}/handover-code`)).body.code).toBe('TOO_SOON');
    const code = (await smsTo(PROSPECT_PHONE)).at(-1)!.match(/\b(\d{4})\b/)![1]!;

    const finish = (handoverCode: string) =>
      t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
        note: 'Meter installed and tested',
        materials: [{ itemId: items['MTR-P1'], quantity: 1 }],
        installation: { meterNumber: 'MP-0049912', handoverCode }
      });
    const wrong = await finish(code === '0000' ? '1111' : '0000');
    expect(wrong.body.code).toBe('HANDOVER_CODE_WRONG');
    const right = await finish(code);
    expect(right.body).toMatchObject({
      status: 'resolved',
      newCustomer: { installation: { meterNumber: 'MP-0049912', confirmedBy: 'sms_code' } }
    });
    const [hook] = await webhooks();
    expect(event(hook!)).toMatchObject({
      event: 'connection_installed',
      externalRef: 'C-6',
      data: { meterNumber: 'MP-0049912' }
    });

    const board = (await t.as('helena.mondlane').get('/api/new-customers')).body;
    expect(board[0]).toMatchObject({ stage: 'connected', badge: 'Waiting for activation' });

    expect(
      (await t.as('sales').post('/api/intake/sales/connections/C-6/activation', { activated: true })).body
    ).toMatchObject({
      status: 'closed',
      activatedAt: expect.any(String)
    });
    expect((await smsTo(PROSPECT_PHONE)).at(-1)).toContain('está ativa');
    const closed = (await t.as('helena.mondlane').get(`/api/tickets/${id}`)).body;
    expect(closed.materials[0]).toMatchObject({ code: 'MTR-P1', posted: true });
    const used = (await t.as('helena.mondlane').get('/api/stock/movements?kind=consume')).body;
    expect(used[0]).toMatchObject({ itemCode: 'MTR-P1', actorName: 'Armando Cossa' });
  });

  it('accepts a signed form photo instead of the code, and sends a failed activation back to the team', async () => {
    const conn = await t.as('sales').post('/api/intake/sales/connection-requests', {
      externalRef: 'C-7',
      contractNo: '88220',
      customer: { fullName: 'Celso Macuácua', address: 'Matola', location: MATOLA },
      supply: 'single_phase'
    });
    const id = conn.body.ticketId as string;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);
    expect((await t.as('armando.cossa').post(`/api/tickets/${id}/handover-code`)).body.code).toBe(
      'NO_CUSTOMER_PHONE'
    );

    const upload = await t.as('armando.cossa').post(`/api/tickets/${id}/attachments`, {
      fileName: 'handover.jpg',
      contentType: 'image/jpeg',
      size: 4
    });
    const formId = upload.body.attachmentId as string;
    const notAttached = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'Done',
      installation: { meterNumber: 'MP-1', signedFormAttachmentId: formId }
    });
    expect(notAttached.body.code).toBe('HANDOVER_NOT_CONFIRMED');
    await fetch(upload.body.uploadUrl, { method: 'PUT', headers: upload.body.headers, body: JPEG });
    // A meter already recorded for another customer (Rosa's) is a typing mistake, not a second home for it.
    const taken = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'Done',
      attachmentIds: [formId],
      installation: { meterNumber: '04217735901', signedFormAttachmentId: formId }
    });
    expect(taken.body.code).toBe('METER_IN_USE');
    const ok = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'Done',
      attachmentIds: [formId],
      installation: { meterNumber: 'MP-1', signedFormAttachmentId: formId }
    });
    expect(ok.body.newCustomer.installation.confirmedBy).toBe('signed_form');
    // The meter is now the customer's: shown on their tickets and found by the New ticket screen.
    expect(ok.body.customer).toMatchObject({ fullName: 'Celso Macuácua', meterNumber: 'MP-1' });

    const failed = await t.as('sales').post('/api/intake/sales/connections/C-7/activation', {
      activated: false,
      note: 'Meter not in billing yet'
    });
    // Back to the team: reopened and given out again straight away.
    expect(failed.body.status).toBe('assigned');
  });

  it('lets the office send a survey or a connection to another team than the one of the place, with the reason', async () => {
    const teams = (await t.as('carla.manhica').get('/api/lookups')).body.teams as {
      id: string;
      name: string;
    }[];
    const south2 = teams.find((x) => x.name === 'South 2')!.id;
    const form: Record<string, unknown> = { ...survey('unused'), teamId: south2 };
    delete form.externalRef;
    expect((await t.as('carla.manhica').post('/api/new-customers/surveys', form)).status).toBe(400);
    const made = await t
      .as('carla.manhica')
      .post('/api/new-customers/surveys', { ...form, teamReason: 'South 1 is on the outage' });
    expect(made.status).toBe(201);
    const surveyed = (await t.as('carla.manhica').get(`/api/tickets/${made.body.id}`)).body;
    expect(surveyed).toMatchObject({ teamName: 'South 2' });
    expect(
      (surveyed.events as { type: string; data: Record<string, unknown> }[]).find(
        (e) => e.type === 'team_changed'
      )?.data
    ).toMatchObject({ teamName: 'South 2', reason: 'South 1 is on the outage', atCreation: true });

    const conn = await t.as('carla.manhica').post('/api/new-customers/connections', {
      contractNo: '88302',
      customer: {
        fullName: 'Escola Primária',
        address: 'Matola Gare, Rua 4',
        location: { lat: -25.915, lng: 32.455 }
      },
      supply: 'single_phase',
      teamId: south2,
      teamReason: 'South 2 has the meters'
    });
    expect(conn.status).toBe(201);
    expect((await t.as('carla.manhica').get(`/api/tickets/${conn.body.id}`)).body).toMatchObject({
      teamName: 'South 2'
    });
  });

  it('takes a survey and a connection typed in by the office, without Sales, checked by the Call Center queue', async () => {
    await t.as('armando.cossa').post('/api/me/duty', { onDuty: true });
    const form: Record<string, unknown> = survey('unused');
    delete form.externalRef;
    expect((await t.as('helena.mondlane').post('/api/new-customers/surveys', form)).status).toBe(403);
    const made = await t.as('carla.manhica').post('/api/new-customers/surveys', form);
    expect(made.status).toBe(201);
    const surveyed = (await t.as('carla.manhica').get(`/api/tickets/${made.body.id}`)).body;
    expect(surveyed).toMatchObject({ type: 'new_customer_survey', source: 'office', code: made.body.code });

    const conn = await t.as('carla.manhica').post('/api/new-customers/connections', {
      contractNo: '88301',
      surveyTicketId: made.body.id,
      supply: 'single_phase'
    });
    expect(conn.status).toBe(201);
    const id = conn.body.id as string;
    const detail = (await t.as('carla.manhica').get(`/api/tickets/${id}`)).body;
    expect(detail).toMatchObject({
      type: 'new_connection',
      source: 'office',
      customer: { fullName: 'Loja Esperança' }
    });

    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/handover-code`);
    const code = (await smsTo(PROSPECT_PHONE)).at(-1)!.match(/\b(\d{4})\b/)![1]!;
    const done = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'Meter installed',
      installation: { meterNumber: 'MP-0050001', handoverCode: code }
    });
    expect(done.body.status).toBe('resolved');
    // Nothing goes to Sales: it never asked for this connection.
    expect(
      await t.db.select().from(notificationOutbox).where(eq(notificationOutbox.channel, 'webhook'))
    ).toEqual([]);
    // A team manager does not close connections; NOC records what the customer said.
    expect((await t.as('helena.mondlane').post(`/api/tickets/${id}/close`, {})).status).toBe(403);
    const closed = await t.as('nadia.mussa').post(`/api/tickets/${id}/close`, { note: 'Customer has power' });
    expect(closed.body).toMatchObject({ status: 'closed' });

    expect(
      (
        await t.as('carla.manhica').post('/api/new-customers/connections', {
          contractNo: '88302',
          supply: 'single_phase'
        })
      ).status
    ).toBe(400);
  });
});
