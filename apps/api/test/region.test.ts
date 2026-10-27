import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestContext } from './helpers';

/** The region picker at the top of the web app: lists and summaries for one area. */
describe('region picker', () => {
  let t: TestContext;
  let matola: string;
  let maputo: string;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetData(t.db);
    const areas = (await t.as('nadia.mussa').get('/api/lookups')).body.areas as {
      id: string;
      name: string;
    }[];
    matola = areas.find((a) => a.name === 'Matola')!.id;
    maputo = areas.find((a) => a.name === 'Maputo Central')!.id;
    // One complaint in each area: Rosa in Matola (South 1), Manuel in Maputo Central (South 2).
    for (const [ref, contractNo] of [
      ['CC-1', '40217735'],
      ['CC-2', '40188210']
    ]) {
      await t.as('call-center').post('/api/intake/call-center/complaints', {
        externalRef: ref,
        contractNo,
        problemType: 'no_power_single',
        description: 'No power'
      });
    }
  });

  const get = async (path: string, who: Parameters<TestContext['as']>[0] = 'nadia.mussa') => {
    const res = await t.as(who).get(path);
    expect(res.status).toBe(200);
    return res.body;
  };

  it('narrows the counts, the Overview and the ticket list to the chosen area', async () => {
    expect((await get('/api/tickets/counts')).active).toBe(2);
    expect((await get(`/api/tickets/counts?areaId=${matola}`)).active).toBe(1);
    expect((await get(`/api/overview?areaId=${maputo}`)).open).toBe(1);
    const list = await get(`/api/tickets?areaId=${matola}`);
    expect(list.items.map((i: { areaName: string }) => i.areaName)).toEqual(['Matola']);
  });

  it('narrows the live map, field staff and help requests to the teams of the area', async () => {
    const live = await get(`/api/live?areaId=${maputo}`);
    expect(live.areas.map((a: { name: string }) => a.name)).toEqual(['Maputo Central']);
    expect(new Set(live.staff.map((s: { teamName: string }) => s.teamName))).toEqual(new Set(['South 2']));
    expect(live.tickets).toHaveLength(1);

    const staff = await get(`/api/field-staff?areaId=${matola}`);
    expect(new Set(staff.map((s: { teamName: string }) => s.teamName))).toEqual(new Set(['South 1']));

    await t.as('armando.cossa').post('/api/help-requests', { kind: 'advice', message: 'Which fuse?' });
    expect(await get(`/api/help-requests?areaId=${matola}`)).toHaveLength(1);
    expect(await get(`/api/help-requests?areaId=${maputo}`)).toHaveLength(0);
    expect(await get(`/api/incidents?areaId=${matola}`)).toEqual([]);
    expect(await get(`/api/new-customers?areaId=${matola}`)).toEqual([]);
    expect(await get(`/api/planned-work?from=2026-01-01&to=2026-12-31&areaId=${matola}`)).toEqual([]);
  });

  it('never widens what someone may see, and still opens a ticket of another area by its link', async () => {
    // Helena manages South 1 (Matola): choosing Maputo shows nothing rather than South 2's tickets.
    expect((await get(`/api/tickets/counts?areaId=${maputo}`, 'helena.mondlane')).active).toBe(0);
    const [other] = (await get(`/api/tickets?areaId=${maputo}`)).items as { id: string }[];
    expect((await t.as('nadia.mussa').get(`/api/tickets/${other!.id}`)).status).toBe(200);
    expect((await t.as('nadia.mussa').get('/api/overview?areaId=not-a-uuid')).status).toBe(400);
  });
});
