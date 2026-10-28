import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestContext } from './helpers';
import { mockServer } from './mock-server';

const MATOLA_GARE = {
  display_name: 'Rua 4, Matola Gare, Matola, Maputo, Moçambique',
  address: { road: 'Rua 4', house_number: '12', suburb: 'Matola Gare', city: 'Matola', country: 'Moçambique' }
};

/** The address of a point marked on the map, filled in for the person entering a ticket. */
describe('address of a point on the map', () => {
  let t: TestContext;
  let geocoder: Awaited<ReturnType<typeof mockServer>>;
  let answer = { status: 200, body: JSON.stringify(MATOLA_GARE) };
  beforeAll(async () => {
    geocoder = await mockServer(59874, () => answer);
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
    await geocoder.close();
  });

  const reverse = (lat: number, lng: number, who: Parameters<TestContext['as']>[0] = 'paulo.bo') =>
    t.as(who).get(`/api/places/reverse?lat=${lat}&lng=${lng}`);

  it('gives street, neighbourhood and town, asks once per point and names itself', async () => {
    const res = await reverse(-25.915, 32.455);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: 'Rua 4 12, Matola Gare, Matola' });
    expect(geocoder.received).toHaveLength(1);
    const asked = new URL(geocoder.received[0]!.url, 'http://x');
    expect(Object.fromEntries(asked.searchParams)).toMatchObject({
      lat: '-25.915',
      lon: '32.455',
      format: 'jsonv2'
    });
    expect(geocoder.received[0]!.headers['user-agent']).toContain('EDM-Tasks');

    expect((await reverse(-25.915, 32.455)).body.address).toBe('Rua 4 12, Matola Gare, Matola');
    expect(geocoder.received).toHaveLength(1); // remembered
  });

  it('answers null when the service fails, and asks again next time', async () => {
    answer = { status: 503, body: '{}' };
    expect((await reverse(-25.96, 32.58)).body).toEqual({ address: null });
    answer = {
      status: 200,
      body: JSON.stringify({ display_name: 'Baixa, Maputo, Moçambique', address: {} })
    };
    expect((await reverse(-25.96, 32.58)).body).toEqual({ address: 'Baixa, Maputo, Moçambique' });
  });

  it('is for office staff, with a valid point', async () => {
    expect((await reverse(-25.9, 32.4, 'armando.cossa')).status).toBe(403);
    expect((await reverse(-125, 32.4)).status).toBe(400);
  });
});
