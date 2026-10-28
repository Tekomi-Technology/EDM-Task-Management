import type { LiveMap, MapTicket, StaffLive } from '../types';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { ago, initials, STAFF_STATE_LABEL, STATUS_LABEL, ticketTitle } from '../format';
import { t, t as translate } from '../i18n';

/** Map tiles; set VITE_MAP_TILE_URL to EDM's own tile server in production (OpenStreetMap asks heavy users to). */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MAPUTO: L.LatLngTuple = [-25.95, 32.55];

export const MAP_COLORS = {
  late: '#d92d20',
  open: '#667085',
  working: '#2e6be6',
  waiting: '#7a5af8',
  staff: '#f39b3a',
  offline: '#98a2b3',
  area: '#8f4c0b'
};

export function markerColor(t: Pick<MapTicket, 'status' | 'late'>): string {
  if (t.late) return MAP_COLORS.late;
  if (t.status === 'resolved') return MAP_COLORS.waiting;
  if (t.status === 'new' || t.status === 'reopened') return MAP_COLORS.open;
  return MAP_COLORS.working;
}

/** Field staff as a round badge with initials: filled when on a job, outlined when free, grey when offline. */
function staffIcon(s: StaffLive, selected: boolean): L.DivIcon {
  const size = selected ? 38 : 32;
  const color = s.state === 'offline' ? MAP_COLORS.offline : MAP_COLORS.staff;
  const filled = s.state === 'on_job';
  const style = [
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    `border:2.5px solid ${filled ? '#fff' : color}`,
    `background:${filled ? color : '#fff'}`,
    `color:${filled ? '#2b1a07' : color === MAP_COLORS.offline ? '#475467' : '#8f4c0b'}`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font:700 11px Inter, sans-serif',
    `box-shadow:0 1px 4px rgb(0 0 0 / 35%)${selected ? ', 0 0 0 4px rgb(243 155 58 / 35%)' : ''}`
  ].join(';');
  return L.divIcon({
    className: '',
    html: `<div style="${style}">${initials(s.fullName)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

/**
 * Street map with tickets (dots; network incidents as squares), and optionally field staff and team areas.
 * Clicking a ticket calls onOpen, clicking a person calls onStaff.
 */
export function TicketMap({
  tickets,
  staff = [],
  areas = [],
  selectedStaffId,
  height = 320,
  zoom,
  onOpen,
  onStaff,
  fit = true,
  fitTo = 'points'
}: {
  tickets: MapTicket[];
  staff?: StaffLive[];
  areas?: LiveMap['areas'];
  selectedStaffId?: string | null;
  height?: number | string;
  zoom?: number;
  onOpen?: (id: string) => void;
  onStaff?: (id: string) => void;
  /** Zoom to show everything when the data changes (off on the live map after the first time, so it does not jump). */
  fit?: boolean;
  /** What to zoom to: every point, or the team areas (a ticket far outside them would otherwise zoom out a lot). */
  fitTo?: 'points' | 'areas';
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(MAPUTO, 11);
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map.current);
    L.control.scale({ imperial: false }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Redraw only when the data really changes, not on every render (that would undo the user's panning).
  const key = JSON.stringify([tickets, staff, areas, selectedStaffId]);
  const openRef = useRef(onOpen);
  const staffRef = useRef(onStaff);
  openRef.current = onOpen;
  staffRef.current = onStaff;

  useEffect(() => {
    const m = map.current;
    const group = layer.current;
    if (!m || !group) return;
    const [tickets, staff, areas, selected] = JSON.parse(key) as [
      MapTicket[],
      StaffLive[],
      LiveMap['areas'],
      string | null | undefined
    ];
    group.clearLayers();

    for (const a of areas) {
      L.polygon(
        a.boundary.map((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple))),
        { color: MAP_COLORS.area, weight: 1.5, dashArray: '6 6', fillOpacity: 0.03 }
      )
        .bindTooltip(a.name, { sticky: true })
        .addTo(group);
    }

    // Late tickets last, so they are drawn on top when several are at the same place.
    for (const t of [...tickets].sort((a, b) => Number(a.late) - Number(b.late))) {
      const network = t.type === 'network_incident';
      const size = t.late || network ? 16 : 13;
      const marker = L.marker([t.lat, t.lng], {
        title: `${t.code} · ${ticketTitle(t.title)}`,
        icon: L.divIcon({
          className: '',
          html: `<div class="map-dot" style="width:${size}px;height:${size}px;background:${markerColor(t)};${network ? 'border-radius:3px' : ''}"></div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        })
      });
      marker.bindTooltip(
        `${t.code} · ${ticketTitle(t.title)} · ${t.late ? translate('late') : STATUS_LABEL[t.status]}`
      );
      marker.on('click', () => openRef.current?.(t.id));
      marker.addTo(group);
    }

    for (const s of staff) {
      if (!s.location || s.state === 'off_duty') continue;
      L.marker([s.location.lat, s.location.lng], {
        icon: staffIcon(s, s.id === selected),
        zIndexOffset: 1000
      })
        .bindTooltip(
          `${s.fullName} · ${STAFF_STATE_LABEL[s.state]} · ${translate('seen {0}', { 0: ago(s.location.at) })}`
        )
        .on('click', () => staffRef.current?.(s.id))
        .addTo(group);
    }

    if (!fit && fitted.current) return;
    if (fitTo === 'areas' && areas.length) {
      const corners = areas.flatMap((a) =>
        a.boundary.flat(2).map(([lng, lat]) => [lat, lng] as L.LatLngTuple)
      );
      m.fitBounds(L.latLngBounds(corners), { padding: [20, 20] });
      fitted.current = true;
      return;
    }
    const points: L.LatLngTuple[] = [
      ...tickets.map((t) => [t.lat, t.lng] as L.LatLngTuple),
      ...staff
        .filter((s) => s.location && s.state !== 'off_duty')
        .map((s) => [s.location!.lat, s.location!.lng] as L.LatLngTuple)
    ];
    if (points.length === 1) m.setView(points[0]!, zoom ?? 15);
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15 });
    if (points.length) fitted.current = true;
  }, [key, zoom, fit, fitTo]);

  return (
    <div
      ref={el}
      className="ticket-map"
      style={{ height }}
      role="img"
      aria-label={t('Map of tickets and field staff')}
    />
  );
}
