import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { t } from '../i18n';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPUTO: L.LatLngTuple = [-25.95, 32.55];

/** A map to click on to mark a place; the marker can be dragged. */
export function LocationPicker({
  value,
  onChange,
  height = 260
}: {
  value: { lat: number; lng: number } | null;
  onChange: (p: { lat: number; lng: number }) => void;
  height?: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current).setView(value ? [value.lat, value.lng] : MAPUTO, value ? 15 : 11);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => {
      changeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
      // A click on the whole city is rough: zoom in on it, so the point (and its address) can be put right.
      if (m.getZoom() < 16) m.setView(e.latlng, 16);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      marker.current = null;
    };
    // The starting view only; later changes move the marker.
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!value) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([value.lat, value.lng], {
        draggable: true,
        icon: L.divIcon({
          className: '',
          html: '<div style="width:18px;height:18px;border-radius:50%;background:#d92d20;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      })
        .on('dragend', (e) => {
          const p = (e.target as L.Marker).getLatLng();
          changeRef.current({ lat: p.lat, lng: p.lng });
        })
        .addTo(m);
    } else {
      marker.current.setLatLng([value.lat, value.lng]);
    }
  }, [value]);

  return (
    <div
      ref={el}
      role="application"
      aria-label={t('Map: click where the problem is')}
      style={{ height, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}
    />
  );
}
