import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { t } from '../i18n';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPUTO: L.LatLngTuple = [-25.95, 32.55];

export type LngLat = [number, number];

export interface MapArea {
  id: string;
  name: string;
  /** GeoJSON MultiPolygon coordinates ([lng, lat]). */
  boundary: LngLat[][][];
}

const toLatLngs = (polygons: LngLat[][][]) =>
  polygons.map((rings) => rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple)));

const vertexIcon = L.divIcon({
  className: '',
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #e88a24;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

/**
 * The areas on a map. While drawing, a click adds a corner to the drawn shape and corners can be dragged; the
 * shape being drawn (or read from a file) is shown in orange over the others.
 */
export function AreaMap({
  areas,
  selectedId,
  drawing,
  draft,
  preview,
  onAdd,
  onMove,
  onSelect,
  height = 560
}: {
  areas: MapArea[];
  selectedId: string | null;
  /** Clicks add corners only while drawing. */
  drawing: boolean;
  draft: LngLat[];
  /** A whole shape to show instead of the corners (read from a file). */
  preview: LngLat[][][] | null;
  onAdd: (p: LngLat) => void;
  onMove: (index: number, p: LngLat) => void;
  onSelect: (id: string) => void;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const areaLayer = useRef<L.LayerGroup | null>(null);
  const draftLayer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const handlers = useRef({ onAdd, onMove, onSelect, drawing });
  handlers.current = { onAdd, onMove, onSelect, drawing };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView(MAPUTO, 10);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (handlers.current.drawing) handlers.current.onAdd([e.latlng.lng, e.latlng.lat]);
    });
    areaLayer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // The saved areas; the chosen one stands out.
  useEffect(() => {
    const group = areaLayer.current;
    const m = map.current;
    if (!group || !m) return;
    group.clearLayers();
    const all: L.Polygon[] = [];
    for (const a of areas) {
      const selected = a.id === selectedId;
      const polygon = L.polygon(toLatLngs(a.boundary), {
        color: selected ? '#b4560b' : '#5d6573',
        weight: selected ? 3 : 2,
        fillColor: selected ? '#f39b3a' : '#98a2b3',
        fillOpacity: selected ? 0.18 : 0.08,
        // Clicks go to the map while drawing, so a corner can be put inside another area's outline.
        interactive: !drawing
      })
        .bindTooltip(a.name, { permanent: true, direction: 'center', className: 'area-label' })
        .on('click', () => handlers.current.onSelect(a.id));
      polygon.addTo(group);
      all.push(polygon);
    }
    if (!fitted.current && all.length) {
      m.fitBounds(L.featureGroup(all).getBounds(), { padding: [24, 24] });
      fitted.current = true;
    }
  }, [areas, selectedId, drawing]);

  // The shape being drawn: its outline and draggable corners, or a shape read from a file.
  useEffect(() => {
    const group = draftLayer.current;
    const m = map.current;
    if (!group || !m) return;
    group.clearLayers();
    const style = { color: '#e88a24', weight: 3, fillColor: '#f39b3a', fillOpacity: 0.25, dashArray: '6 4' };
    if (preview) {
      const shape = L.polygon(toLatLngs(preview), style).addTo(group);
      m.fitBounds(shape.getBounds(), { padding: [24, 24] });
      return;
    }
    const latLngs = draft.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);
    if (latLngs.length >= 3) L.polygon(latLngs, style).addTo(group);
    else if (latLngs.length === 2) L.polyline(latLngs, style).addTo(group);
    latLngs.forEach((p, i) => {
      L.marker(p, { icon: vertexIcon, draggable: true, title: t('Corner {0}', { 0: i + 1 }) })
        .on('dragend', (e) => {
          const at = (e.target as L.Marker).getLatLng();
          handlers.current.onMove(i, [at.lng, at.lat]);
        })
        .addTo(group);
    });
  }, [draft, preview]);

  return (
    <div
      ref={el}
      role="application"
      aria-label={drawing ? t('Map: click to add the corners of the area') : t('Map of the areas')}
      style={{
        height,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        cursor: drawing ? 'crosshair' : undefined
      }}
    />
  );
}
