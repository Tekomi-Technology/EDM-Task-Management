import type { Lookups, Report } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, download } from '../api';
import { hasRole, useCrumbs, useMe } from '../components/ui';
import { qty, TYPE_LABEL } from '../format';
import { useRegion } from '../components/topbar';
import { t, dateLocale } from '../i18n';

type PeriodKey = '7' | '14' | '30' | '90' | 'month' | 'last_month';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7', label: 'Last 7 days' },
  { key: '14', label: 'Last 14 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'last_month', label: 'Last month' }
];

/** Today in Maputo time, as YYYY-MM-DD; reports count whole days there. */
const maputoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Maputo' });
const shift = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function periodDates(key: PeriodKey, today = maputoToday()): { from: string; to: string } {
  if (key === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (key === 'last_month') {
    const end = shift(`${today.slice(0, 8)}01`, -1);
    return { from: `${end.slice(0, 8)}01`, to: end };
  }
  return { from: shift(today, -(Number(key) - 1)), to: today };
}

/** "2 h 41 min", "1 day 2 h", "35 min". */
export function duration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 1) return t('Under 1 min');
  if (minutes < 60) return t('{0} min', { 0: minutes });
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.round((minutes % 1440) / 60);
  const dayText = d === 1 ? t('1 day') : t('{n} days', { n: d });
  return h ? t('{days} {h} h', { days: dayText, h }) : dayText;
}

const avgDays = (v: number | null) =>
  v === null ? '—' : v < 0.1 ? t('Same day') : v === 1 ? t('1 day') : t('{n} days', { n: v });
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function comparison(now: number, before: number, days: number): string {
  if (before === 0) return now === 0 ? t('None closed') : t('None in the {0} days before', { 0: days });
  const change = Math.round(((now - before) / before) * 100);
  if (change === 0) return t('Same as the {0} days before', { 0: days });
  return change > 0
    ? t('{p}% more than the {n} days before', { p: change, n: days })
    : t('{p}% fewer than the {n} days before', { p: -change, n: days });
}

function Kpi({ title, value, note, alert }: { title: string; value: string; note: string; alert?: boolean }) {
  return (
    <section className="card kpi">
      <span className="head">{title}</span>
      <span className="value" style={alert ? { color: 'var(--late)' } : undefined}>
        {value}
      </span>
      <span className="meta" style={{ fontSize: 14 }}>
        {note}
      </span>
    </section>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round number just above the highest value, for the top grid line. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / (step / 2)) * (step / 2);
}

const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  });

/** Tickets closed per day: one bar a day; today's bar is lighter because the day is not over. */
function ClosedPerDay({ days, today }: { days: Report['perDay']; today: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 260;
  const pad = { top: 24, right: 8, bottom: 28, left: 36 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const top = niceMax(Math.max(0, ...days.map((d) => d.closed)));
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(40, slot * 0.62));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(1, Math.floor(plotW / 56))));
  const highest = days.reduce((best, d, i) => (d.closed > (days[best]?.closed ?? -1) ? i : best), 0);
  const tip = hover === null ? null : days[hover];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={t('Tickets closed per day, from {0} to {1}', {
            0: days[0]?.day ?? '',
            1: days.at(-1)?.day ?? ''
          })}
          onMouseLeave={() => setHover(null)}
        >
          {[0, top / 2, top].map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--border)" />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">
                {v.toLocaleString(dateLocale())}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = pad.left + i * slot + (slot - barW) / 2;
            const h = Math.max(0, y(0) - y(d.closed));
            const r = Math.min(4, barW / 2, h);
            const partial = d.day === today;
            const label = (i === highest && d.closed > 0) || (i === days.length - 1 && d.closed > 0);
            return (
              <g key={d.day}>
                {h > 0 && (
                  <path
                    d={`M${x},${y(0)} V${y(d.closed) + r} Q${x},${y(d.closed)} ${x + r},${y(d.closed)} H${x + barW - r} Q${x + barW},${y(d.closed)} ${x + barW},${y(d.closed) + r} V${y(0)} Z`}
                    fill={partial ? 'var(--brand-line)' : 'var(--brand)'}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {label && (
                  <text
                    x={x + barW / 2}
                    y={y(d.closed) - 8}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={700}
                    fill="var(--text)"
                  >
                    {d.closed.toLocaleString(dateLocale())}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--muted)">
                    {days.length > 31 ? dayLabel(d.day) : Number(d.day.slice(8))}
                  </text>
                )}
                {/* Hit area wider than the bar. */}
                <rect
                  x={pad.left + i * slot}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {tip && hover !== null && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: Math.min(width - 150, Math.max(0, pad.left + hover * slot + slot / 2 - 75)),
            top: Math.max(0, y(tip.closed) - 64),
            width: 150,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 4px 14px rgba(16,24,40,.12)',
            padding: '8px 12px',
            pointerEvents: 'none',
            fontSize: 13
          }}
        >
          <div className="meta">
            {dayLabel(tip.day)}
            {tip.day === today ? t(' (so far)') : ''}
          </div>
          <strong>
            {tip.closed.toLocaleString(dateLocale())} {t('closed')}
          </strong>
        </div>
      )}
    </div>
  );
}

function ByType({ rows }: { rows: Report['byType'] }) {
  const max = Math.max(1, ...rows.map((r) => r.closed));
  if (rows.length === 0) return <div className="empty">{t('No tickets closed in this period.')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 24px 24px' }}>
      {rows.map((r) => (
        <div key={r.type} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{TYPE_LABEL[r.type]}</span>
            <strong>{r.closed.toLocaleString(dateLocale())}</strong>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: 'var(--gray-soft)' }}>
            <div
              style={{
                height: '100%',
                width: `${(r.closed / max) * 100}%`,
                minWidth: 10,
                borderRadius: 5,
                background: 'var(--brand)'
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Figures({ items }: { items: [string, string][] }) {
  return (
    <dl style={{ margin: 0, padding: '0 24px 20px', display: 'grid', gap: 12 }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <dt className="meta">{label}</dt>
          <dd style={{ margin: 0, fontWeight: 700 }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** W15: how the technical teams are doing over a period. */
export function ReportsPage() {
  useCrumbs([{ label: t('Insights') }, { label: t('Reports') }]);
  const me = useMe();
  const [period, setPeriod] = useState<PeriodKey>('14');
  const region = useRegion();
  const [areaId, setAreaId] = useState(region.areaId);
  useEffect(() => setAreaId(region.areaId), [region.areaId]);
  const [asTable, setAsTable] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const seesAll = hasRole(me.data, 'admin', 'technical_manager', 'noc');
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: seesAll
  });
  const { from, to } = periodDates(period);
  const params = `from=${from}&to=${to}${areaId ? `&areaId=${areaId}` : ''}`;
  const report = useQuery({
    queryKey: ['report', params],
    queryFn: () => api<Report>(`/reports?${params}`),
    refetchInterval: 120_000
  });
  const r = report.data;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const today = maputoToday();

  const save = async () => {
    setDownloading(null);
    try {
      await download(`/reports/tickets.csv?${params}`, `edm-tickets-${from}-to-${to}.csv`);
    } catch (e) {
      setDownloading((e as Error).message);
    }
  };

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>{t('Reports')}</h1>
          <div className="subtitle">{t('How the technical teams are doing')}</div>
        </div>
        <div className="btn-row">
          <select
            aria-label={t('Period')}
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodKey)}
          >
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {t(p.label)}
              </option>
            ))}
          </select>
          {seesAll && (
            <select aria-label={t('Area')} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">{t('All areas')}</option>
              {lookups.data?.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            <Download size={18} /> {t('Download report')}
          </button>
        </div>
      </div>
      {downloading && <div className="error">{downloading}</div>}
      {report.error && <div className="error">{(report.error as Error).message}</div>}

      {r && (
        <>
          <div className="kpis">
            <Kpi
              title={t('Tickets closed')}
              value={r.closed.toLocaleString(dateLocale())}
              note={comparison(r.closed, r.closedBefore, days)}
            />
            <Kpi
              title={t('Fixed on time')}
              value={pct(r.onTimePct)}
              note={t('Target {0}%', { 0: r.onTimeTarget })}
              alert={r.onTimePct !== null && r.onTimePct < r.onTimeTarget}
            />
            <Kpi
              title={t('Average time to fix (MTTR)')}
              value={duration(r.mttrMinutes)}
              note={t('From ticket created to fixed')}
            />
            <Kpi
              title={t('Fixed the first time')}
              value={pct(r.firstTimePct)}
              note={
                r.firstTimePct === null
                  ? t('Nothing checked yet')
                  : t('{0}% were reopened after the check', { 0: 100 - r.firstTimePct })
              }
            />
          </div>

          <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 420px)' }}>
            <section className="card">
              <div className="card-head">
                <h2>{t('Tickets closed per day')}</h2>
                <button type="button" className="btn btn-sm btn-soft" onClick={() => setAsTable((v) => !v)}>
                  {asTable ? t('Show chart') : t('Show as table')}
                </button>
              </div>
              <div style={{ padding: '0 24px 16px' }}>
                {asTable ? (
                  <div className="table-wrap" style={{ maxHeight: 260 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('Day')}</th>
                          <th className="right">{t('Closed')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.perDay.map((d) => (
                          <tr key={d.day}>
                            <td>{dayLabel(d.day)}</td>
                            <td className="right">{d.closed.toLocaleString(dateLocale())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <ClosedPerDay days={r.perDay} today={today} />
                )}
              </div>
            </section>
            <section className="card">
              <div className="card-head">
                <h2>{t('Tickets by type')}</h2>
              </div>
              <ByType rows={r.byType} />
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>{t('By team')}</h2>
            </div>
            {r.byTeam.length === 0 ? (
              <div className="empty">{t('No tickets closed or fixed in this period.')}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Team')}</th>
                      <th className="right">{t('Closed')}</th>
                      <th className="right">{t('On time')}</th>
                      <th className="right">{t('Avg. time to fix')}</th>
                      <th className="right">{t('Reopened')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.byTeam.map((t) => (
                      <tr key={t.teamId}>
                        <td>
                          <strong>{t.teamName}</strong>
                        </td>
                        <td className="right">{t.closed.toLocaleString(dateLocale())}</td>
                        <td
                          className="right"
                          style={
                            t.onTimePct !== null && t.onTimePct < r.onTimeTarget
                              ? { color: 'var(--late)', fontWeight: 700 }
                              : undefined
                          }
                        >
                          {pct(t.onTimePct)}
                        </td>
                        <td className="right">{duration(t.avgFixMinutes)}</td>
                        <td className="right">{pct(t.reopenedPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 420px)' }}>
            <section className="card">
              <div className="card-head">
                <h2>{t('By staff member')}</h2>
              </div>
              {r.byStaff.length === 0 ? (
                <div className="empty">{t('Nobody fixed a job in this period.')}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('Name')}</th>
                        <th>{t('Team')}</th>
                        <th className="right">{t('Jobs fixed')}</th>
                        <th className="right">{t('On time')}</th>
                        <th className="right">{t('Avg. time to fix')}</th>
                        <th className="right">{t('First time')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.byStaff.map((s) => (
                        <tr key={s.userId}>
                          <td>
                            <strong>{s.fullName}</strong>
                          </td>
                          <td>{s.teamName ?? '—'}</td>
                          <td className="right">{s.fixed}</td>
                          <td className="right">{pct(s.onTimePct)}</td>
                          <td className="right">{duration(s.avgFixMinutes)}</td>
                          <td className="right">{pct(s.firstTimePct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <div className="stack">
              <section className="card">
                <div className="card-head">
                  <h2>{t('Network incidents')}</h2>
                </div>
                <Figures
                  items={[
                    [t('Incidents'), r.incidents.count.toLocaleString(dateLocale())],
                    [t('Alarms from the NMS'), r.incidents.alarms.toLocaleString(dateLocale())],
                    [t('Average time to restore'), duration(r.incidents.avgRestoreMinutes)],
                    [t('Customers affected'), r.incidents.customersAffected.toLocaleString(dateLocale())]
                  ]}
                />
              </section>
              <section className="card">
                <div className="card-head">
                  <h2>{t('New customers')}</h2>
                </div>
                <Figures
                  items={[
                    [t('Surveys done'), String(r.newCustomers.surveysDone)],
                    [t('Average survey time'), avgDays(r.newCustomers.avgSurveyDays)],
                    [t('Connections done'), String(r.newCustomers.connectionsDone)],
                    [t('Average connection time'), avgDays(r.newCustomers.avgConnectionDays)],
                    [t('Waiting for activation by Sales'), String(r.newCustomers.waitingActivation)]
                  ]}
                />
              </section>
            </div>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>{t('Materials used')}</h2>
            </div>
            {r.materials.length === 0 ? (
              <div className="empty">{t('No material taken off stock in this period.')}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('Item')}</th>
                      <th>{t('Code')}</th>
                      <th className="right">{t('Used')}</th>
                      <th className="right">{t('On tickets')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.materials.map((m) => (
                      <tr key={m.itemId}>
                        <td>
                          <strong>{m.name}</strong>
                        </td>
                        <td className="meta">{m.code}</td>
                        <td className="right">{qty(m.quantity, m.unit)}</td>
                        <td className="right">{m.tickets}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
