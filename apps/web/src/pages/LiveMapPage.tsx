import type { LiveMap, StaffLive, StaffState } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Phone, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { MAP_COLORS, TicketMap } from '../components/TicketMap';
import { Avatar, useCrumbs } from '../components/ui';
import { ago, formatTime, STAFF_STATE_LABEL, STATUS_LABEL, ticketTitle } from '../format';
import { useRegion } from '../components/topbar';
import { t } from '../i18n';

const STATE_BADGE: Record<StaffState, string> = {
  on_job: 'badge-assigned',
  free: 'badge-active',
  offline: 'badge',
  off_duty: 'badge-cancelled'
};

function StaffCard({ s, onClose }: { s: StaffLive; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <section
      className="card card-pad"
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        width: 330,
        zIndex: 500,
        boxShadow: '0 12px 32px rgb(16 24 40 / 16%)'
      }}
    >
      <div className="person">
        <Avatar name={s.fullName} size="lg" />
        <div style={{ flex: 1 }}>
          <strong style={{ fontSize: 16 }}>{s.fullName}</strong>
          <div className="meta">
            {s.teamName ? `${s.teamName} · ` : ''}
            {s.location ? t('seen {0}', { 0: ago(s.location.at) }) : t('no position yet')}
          </div>
        </div>
        <button type="button" className="btn btn-sm" aria-label={t('Close')} onClick={onClose}>
          ×
        </button>
      </div>
      {s.currentJob ? (
        <div>
          {STATUS_LABEL[s.currentJob.status]}:{' '}
          <Link to={`/tickets/${s.currentJob.id}`} style={{ fontWeight: 700 }}>
            {ticketTitle(s.currentJob.title)}
          </Link>
        </div>
      ) : (
        <span className={`badge ${STATE_BADGE[s.state]}`} style={{ alignSelf: 'flex-start' }}>
          {STAFF_STATE_LABEL[s.state]}
        </span>
      )}
      <span className="meta" style={{ fontSize: 14 }}>
        {t('Jobs today:')} {s.doneToday} {t('done ·')} {s.openJobs} {t('to go')}
      </span>
      <div className="btn-row">
        {s.phone && (
          <a className="btn" href={`tel:${s.phone}`} style={{ flex: 1 }}>
            <Phone size={16} /> {t('Call')}
          </a>
        )}
        <button
          type="button"
          className="btn btn-soft"
          style={{ flex: 1 }}
          onClick={() => navigate(`/tickets?view=unassigned${s.teamId ? `&teamId=${s.teamId}` : ''}`)}
        >
          <UserPlus size={16} /> {t('Give a job')}
        </button>
      </div>
    </section>
  );
}

/** W11: where field staff are, open tickets and the team areas, refreshed every 15 seconds. */
export function LiveMapPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: t('Field') }, { label: t('Live map') }]);
  const navigate = useNavigate();
  const [tab, setTab] = useState<'staff' | 'tickets'>('staff');
  const [filter, setFilter] = useState<StaffState | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [layers, setLayers] = useState({ tickets: true, staff: true, areas: true });
  const live = useQuery({
    queryKey: ['live', areaId],
    queryFn: () => api<LiveMap>(withArea('/live')),
    refetchInterval: 15_000
  });

  const data = live.data;
  const staff = data?.staff ?? [];
  const count = (s: StaffState) => staff.filter((x) => x.state === s).length;
  const late = data?.tickets.filter((t) => t.late).length ?? 0;
  const incidents = data?.tickets.filter((t) => t.type === 'network_incident').length ?? 0;
  const shown = staff.filter((s) => (filter === 'all' ? s.state !== 'off_duty' : s.state === filter));
  const chosen = staff.find((s) => s.id === selected);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('Live map')}</h1>
          <div className="subtitle">{t('Field staff on duty, open tickets and the team areas.')}</div>
        </div>
        {data && (
          <span className="live">
            {t('Live · updated')} {formatTime(data.updatedAt)}
          </span>
        )}
      </div>
      <div className="btn-row">
        {[
          { label: t('on a job'), value: count('on_job'), color: MAP_COLORS.staff, fill: true },
          { label: 'free', value: count('free'), color: MAP_COLORS.staff },
          { label: 'offline', value: count('offline'), color: MAP_COLORS.offline },
          {
            label: t('open tickets'),
            value: data?.tickets.length ?? 0,
            color: MAP_COLORS.working,
            fill: true
          }
        ].map((c) => (
          <span
            key={c.label}
            className="card"
            style={{ padding: '10px 16px', display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <i
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                border: `2px solid ${c.color}`,
                background: c.fill ? c.color : 'transparent'
              }}
            />
            <strong>{c.value}</strong> {c.label}
          </span>
        ))}
        <span
          className="card"
          style={{
            padding: '10px 16px',
            background: 'var(--late-soft)',
            color: 'var(--late)',
            fontWeight: 700
          }}
        >
          {late} {t('late ·')} {incidents} {t('network')}
        </span>
      </div>

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(280px, 380px) minmax(0, 1fr)' }}>
        <section className="card" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'staff'} onClick={() => setTab('staff')}>
              {t('Staff')}{' '}
              <span className="pill-count">{staff.filter((s) => s.state !== 'off_duty').length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'tickets'}
              onClick={() => setTab('tickets')}
            >
              {t('Tickets')} <span className="pill-count">{data?.tickets.length ?? 0}</span>
            </button>
          </div>
          {tab === 'staff' && (
            <>
              <div className="segmented" style={{ padding: '14px 16px', gap: 8 }}>
                {(['all', 'on_job', 'free', 'offline'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    style={{ height: 36 }}
                    aria-pressed={filter === f}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? t('All') : STAFF_STATE_LABEL[f]}
                  </button>
                ))}
              </div>
              {shown.length === 0 && <div className="empty">{t('Nobody here.')}</div>}
              {shown.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelected(s.id)}
                  className="choice"
                  aria-checked={selected === s.id}
                  style={{ borderRadius: 0, borderWidth: 0, borderTop: '1px solid var(--border-soft)' }}
                >
                  <Avatar name={s.fullName} kind={s.state === 'offline' ? 'system' : undefined} />
                  <span className="grow">
                    <strong>{s.fullName}</strong>
                    <div className="meta">
                      {s.teamName}
                      {s.currentJob ? ` · ${ticketTitle(s.currentJob.title)}` : ''}
                      {s.state === 'offline' && s.location
                        ? t(' · last seen {0}', { 0: ago(s.location.at) })
                        : ''}
                    </div>
                  </span>
                  <span className={`badge ${STATE_BADGE[s.state]}`}>{STAFF_STATE_LABEL[s.state]}</span>
                </button>
              ))}
            </>
          )}
          {tab === 'tickets' &&
            (data?.tickets.length ? (
              data.tickets.map((t) => (
                <Link
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  className="choice"
                  style={{
                    borderRadius: 0,
                    borderTop: '1px solid var(--border-soft)',
                    textDecoration: 'none',
                    color: 'inherit'
                  }}
                >
                  <i
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: t.type === 'network_incident' ? 3 : 6,
                      background: t.late ? MAP_COLORS.late : MAP_COLORS.working
                    }}
                  />
                  <span className="grow">
                    <strong>{ticketTitle(t.title)}</strong>
                    <div className="meta">
                      {t.code} · {t.late ? 'late' : STATUS_LABEL[t.status]}
                    </div>
                  </span>
                </Link>
              ))
            ) : (
              <div className="empty">{t('No open tickets with a location.')}</div>
            ))}
        </section>

        <section className="card" style={{ position: 'relative', overflow: 'hidden' }}>
          <div className="btn-row" style={{ position: 'absolute', top: 14, left: 60, zIndex: 500, gap: 8 }}>
            {(['tickets', 'staff', 'areas'] as const).map((l) => (
              <label
                key={l}
                className="btn btn-sm"
                style={{ background: layers[l] ? 'var(--brand-soft)' : undefined, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={layers[l]}
                  onChange={(e) => setLayers({ ...layers, [l]: e.target.checked })}
                />
                {l === 'tickets' ? t('Tickets') : l === 'staff' ? t('Staff') : t('Areas')}
              </label>
            ))}
          </div>
          <TicketMap
            height={640}
            fit={false}
            fitTo="areas"
            tickets={layers.tickets ? (data?.tickets ?? []) : []}
            staff={layers.staff ? staff : []}
            areas={layers.areas ? (data?.areas ?? []) : []}
            selectedStaffId={selected}
            onOpen={(id) => navigate(`/tickets/${id}`)}
            onStaff={setSelected}
          />
          {chosen && <StaffCard s={chosen} onClose={() => setSelected(null)} />}
          <div className="legend" style={{ borderTop: '1px solid var(--border-soft)' }}>
            <span>
              <i style={{ background: MAP_COLORS.staff }} /> {t('Staff on a job')}
            </span>
            <span>
              <i style={{ border: `2px solid ${MAP_COLORS.staff}`, background: '#fff' }} /> {t('Free')}
            </span>
            <span>
              <i style={{ border: `2px solid ${MAP_COLORS.offline}`, background: '#fff' }} /> {t('Offline')}
            </span>
            <span>
              <i style={{ background: MAP_COLORS.late }} /> {t('Late')}
            </span>
            <span>
              <i style={{ background: MAP_COLORS.working }} /> {t('Being fixed')}
            </span>
            <span>
              <i style={{ background: MAP_COLORS.open }} /> {t('Open')}
            </span>
            <span>
              <i style={{ background: MAP_COLORS.waiting }} /> {t('Waiting for check')}
            </span>
            <span>
              <i style={{ background: MAP_COLORS.open, borderRadius: 2 }} /> {t('Network incident')}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
