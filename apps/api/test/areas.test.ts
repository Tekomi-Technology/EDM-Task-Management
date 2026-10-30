import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetData, type TestContext } from './helpers';

/** [lng, lat] rectangle, as a GeoJSON polygon with an open ring (as drawn on the map). */
const box = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north]
    ]
  ]
});
/** North of the sample area Matola (32.40–32.52, -26.00 to -25.88), sharing its northern edge. */
const NORTH = box(32.4, -25.88, 32.52, -25.8);

describe('areas and teams (Settings)', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  const admin = () => t.as('admin.edm');
  const areaNamed = async (name: string) =>
    ((await admin().get('/api/admin/areas')).body as { id: string; name: string }[]).find(
      (a) => a.name === name
    )!;

  it('lists the areas with their shape, teams and managers', async () => {
    expect((await t.as('carla.manhica').get('/api/admin/areas')).status).toBe(403);
    const list = (await admin().get('/api/admin/areas')).body;
    expect(list.map((a: { name: string }) => a.name)).toEqual(['Maputo Central', 'Matola']);
    const matola = list.find((a: { name: string }) => a.name === 'Matola');
    expect(matola).toMatchObject({
      code: 'MATOLA',
      teams: [{ code: 'SOUTH_1', name: 'South 1', managers: ['Helena Mondlane'] }]
    });
    expect(matola.boundary[0][0]).toHaveLength(5);
    expect(matola.sizeKm2).toBeGreaterThan(100);
  });

  it('makes a new area and team that new tickets in that place go to', async () => {
    const made = await admin().post('/api/admin/areas', { name: 'Matola Norte', boundary: NORTH });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ code: 'MATOLA_NORTE', teams: [], openTickets: 0 });
    const team = await admin().post('/api/admin/teams', { name: 'Norte 1', areaId: made.body.id });
    expect(team.body).toMatchObject({ code: 'NORTE_1', name: 'Norte 1', areaName: 'Matola Norte' });

    const ticket = await t.as('paulo.bo').post('/api/tickets', {
      type: 'other',
      title: 'Fallen tree on the line',
      description: 'Tree resting on the low-voltage line',
      priority: 2,
      location: { lat: -25.84, lng: 32.45 }
    });
    const detail = (await admin().get(`/api/tickets/${ticket.body.id}`)).body;
    expect(detail).toMatchObject({ teamId: team.body.id, areaName: 'Matola Norte' });
  });

  it('refuses a boundary that overlaps another area or crosses itself', async () => {
    const overlap = await admin().post('/api/admin/areas', {
      name: 'Too big',
      boundary: box(32.45, -25.95, 32.5, -25.85)
    });
    expect([overlap.status, overlap.body.code, overlap.body.details]).toEqual([
      422,
      'AREAS_OVERLAP',
      { areas: ['Matola'] }
    ]);
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [32.7, -25.9],
          [32.8, -25.8],
          [32.8, -25.9],
          [32.7, -25.8]
        ]
      ]
    };
    expect((await admin().post('/api/admin/areas', { name: 'Bowtie', boundary: bowtie })).body.code).toBe(
      'BOUNDARY_INVALID'
    );
    expect(
      (
        await admin().post('/api/admin/areas', {
          name: 'Line',
          boundary: {
            type: 'Polygon',
            coordinates: [
              [
                [1, 1],
                [2, 2]
              ]
            ]
          }
        })
      ).status
    ).toBe(400);
  });

  it('renames and reshapes an area, but not over its neighbour', async () => {
    const matola = await areaNamed('Matola');
    const renamed = await admin().patch(`/api/admin/areas/${matola.id}`, { name: 'Matola Cidade' });
    expect(renamed.body).toMatchObject({ name: 'Matola Cidade', code: 'MATOLA' });
    // Grow east into Maputo Central: refused. Shrink: fine, its own old shape does not count.
    const grown = await admin().patch(`/api/admin/areas/${matola.id}`, {
      boundary: box(32.4, -26, 32.55, -25.88)
    });
    expect(grown.body.details).toEqual({ areas: ['Maputo Central'] });
    const shrunk = await admin().patch(`/api/admin/areas/${matola.id}`, {
      boundary: box(32.42, -25.98, 32.5, -25.9)
    });
    expect(shrunk.status).toBe(200);
  });

  it('lets the administrator choose which team of an area gets its new tickets', async () => {
    const matola = await areaNamed('Matola');
    const zeta = (await admin().post('/api/admin/teams', { name: 'Zeta', areaId: matola.id })).body;
    const teamsOf = async () =>
      ((await areaNamed('Matola')) as unknown as { teams: { name: string }[] }).teams.map((x) => x.name);
    const whoGets = async () =>
      (
        await t.as('paulo.bo').post('/api/tickets/preview', {
          type: 'other',
          priority: 2,
          location: { lat: -25.931, lng: 32.471 }
        })
      ).body.team.name;
    expect(await teamsOf()).toEqual(['South 1', 'Zeta']);
    expect(await whoGets()).toBe('South 1');
    // A team added later never takes over by itself, whatever its name.
    await admin().post('/api/admin/teams', { name: 'Alfa', areaId: matola.id });
    expect(await teamsOf()).toEqual(['South 1', 'Alfa', 'Zeta']);
    expect(await whoGets()).toBe('South 1');

    expect((await admin().patch(`/api/admin/teams/${zeta.id}`, { receivesNew: true })).status).toBe(200);
    // The team that gets the new tickets is listed first.
    expect(await teamsOf()).toEqual(['Zeta', 'Alfa', 'South 1']);
    expect(await whoGets()).toBe('Zeta');

    // Moved to another area, it no longer takes the new tickets of either: the first team left in Matola does.
    const north = (await admin().post('/api/admin/areas', { name: 'Matola Norte', boundary: NORTH })).body;
    await admin().patch(`/api/admin/teams/${zeta.id}`, { areaId: north.id });
    expect(await whoGets()).toBe('Alfa');
    expect((await admin().patch(`/api/admin/teams/${zeta.id}`, { receivesNew: false })).status).toBe(400);
  });

  it('moves teams between areas, and deletes only what was never used', async () => {
    const matola = await areaNamed('Matola');
    const north = (await admin().post('/api/admin/areas', { name: 'Matola Norte', boundary: NORTH })).body;
    const south1 = (await admin().get('/api/admin/teams')).body.find(
      (x: { code: string }) => x.code === 'SOUTH_1'
    );

    const moved = await admin().patch(`/api/admin/teams/${south1.id}`, { areaId: north.id, name: 'Sul 1' });
    expect(moved.body).toMatchObject({ name: 'Sul 1', areaName: 'Matola Norte' });
    expect(
      (await admin().get('/api/admin/teams')).body.find((x: { id: string }) => x.id === south1.id).areaName
    ).toBe('Matola Norte');

    expect((await admin().delete(`/api/admin/teams/${south1.id}`)).body.code).toBe('TEAM_IN_USE');
    expect((await admin().delete(`/api/admin/areas/${north.id}`)).body.code).toBe('AREA_HAS_TEAMS');
    const spare = (await admin().post('/api/admin/teams', { name: 'Spare', areaId: north.id })).body;
    expect((await admin().delete(`/api/admin/teams/${spare.id}`)).status).toBe(204);

    // Matola has depots and history: kept.
    await admin().patch(`/api/admin/teams/${south1.id}`, { areaId: matola.id });
    expect((await admin().delete(`/api/admin/areas/${matola.id}`)).body.code).toBe('AREA_HAS_TEAMS');
    await admin().patch(`/api/admin/teams/${south1.id}`, { areaId: north.id });
    expect((await admin().delete(`/api/admin/areas/${matola.id}`)).body.code).toBe('AREA_IN_USE');

    const empty = (
      await admin().post('/api/admin/areas', { name: 'Empty', boundary: box(33, -25, 33.1, -24.9) })
    ).body;
    expect((await admin().delete(`/api/admin/areas/${empty.id}`)).status).toBe(204);
  });
});
