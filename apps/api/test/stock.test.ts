import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

interface Item {
  id: string;
  code: string;
  inDepots: number;
  inVans: number;
  reserved: number;
  level: string;
}
interface Loc {
  id: string;
  code: string;
}

describe('stock: a ledger of depots and vans, deducted when jobs close', () => {
  let t: TestContext;
  let items: Record<string, Item>;
  let locs: Record<string, Loc>;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetData(t.db);
    items = Object.fromEntries(
      ((await t.as('admin.edm').get('/api/stock/items')).body as Item[]).map((i) => [i.code, i])
    );
    locs = Object.fromEntries(
      ((await t.as('admin.edm').get('/api/stock/locations')).body as Loc[]).map((l) => [l.code, l])
    );
  });

  const stockAt = async (code: string) =>
    Object.fromEntries(
      (
        (await t.as('admin.edm').get(`/api/stock/locations/${locs[code]!.id}`)).body as {
          code: string;
          quantity: number;
          reserved: number;
        }[]
      ).map((l) => [l.code, l])
    );

  async function complaintFor(ref: string) {
    const c = await t.as('call-center').post('/api/intake/call-center/complaints', {
      externalRef: ref,
      contractNo: '40217735',
      problemType: 'prepaid_meter',
      description: 'Meter'
    });
    const id = c.body.ticketId as string;
    await t.as('helena.mondlane').post(`/api/tickets/${id}/assign`, { assigneeId: ids['armando.cossa'] });
    for (const step of ['accept', 'start']) await t.as('armando.cossa').post(`/api/tickets/${id}/${step}`);
    return id;
  }

  it('shows the catalogue with what is in depots and vans, and which items are running low', () => {
    expect(items['CAB-216']).toMatchObject({ inDepots: 1840, inVans: 370, reserved: 0, level: 'good' });
    expect(items['TRF-250']).toMatchObject({ inDepots: 1, level: 'low' });
    expect(items['CON-PC1']).toMatchObject({ inDepots: 86, inVans: 100, level: 'watch' });
  });

  it('only lets office roles see stock, and team managers move only their own', async () => {
    expect((await t.as('armando.cossa').get('/api/stock/items')).status).toBe(403);
    const lines = [{ itemId: items['FUS-160']!.id, quantity: 20 }];
    const ok = await t
      .as('helena.mondlane')
      .post('/api/stock/receive', { locationId: locs['DEP-MATOLA']!.id, lines, reference: 'GR-1' });
    expect(ok.status).toBe(200);
    expect((await stockAt('DEP-MATOLA'))['FUS-160'].quantity).toBe(38);
    const other = await t
      .as('helena.mondlane')
      .post('/api/stock/receive', { locationId: locs['DEP-MAPUTO']!.id, lines });
    expect([other.status, other.body.code]).toEqual([403, 'NOT_IN_TEAM']);
    const van = await t
      .as('admin.edm')
      .post('/api/stock/receive', { locationId: locs['VAN-MPT-24-17']!.id, lines });
    expect(van.body.code).toBe('NOT_A_DEPOT');
  });

  it('gives stock to a van, never more than is there and not reserved', async () => {
    const give = (quantity: number) =>
      t.as('helena.mondlane').post('/api/stock/transfer', {
        fromLocationId: locs['DEP-MATOLA']!.id,
        toLocationId: locs['VAN-MPT-24-17']!.id,
        lines: [{ itemId: items['MTR-P1']!.id, quantity }]
      });
    expect((await give(4)).status).toBe(200);
    expect((await stockAt('VAN-MPT-24-17'))['MTR-P1'].quantity).toBe(10);
    expect((await stockAt('DEP-MATOLA'))['MTR-P1'].quantity).toBe(30);
    const tooMuch = await give(31);
    expect([tooMuch.status, tooMuch.body.code, tooMuch.body.details.available]).toEqual([
      422,
      'NOT_ENOUGH_STOCK',
      30
    ]);
  });

  it('records a stock-take as an adjustment', async () => {
    const res = await t.as('helena.mondlane').post('/api/stock/adjust', {
      locationId: locs['DEP-MATOLA']!.id,
      itemId: items['CON-PC1']!.id,
      countedQuantity: 80,
      reason: 'Monthly count'
    });
    expect(res.body).toEqual({ difference: -6 });
    expect((await stockAt('DEP-MATOLA'))['CON-PC1'].quantity).toBe(80);
    const moves = (await t.as('admin.edm').get('/api/stock/movements?kind=adjust')).body;
    expect(moves[0]).toMatchObject({
      itemCode: 'CON-PC1',
      quantity: 6,
      from: 'Matola depot',
      to: null,
      note: 'Monthly count'
    });
  });

  it('takes the materials used on a job from the staff member’s van only when the ticket closes', async () => {
    const id = await complaintFor('CC-S1');
    const resolved = await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'Replaced the cable',
      materials: [
        { itemId: items['CAB-216']!.id, quantity: 12 },
        { itemId: items['CON-PC1']!.id, quantity: 2 }
      ]
    });
    expect(resolved.body.materials).toEqual([
      expect.objectContaining({
        code: 'CAB-216',
        quantity: 12,
        fromLocation: 'Van MPT-24-17',
        posted: false
      }),
      expect.objectContaining({ code: 'CON-PC1', quantity: 2, posted: false })
    ]);
    expect((await stockAt('VAN-MPT-24-17'))['CAB-216'].quantity).toBe(150);

    await t.as('call-center').post('/api/intake/call-center/tickets/CC-S1/check-result', { result: 'fixed' });
    expect((await stockAt('VAN-MPT-24-17'))['CAB-216'].quantity).toBe(138);
    const d = (await t.as('helena.mondlane').get(`/api/tickets/${id}`)).body;
    expect(d.materials.every((m: { posted: boolean }) => m.posted)).toBe(true);
    const moves = (await t.as('admin.edm').get('/api/stock/movements?kind=consume')).body;
    expect(moves.map((m: { itemCode: string; ticket: { id: string } }) => [m.itemCode, m.ticket.id])).toEqual(
      expect.arrayContaining([
        ['CAB-216', id],
        ['CON-PC1', id]
      ])
    );
  });

  it('deducts nothing for a cancelled job, and notes a van that runs below zero', async () => {
    const cancelled = await complaintFor('CC-S2');
    await t.as('armando.cossa').post(`/api/tickets/${cancelled}/resolve`, {
      note: 'Done',
      materials: [{ itemId: items['MTR-P1']!.id, quantity: 1 }]
    });
    await t.as('nadia.mussa').post(`/api/tickets/${cancelled}/cancel`, { reason: 'Duplicate' });
    expect((await stockAt('VAN-MPT-24-17'))['MTR-P1'].quantity).toBe(6);

    const short = await complaintFor('CC-S3');
    await t.as('armando.cossa').post(`/api/tickets/${short}/resolve`, {
      note: 'Used meters not in the books',
      materials: [{ itemId: items['MTR-P1']!.id, quantity: 8 }]
    });
    await t.as('call-center').post('/api/intake/call-center/tickets/CC-S3/check-result', { result: 'fixed' });
    expect((await stockAt('VAN-MPT-24-17'))['MTR-P1'].quantity).toBe(-2);
    const events = (await t.as('nadia.mussa').get(`/api/tickets/${short}`)).body.events;
    expect(events.at(-1)).toMatchObject({
      type: 'stock_short',
      data: { items: [expect.objectContaining({ code: 'MTR-P1', quantity: 2 })] }
    });
  });

  it('sets material aside for a ticket and frees it when the ticket is cancelled', async () => {
    const teams = (await t.as('nadia.mussa').get('/api/lookups')).body.teams;
    const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const work = await t.as('carlos.nhantumbo').post('/api/planned-work', {
      kind: 'maintenance',
      title: 'Replace transformer PT-1180',
      element: 'PT-1180',
      teamId: teams.find((x: { name: string }) => x.name === 'South 1').id,
      scheduledStart: `${day}T06:00:00Z`,
      scheduledEnd: `${day}T11:00:00Z`
    });
    const reserve = (quantity: number) =>
      t.as('carlos.nhantumbo').post(`/api/tickets/${work.body.id}/reservations`, {
        lines: [{ itemId: items['POL-W9']!.id, quantity }]
      });
    const ok = await reserve(2);
    expect(ok.body.reservations).toEqual([
      expect.objectContaining({ code: 'POL-W9', quantity: 2, locationName: 'Matola depot' })
    ]);
    expect((await stockAt('DEP-MATOLA'))['POL-W9']).toMatchObject({ quantity: 12, reserved: 2 });
    expect((await reserve(11)).body.code).toBe('NOT_ENOUGH_STOCK');

    await t.as('nadia.mussa').post(`/api/tickets/${work.body.id}/cancel`, { reason: 'Postponed' });
    expect((await stockAt('DEP-MATOLA'))['POL-W9'].reserved).toBe(0);
  });

  it('gives vans to staff of their team, one van per person, and shows a staff member their van', async () => {
    const vans = (await t.as('helena.mondlane').get('/api/vehicles')).body;
    expect(
      vans.map((v: { plate: string; assignedTo: { fullName: string } }) => [v.plate, v.assignedTo?.fullName])
    ).toEqual([
      ['MPT-24-17', 'Armando Cossa'],
      ['MPT-24-18', 'Ana Sitoe']
    ]);
    const second = vans.find((v: { plate: string }) => v.plate === 'MPT-24-18');
    await t.as('helena.mondlane').post(`/api/vehicles/${second.id}/assign`, { userId: ids['armando.cossa'] });
    const after = (await t.as('helena.mondlane').get('/api/vehicles')).body;
    expect(
      after.map((v: { plate: string; assignedTo: { fullName: string } | null }) => [
        v.plate,
        v.assignedTo?.fullName ?? null
      ])
    ).toEqual([
      ['MPT-24-17', null],
      ['MPT-24-18', 'Armando Cossa']
    ]);
    const wrongTeam = await t
      .as('helena.mondlane')
      .post(`/api/vehicles/${second.id}/assign`, { userId: ids['ofelia.tembe'] });
    expect(wrongTeam.body.code).toBe('NOT_IN_TEAM');

    const mine = (await t.as('armando.cossa').get('/api/me/van')).body;
    expect(mine.vehicle.plate).toBe('MPT-24-18');
    expect(mine.lines.map((l: { code: string }) => l.code)).toEqual(
      expect.arrayContaining(['CAB-216', 'MTR-P1'])
    );
    expect(mine.catalog).toHaveLength(7);
  });

  it('syncs with EDM’s stock system: receipts by code (once), catalogue updates, and consumption to read back', async () => {
    const receipt = {
      externalRef: 'SAP-GR-77',
      depotCode: 'DEP-MAPUTO',
      lines: [{ itemCode: 'POL-W9', quantity: 5 }]
    };
    expect((await t.as('stock').post('/api/intake/stock/receipts', receipt)).body).toEqual({
      result: 'received',
      lines: 1
    });
    expect((await t.as('stock').post('/api/intake/stock/receipts', receipt)).body).toEqual({
      result: 'duplicate',
      lines: 0
    });
    expect((await stockAt('DEP-MAPUTO'))['POL-W9'].quantity).toBe(5);
    const unknown = await t.as('stock').post('/api/intake/stock/receipts', {
      ...receipt,
      externalRef: 'X',
      lines: [{ itemCode: 'NOPE', quantity: 1 }]
    });
    expect(unknown.body).toMatchObject({ code: 'ITEM_NOT_FOUND', details: { missing: ['NOPE'] } });

    const upsert = await t.as('stock').put('/api/intake/stock/items', {
      items: [{ code: 'MTR-P3', name: 'Prepaid meter, three-phase', unit: 'pcs', lowLevel: 2, watchLevel: 5 }]
    });
    expect(upsert.body).toEqual({ saved: 1 });

    const since = new Date(Date.now() - 60_000).toISOString();
    const id = await complaintFor('CC-S4');
    await t.as('armando.cossa').post(`/api/tickets/${id}/resolve`, {
      note: 'x',
      materials: [{ itemId: items['FUS-160']!.id, quantity: 1 }]
    });
    await t.as('call-center').post('/api/intake/call-center/tickets/CC-S4/check-result', { result: 'fixed' });
    const used = (await t.as('stock').get(`/api/intake/stock/consumption?since=${encodeURIComponent(since)}`))
      .body;
    expect(used).toEqual([
      expect.objectContaining({ itemCode: 'FUS-160', quantity: 1, locationCode: 'VAN-MPT-24-17' })
    ]);
    expect(
      (await t.as('call-center').get('/api/intake/stock/consumption?since=2026-01-01T00:00:00Z')).status
    ).toBe(403);
  });

  it('lets an administrator add the depot of a new area, which then receives stock', async () => {
    const boundary = {
      type: 'Polygon',
      coordinates: [
        [
          [35.3, -23.9],
          [35.45, -23.9],
          [35.45, -23.8],
          [35.3, -23.8]
        ]
      ]
    };
    const area = (await t.as('admin.edm').post('/api/admin/areas', { name: 'Inhambane', boundary })).body;
    const depot = { code: 'dep-inh', name: 'Armazém de Inhambane', areaId: area.id };

    expect((await t.as('helena.mondlane').post('/api/stock/depots', depot)).status).toBe(403);
    expect((await t.as('admin.edm').post('/api/stock/depots', { ...depot, code: 'VAN-1' })).status).toBe(400);
    const taken = await t.as('admin.edm').post('/api/stock/depots', { ...depot, code: 'DEP-MATOLA' });
    expect([taken.status, taken.body.code]).toEqual([409, 'DEPOT_CODE_TAKEN']);
    const matola = (await t.as('admin.edm').get('/api/stock/locations')).body.find(
      (l: { code: string }) => l.code === 'DEP-MATOLA'
    );
    const second = await t.as('admin.edm').post('/api/stock/depots', { ...depot, areaId: matola.areaId });
    expect([second.status, second.body.code]).toEqual([409, 'AREA_HAS_DEPOT']);

    const made = await t.as('admin.edm').post('/api/stock/depots', depot);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({
      kind: 'depot',
      code: 'DEP-INH',
      areaId: area.id,
      areaName: 'Inhambane'
    });
    expect(
      (await t.as('admin.edm').post('/api/stock/depots', { ...depot, code: 'DEP-INH2' })).body.code
    ).toBe('AREA_HAS_DEPOT');

    // Corrected to the code EDM's stock system uses, then goods arrive both ways.
    const renamed = await t
      .as('admin.edm')
      .patch(`/api/stock/depots/${made.body.id}`, { code: 'DEP-INHAMBANE', name: 'Armazém Inhambane' });
    expect(renamed.body).toMatchObject({ code: 'DEP-INHAMBANE', name: 'Armazém Inhambane' });
    expect(
      (await t.as('admin.edm').patch(`/api/stock/depots/${made.body.id}`, { code: 'DEP-MAPUTO' })).body.code
    ).toBe('DEPOT_CODE_TAKEN');
    expect(
      (await t.as('admin.edm').patch(`/api/stock/depots/${locs['VAN-MPT-24-17']!.id}`, { name: 'Van' }))
        .status
    ).toBe(404);
    const received = await t.as('admin.edm').post('/api/stock/receive', {
      locationId: made.body.id,
      lines: [{ itemId: items['POL-W9']!.id, quantity: 12 }]
    });
    expect(received.status).toBe(200);
    const synced = await t.as('stock').post('/api/intake/stock/receipts', {
      externalRef: 'SAP-GR-90',
      depotCode: 'DEP-INHAMBANE',
      lines: [{ itemCode: 'POL-W9', quantity: 3 }]
    });
    expect(synced.body.result).toBe('received');
    locs['DEP-INHAMBANE'] = made.body;
    expect((await stockAt('DEP-INHAMBANE'))['POL-W9'].quantity).toBe(15);
  });
});
