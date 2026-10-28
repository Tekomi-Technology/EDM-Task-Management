import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, waitFor, type TestContext } from './helpers';
import {
  activationResultSchema,
  callCenterCheckResultSchema,
  callCenterComplaintSchema,
  connectionRequestSchema,
  networkReportSchema,
  nmsAlarmBatchSchema,
  reasonSchema,
  stockItemsSyncSchema,
  stockReceiptSyncSchema,
  surveyRequestSchema,
  type IntegrationDocs
} from '../src/contract';
import { mockServer } from './mock-server';

/** Connected systems (W17): what the other systems sent, what we sent them, and whether they answer. */
describe('connected systems', () => {
  let t: TestContext;
  let sales: Awaited<ReturnType<typeof mockServer>>;
  let salesAnswer = 200;
  beforeAll(async () => {
    sales = await mockServer(59873, () => ({ status: salesAnswer, body: '{}' }));
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
    await sales.close();
  });
  beforeEach(async () => {
    await resetData(t.db);
    salesAnswer = 200;
    t.identity.clients.set('nms-system', true);
  });

  const overview = async () => (await t.as('admin.edm').get('/api/integrations')).body;
  const card = async (system: string) =>
    (await overview()).systems.find((s: { system: string }) => s.system === system);
  const complaint = (ref: string) =>
    t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'no_power_single',
      description: 'No power'
    });
  const alarm = (id: string) => ({
    alarmId: id,
    event: 'raise',
    elementCode: 'F-12',
    alarmType: 'Breaker trip',
    severity: 'major',
    occurredAt: new Date().toISOString()
  });

  it('logs each request another system sends, by route, and counts the day’s work', async () => {
    expect((await complaint('CC-1')).status).toBe(201);
    // A status question about an unknown ticket is a normal answer, not a problem.
    expect((await t.as('call-center').get('/api/intake/call-center/tickets/NOPE')).status).toBe(404);

    const cc = await waitFor(
      () => card('call_center'),
      (c) => c.lastAt !== null
    );
    expect(cc).toMatchObject({ status: 'connected', today: '1 ticket received', note: null });
    expect((await card('nms')).status).toBe('quiet');
    // Test mode for SMS (SMS_PROVIDER=log in the tests).
    expect((await card('sms')).status).toBe('not_set');

    const log = (await t.as('admin.edm').get('/api/integrations/call_center/calls')).body;
    expect(log.map((c: { operation: string; statusCode: number }) => [c.operation, c.statusCode])).toEqual([
      ['GET /intake/call-center/tickets/:externalRef', 404],
      ['POST /intake/call-center/complaints', 201]
    ]);
    expect((await overview()).problems).toEqual([]);
  });

  it('shows a refused sign-in or unreadable data as a problem, solved once requests go through again', async () => {
    expect((await t.as('stranger').post('/api/intake/nms/alarms', { alarms: [alarm('A-1')] })).status).toBe(
      403
    );
    expect((await t.as('nms').post('/api/intake/nms/alarms', { alarms: [{ alarmId: 'A-2' }] })).status).toBe(
      400
    );

    const before = await waitFor(overview, (o) => o.problems.length === 2);
    expect(before.problems[0]).toMatchObject({ system: 'nms', count: 1, solved: false });
    expect(before.problems.map((p: { message: string }) => p.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^1 request refused: FORBIDDEN/)])
    );
    expect((await card('nms')).status).toBe('connected'); // bad data is their mistake, not a broken link

    await t.as('stranger').post('/api/intake/nms/alarms', { alarms: [alarm('A-3')] });
    expect(
      await waitFor(
        () => card('nms'),
        (c) => c.status === 'problem'
      )
    ).toMatchObject({ status: 'problem', note: expect.stringContaining('FORBIDDEN') });

    expect((await t.as('nms').post('/api/intake/nms/alarms', { alarms: [alarm('A-4')] })).status).toBe(200);
    const after = await waitFor(overview, (o) => o.problems.every((p: { solved: boolean }) => p.solved));
    expect(after.problems.every((p: { solved: boolean }) => p.solved)).toBe(true);
    expect((await card('nms')).status).toBe('connected');
  });

  it('logs the SMS sent out', async () => {
    await complaint('CC-1'); // texts the customer
    const sms = await waitFor(
      async () => (await t.as('admin.edm').get('/api/integrations/sms/calls')).body,
      (rows: unknown[]) => rows.length > 0
    );
    expect(sms[0]).toMatchObject({ direction: 'out', operation: 'SMS', ok: true });
  });

  it('tests the connection: the sign-in account of systems that call us, a ping to the ones we call', async () => {
    const test = async (system: string) =>
      (await t.as('carla.manhica').post(`/api/integrations/${system}/test`)).body;
    expect(await test('nms')).toMatchObject({ ok: true, message: "The NMS's sign-in account is enabled." });
    t.identity.clients.set('nms-system', false);
    expect(await test('nms')).toMatchObject({ ok: false, message: expect.stringContaining('disabled') });

    const sales_ = await test('sales');
    expect(sales_).toMatchObject({ ok: true, message: expect.stringContaining('accepted a test event') });
    const ping = sales.received.at(-1)!;
    expect(ping.headers['x-edm-event']).toBe('ping');
    expect(ping.headers['x-edm-signature']).toMatch(/^sha256=/);
    salesAnswer = 503;
    expect(await test('sales')).toMatchObject({ ok: false, message: expect.stringContaining('503') });

    expect(await test('sms')).toMatchObject({ ok: true, message: expect.stringContaining('Test mode') });
    expect((await t.as('admin.edm').post('/api/integrations/teams/test')).status).toBe(400);
    expect((await t.as('helena.mondlane').get('/api/integrations')).status).toBe(403);
  });

  it('documents the integration APIs for administrators, with examples that the API accepts', async () => {
    const res = await t.as('admin.edm').get('/api/integrations/docs');
    expect(res.status).toBe(200);
    const docs = res.body as IntegrationDocs;
    expect(docs.tokenUrl).toMatch(/\/realms\/edm\/protocol\/openid-connect\/token$/);
    expect(docs.systems.map((s) => [s.system, s.clientId])).toEqual([
      ['call_center', 'call-center-system'],
      ['sales', 'sales-system'],
      ['nms', 'nms-system'],
      ['stock', 'stock-system']
    ]);

    const sales = docs.systems.find((s) => s.system === 'sales')!;
    const survey = sales.operations.find((o) => o.path === '/api/intake/sales/survey-requests')!;
    expect(survey.method).toBe('POST');
    expect(survey.fields.find((f) => f.name === 'customer.fullName')).toMatchObject({
      in: 'body',
      required: true,
      description: 'Customer or company name.',
      min: 2,
      max: 200
    });
    expect(survey.fields.find((f) => f.name === 'premises')?.values).toContain('shop');
    expect(sales.webhooks.map((w) => w.event)).toEqual([
      'survey_completed',
      'connection_installed',
      'request_cancelled'
    ]);
    const nms = docs.systems.find((s) => s.system === 'nms')!;
    expect(nms.operations[0]!.fields.find((f) => f.name === 'alarms[].severity')?.required).toBe(true);
    const stock = docs.systems.find((s) => s.system === 'stock')!;
    expect(stock.operations.find((o) => o.path.endsWith('/consumption'))!.fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'since', in: 'query', required: true })])
    );

    // Every example body is valid as it is, so it can be copied.
    const schemas = {
      '/api/intake/call-center/complaints': callCenterComplaintSchema,
      '/api/intake/call-center/network-reports': networkReportSchema,
      '/api/intake/call-center/tickets/{externalRef}/check-result': callCenterCheckResultSchema,
      '/api/intake/call-center/tickets/{externalRef}/cancel': reasonSchema,
      '/api/intake/sales/survey-requests': surveyRequestSchema,
      '/api/intake/sales/connection-requests': connectionRequestSchema,
      '/api/intake/sales/connections/{externalRef}/activation': activationResultSchema,
      '/api/intake/nms/alarms': nmsAlarmBatchSchema,
      '/api/intake/stock/receipts': stockReceiptSyncSchema,
      '/api/intake/stock/items': stockItemsSyncSchema
    } as const;
    const withBody = docs.systems.flatMap((s) => s.operations).filter((o) => o.example !== null);
    expect(withBody.map((o) => o.path).sort()).toEqual(Object.keys(schemas).sort());
    for (const o of withBody) {
      expect(schemas[o.path as keyof typeof schemas].safeParse(o.example).success, o.path).toBe(true);
    }

    expect((await t.as('helena.mondlane').get('/api/integrations/docs')).status).toBe(403);
  });
});
