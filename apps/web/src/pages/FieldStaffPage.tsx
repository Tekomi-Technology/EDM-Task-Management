import type { Lookups, StaffPerformance, StaffState } from '@edm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Avatar, hasRole, useCrumbs, useMe } from '../components/ui';
import { ago, STAFF_STATE_LABEL, STATUS_LABEL } from '../format';
import { useRegion } from '../components/topbar';

const STATE_BADGE: Record<StaffState, string> = {
  on_job: 'badge-assigned',
  free: 'badge-active',
  offline: 'badge',
  off_duty: 'badge-cancelled'
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const mins = (v: number | null) => (v === null ? '—' : v >= 120 ? `${Math.round(v / 60)} h` : `${v} min`);

function Figure({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div className="box">
      <span className="label">{label}</span>
      <strong style={{ fontSize: 26, color: alert ? 'var(--late)' : undefined }}>{value}</strong>
    </div>
  );
}

/** W12: how each field staff member is doing now and over a period. */
export function FieldStaffPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: 'Field' }, { label: 'Field staff' }]);
  const me = useMe();
  const [teamId, setTeamId] = useState('');
  const [days, setDays] = useState(30);
  const [selected, setSelected] = useState<string | null>(null);
  const staff = useQuery({
    queryKey: ['field-staff', teamId, days, areaId],
    queryFn: () =>
      api<StaffPerformance[]>(withArea(`/field-staff?days=${days}${teamId ? `&teamId=${teamId}` : ''}`)),
    refetchInterval: 60_000
  });
  const seesAll = !hasRole(me.data, 'team_manager') || hasRole(me.data, 'admin', 'technical_manager', 'noc');
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: seesAll
  });
  const rows = staff.data ?? [];
  const current = rows.find((s) => s.id === selected) ?? rows[0];
  const onDuty = rows.filter((s) => s.state !== 'off_duty').length;
  const teamsOnDuty = new Set(rows.filter((s) => s.state !== 'off_duty').map((s) => s.teamName)).size;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Field staff</h1>
          <div className="subtitle">
            {onDuty} on duty now in {teamsOnDuty} {teamsOnDuty === 1 ? 'team' : 'teams'} · figures for the
            last {days} days
          </div>
        </div>
        <div className="btn-row">
          {seesAll && (
            <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">All teams</option>
              {lookups.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Today</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
      </div>
      {staff.error && <div className="error">{(staff.error as Error).message}</div>}
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)' }}>
        <section className="card">
          {staff.isLoading && <div className="empty">Loading…</div>}
          {staff.data && rows.length === 0 && <div className="empty">No field staff here.</div>}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Now</th>
                    <th className="right">Jobs done</th>
                    <th className="right">On time</th>
                    <th className="right">Avg. to arrive</th>
                    <th className="right">Fixed first time</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className={['clickable', current?.id === s.id ? 'selected' : ''].join(' ')}
                      onClick={() => setSelected(s.id)}
                    >
                      <td>
                        <span className="person">
                          <Avatar name={s.fullName} size="sm" />
                          <span>
                            <strong>{s.fullName}</strong>
                            <div className="meta">{s.teamName ?? 'No team'}</div>
                          </span>
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${STATE_BADGE[s.state]}`}>{STAFF_STATE_LABEL[s.state]}</span>
                      </td>
                      <td className="right">{s.jobsDone}</td>
                      <td
                        className={['right', s.onTimeRate !== null && s.onTimeRate < 0.85 ? 'late' : ''].join(
                          ' '
                        )}
                      >
                        {pct(s.onTimeRate)}
                      </td>
                      <td className="right">{mins(s.avgToArriveMin)}</td>
                      <td className="right">{pct(s.firstTimeFixRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {current && (
          <section className="card card-pad" style={{ gap: 16, padding: 24 }}>
            <div className="person">
              <Avatar name={current.fullName} size="lg" />
              <div>
                <strong style={{ fontSize: 18 }}>{current.fullName}</strong>
                <div className="meta" style={{ fontSize: 14 }}>
                  Field staff · {current.teamName ?? 'no team'}
                </div>
              </div>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Figure label="Jobs done" value={current.jobsDone} />
              <Figure
                label="On time"
                value={pct(current.onTimeRate)}
                alert={current.onTimeRate !== null && current.onTimeRate < 0.85}
              />
              <Figure label="Avg. to arrive" value={mins(current.avgToArriveMin)} />
              <Figure label="Avg. to fix" value={mins(current.avgFixMin)} />
              <Figure label="Reopened" value={current.reopened} alert={current.reopened > 0} />
              <Figure label="Declined" value={current.declined} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2>Now</h2>
              <Row label="State" value={STAFF_STATE_LABEL[current.state]} />
              <Row label="Jobs today" value={`${current.doneToday} done · ${current.openJobs} to go`} />
              <Row
                label="Working on"
                value={
                  current.currentJob ? (
                    <Link to={`/tickets/${current.currentJob.id}`}>
                      {current.currentJob.title} ({STATUS_LABEL[current.currentJob.status]})
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Row
                label="Last position"
                value={current.location ? ago(current.location.at) : 'not shared yet'}
              />
              <Row label="Jobs given" value={current.jobsAssigned} />
            </div>
            <div className="btn-row">
              <Link className="btn" to="/live" style={{ flex: 1 }}>
                See on map
              </Link>
              {current.phone && (
                <a className="btn" href={`tel:${current.phone}`} style={{ flex: 1 }}>
                  Call
                </a>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
