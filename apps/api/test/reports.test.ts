import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { tickets } from '../src/db/schema';
import { csvCell } from '../src/reports/reports.service';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Maputo' });

describe('reports and KPIs', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  async function complain(ref: string, contractNo = '40217735') {
    const res = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo,
      problemType: 'no_power_single',
      description: 'No power'
    });
    return res.body.ticketId as string;
  }
  async function fix(id: string) {
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    await t.as('armando.cossa').post(`/api/tickets/${id}/accept`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/start`);
    await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, { note: 'Replaced the fuse' });
  }
  const check = (ref: string, result: 'fixed' | 'not_fixed') =>
    t.as('call-center').post(`/api/intake/call-center/tickets/${ref}/check-result`, { result });

  /**
   * In South 1: CC-1 fixed on time and closed; CC-2 fixed after its time limit and closed; CC-3 found not fixed,
   * fixed again and closed; CC-4 still open. In South 2: CC-5, still open.
   */
  async function scenario() {
    const [a, b, c] = [await complain('CC-1'), await complain('CC-2'), await complain('CC-3')];
    await complain('CC-4');
    await complain('CC-5', '40188210');
    await fix(a);
    await check('CC-1', 'fixed');
    await t.db
      .update(tickets)
      .set({ dueAt: sql`now() - interval '1 minute'` })
      .where(eq(tickets.id, b));
    await fix(b);
    await check('CC-2', 'fixed');
    await fix(c);
    await check('CC-3', 'not_fixed');
    await t.as('helena.mondlane').post(`/api/tickets/${c}/assign`, { assigneeId: ids['armando.cossa'] });
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${c}/${step}`);
    await t.as('armando.cossa').post(`/api/tickets/${c}/resolve`, {
      note: 'The cable was loose too',
      materials: [{ itemId: await itemId('FUS-160'), quantity: 2 }]
    });
    await check('CC-3', 'fixed');
  }
  const itemId = async (code: string) =>
    ((await t.as('admin.edm').get('/api/stock/items')).body as { id: string; code: string }[]).find(
      (i) => i.code === code
    )!.id;

  it('works out the KPIs of the period from the tickets', async () => {
    await scenario();
    const res = await t.as('carla.manhica').get(`/api/reports?from=${today()}&to=${today()}`);
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r).toMatchObject({
      closed: 3,
      closedBefore: 0,
      received: 5,
      stillOpen: 2,
      onTimePct: 67,
      onTimeTarget: 90,
      firstTimePct: 67,
      perDay: [{ day: today(), closed: 3 }],
      byType: [{ type: 'customer_complaint', closed: 3 }]
    });
    expect(r.mttrMinutes).toBeGreaterThanOrEqual(0);
    expect(r.byTeam).toEqual([
      expect.objectContaining({ teamName: 'South 1', closed: 3, onTimePct: 67, reopenedPct: 33 })
    ]);
    expect(r.byStaff).toEqual([
      expect.objectContaining({ fullName: 'Armando Cossa', fixed: 3, onTimePct: 67, firstTimePct: 67 })
    ]);
    expect(r.materials).toEqual([expect.objectContaining({ code: 'FUS-160', quantity: 2, tickets: 1 })]);
  });

  it('shows team managers their own team only, and keeps field staff out', async () => {
    await scenario();
    const south2 = (await t.as('joao.matsinhe').get(`/api/reports?from=${today()}&to=${today()}`)).body;
    expect(south2).toMatchObject({ closed: 0, received: 1, stillOpen: 1, byTeam: [] });
    expect((await t.as('armando.cossa').get(`/api/reports?from=${today()}&to=${today()}`)).status).toBe(403);
    const bad = await t.as('carla.manhica').get(`/api/reports?from=2026-02-01&to=2026-01-01`);
    expect(bad.status).toBe(400);
  });

  it('counts the period before for the comparison, and empty days as zero', async () => {
    await scenario();
    const [y, m, d] = today().split('-').map(Number) as [number, number, number];
    const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const r = (await t.as('nadia.mussa').get(`/api/reports?from=${tomorrow}&to=${tomorrow}`)).body;
    expect(r).toMatchObject({ closed: 0, closedBefore: 3, perDay: [{ day: tomorrow, closed: 0 }] });
  });

  it('exports the tickets of the period as a CSV file Excel can open', async () => {
    await scenario();
    const res = await t
      .as('helena.mondlane')
      .get(`/api/reports/tickets.csv?from=${today()}&to=${today()}`)
      .then((r) => r);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`edm-tickets-${today()}-to-${today()}.csv`);
    const lines = res.text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    expect(lines[0]).toContain('Code,Type,Source,Status');
    expect(lines).toHaveLength(1 + 4); // South 1 only, for its team manager
    const reopened = lines.find((l) => l.includes('FUS-160 x2'))!;
    expect(reopened).toContain(',yes,1,');
  });

  it('keeps spreadsheet formulas out of the export', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-12')).toBe('-12');
    expect(csvCell('a, b')).toBe('"a, b"');
  });
});
