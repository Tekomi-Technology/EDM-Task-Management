import { describe, expect, it } from 'vitest';
import { boundaryFromGeoJson } from './AreasPage';

const square = [
  [32.4, -26],
  [32.5, -26],
  [32.5, -25.9],
  [32.4, -26]
];

describe('reading an area boundary from a GeoJSON file', () => {
  it('takes a bare geometry, a Feature, or all polygons of a FeatureCollection', () => {
    expect(boundaryFromGeoJson(JSON.stringify({ type: 'Polygon', coordinates: [square] }))).toEqual({
      type: 'Polygon',
      coordinates: [square]
    });
    const feature = {
      type: 'Feature',
      properties: { name: 'Matola' },
      geometry: { type: 'Polygon', coordinates: [square] }
    };
    expect(boundaryFromGeoJson(JSON.stringify(feature)).type).toBe('Polygon');
    const collection = {
      type: 'FeatureCollection',
      features: [
        feature,
        { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[square], [square]] } }
      ]
    };
    const all = boundaryFromGeoJson(JSON.stringify(collection));
    expect(all.type).toBe('MultiPolygon');
    expect(all.coordinates).toHaveLength(3);
  });

  it('drops heights and refuses files without a polygon', () => {
    const withHeight = { type: 'Polygon', coordinates: [square.map(([x, y]) => [x, y, 12])] };
    expect(boundaryFromGeoJson(JSON.stringify(withHeight)).coordinates).toEqual([square]);
    expect(() => boundaryFromGeoJson(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))).toThrow();
    expect(() => boundaryFromGeoJson('not json')).toThrow(SyntaxError);
  });
});
