import type { Lookups, StaffPerformance, StaffState } from '../types';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { Avatar, hasRole, useCrumbs, useMe } from '../components/ui';
import { ago, STAFF_STATE_LABEL, STATUS_LABEL, ticketTitle } from '../format';
import { useRegion } from '../components/topbar';
import { t } from '../i18n';

const STATE_BADGE: Record<StaffState, string> = {
  on_job: 'badge-assigned',
  free: 'badge-active',
  offline: 'badge',
  off_duty: 'badge-cancelled'
};

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const mins = (v: number | null) =>
  v === null ? '—' : v >= 120 ? `${Math.round(v / 60)} h` : t('{0} min', { 0: v });

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
  useCrumbs([{ label: t('Field') }, { label: t('Field staff') }]);
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
          <h1>{t('Field staff')}</h1>
          <div className="subtitle">
            {t(teamsOnDuty === 1 ? '{0} on duty now in {1} team' : '{0} on duty now in {1} teams', {
              0: onDuty,
              1: teamsOnDuty
            })}{' '}
            {t('· figures for the last {0} days', { 0: days })}
          </div>
        </div>
        <div className="btn-row">
          {seesAll && (
            <select aria-label={t('Team')} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">{t('All teams')}</option>
              {lookups.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select aria-label={t('Period')} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>{t('Today')}</option>
            <option value={7}>{t('Last 7 days')}</option>
            <option value={30}>{t('Last 30 days')}</option>
            <option value={90}>{t('Last 90 days')}</option>
          </select>
        </div>
      </div>
      {staff.error && <div className="error">{(staff.error as Error).message}</div>}
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)' }}>
        <section className="card">
          {staff.isLoading && <div className="empty">{t('Loading…')}</div>}
          {staff.data && rows.length === 0 && <div className="empty">{t('No field staff here.')}</div>}
          {rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Now')}</th>
                    <th className="right">{t('Jobs done')}</th>
                    <th className="right">{t('On time')}</th>
                    <th className="right">{t('Avg. to arrive')}</th>
                    <th className="right">{t('Fixed first time')}</th>
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
                            <div className="meta">{s.teamName ?? t('No team')}</div>
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
                  {t('Field staff ·')} {current.teamName ?? t('no team')}
                </div>
              </div>
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <Figure label={t('Jobs done')} value={current.jobsDone} />
              <Figure
                label={t('On time')}
                value={pct(current.onTimeRate)}
                alert={current.onTimeRate !== null && current.onTimeRate < 0.85}
              />
              <Figure label={t('Avg. to arrive')} value={mins(current.avgToArriveMin)} />
              <Figure label={t('Avg. to fix')} value={mins(current.avgFixMin)} />
              <Figure label={t('Reopened')} value={current.reopened} alert={current.reopened > 0} />
              <Figure label={t('Declined')} value={current.declined} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2>{t('Now')}</h2>
              <Row label={t('State')} value={STAFF_STATE_LABEL[current.state]} />
              <Row
                label={t('Jobs today')}
                value={t('{0} done · {1} to go', { 0: current.doneToday, 1: current.openJobs })}
              />
              <Row
                label={t('Working on')}
                value={
                  current.currentJob ? (
                    <Link to={`/tickets/${current.currentJob.id}`}>
                      {ticketTitle(current.currentJob.title)} ({STATUS_LABEL[current.currentJob.status]})
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <Row
                label={t('Last position')}
                value={current.location ? ago(current.location.at) : 'not shared yet'}
              />
              <Row label={t('Jobs given')} value={current.jobsAssigned} />
            </div>
            <div className="btn-row">
              <Link className="btn" to="/live" style={{ flex: 1 }}>
                {t('See on map')}
              </Link>
              {current.phone && (
                <a className="btn" href={`tel:${current.phone}`} style={{ flex: 1 }}>
                  {t('Call')}
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
