import type { LiveMap, Overview } from '../types';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { api } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { MAP_COLORS, TicketMap } from '../components/TicketMap';
import { AssigneeCell, useCrumbs, useMe } from '../components/ui';
import { firstName, greeting, longDate, timeCell, TYPE_LABEL, ticketTitle } from '../format';
import { useRegion } from '../components/topbar';
import { t as tr } from '../i18n';

function Kpi({ title, value, note, alert }: { title: string; value: number; note: string; alert?: boolean }) {
  return (
    <section className="card kpi">
      <span className="head" style={alert ? { color: 'var(--late)' } : undefined}>
        {alert && <AlertTriangle size={18} />}
        {title}
      </span>
      <span className="value" style={alert && value > 0 ? { color: 'var(--late)' } : undefined}>
        {value}
      </span>
      <span className="meta" style={{ fontSize: 14 }}>
        {note}
      </span>
    </section>
  );
}

export function OverviewPage() {
  const { areaId, name: areaName, withArea } = useRegion();
  useCrumbs([{ label: tr('Overview'), to: '/' }, { label: tr('Today') }]);
  const me = useMe();
  const navigate = useNavigate();
  const { data, error } = useQuery({
    queryKey: ['overview', areaId],
    queryFn: () => api<Overview>(withArea('/overview')),
    // Keep showing the last figures while another area loads, rather than an empty page.
    placeholderData: keepPreviousData,
    refetchInterval: 30_000
  });
  const live = useQuery({
    queryKey: ['live', areaId],
    queryFn: () => api<LiveMap>(withArea('/live')),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000
  });
  const late = data?.map.filter((t) => t.late).length ?? 0;

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>
            {greeting()}
            {me.data ? `, ${firstName(me.data.fullName)}` : ''}
          </h1>
          <div className="subtitle">
            {me.data?.teamName ? tr('Team {0}', { 0: me.data.teamName }) : areaName} · {longDate()}
          </div>
        </div>
      </div>
      {error && <div className="error">{(error as Error).message}</div>}
      {data && (
        <>
          <div className="kpis">
            <Kpi
              title={tr('Open tickets')}
              value={data.open}
              note={tr('{0} new today', { 0: data.newToday })}
            />
            <Kpi
              title={tr('Being fixed now')}
              value={data.beingFixed}
              note={tr('{0} staff on duty', { 0: data.staffOnDuty })}
            />
            <Kpi
              title={tr('Waiting for check')}
              value={data.waitingCheck}
              note={tr('Call Center {0} · NOC {1}', {
                0: data.waitingCallCenter,
                1: data.waitingCheck - data.waitingCallCenter
              })}
            />
            <Kpi
              title={tr('Late')}
              value={data.late}
              note={tr('Past their time limit and not fixed')}
              alert
            />
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>{tr('Tickets that need attention')}</h2>
                <Link to="/tickets">{tr('See all')}</Link>
              </div>
              {data.attention.length === 0 ? (
                <div className="empty">{tr('Nothing waiting. Well done.')}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{tr('Ticket')}</th>
                        <th>{tr('Area')}</th>
                        <th>{tr('Assigned to')}</th>
                        <th>{tr('Status')}</th>
                        <th className="right">{tr('Time left')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attention.map((t) => {
                        const cell = timeCell(t);
                        return (
                          <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}>
                            <td className="wrap">
                              <Link className="ticket-title" to={`/tickets/${t.id}`}>
                                {ticketTitle(t.title)}
                              </Link>
                              <div className="meta">
                                {t.code} · {TYPE_LABEL[t.type]}
                              </div>
                            </td>
                            <td>{t.areaName ?? '—'}</td>
                            <td>
                              <AssigneeCell ticket={t} />
                            </td>
                            <td>
                              <StatusBadge status={t.status} />
                            </td>
                            <td className={['right', cell.className].filter(Boolean).join(' ')}>
                              {cell.text}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="stack">
              <section className="card">
                <div className="card-head">
                  <h2>{tr('Nobody assigned yet')}</h2>
                  {data.unassigned.length > 0 && (
                    <span className="badge badge-late">{data.unassigned.length}</span>
                  )}
                </div>
                {data.unassigned.length === 0 ? (
                  <div className="empty" style={{ paddingTop: 8 }}>
                    {tr('Every ticket has someone.')}
                  </div>
                ) : (
                  <>
                    <div className="meta" style={{ fontSize: 14, padding: '0 24px 12px' }}>
                      {tr('Nobody was left in the team to give these to. Open one to choose a person.')}
                    </div>
                    {data.unassigned.map((t) => (
                      <div key={t.id} className="unassigned-item">
                        <Link className="ticket-title" to={`/tickets/${t.id}`}>
                          {ticketTitle(t.title)}
                        </Link>
                        <span className="meta">
                          {t.areaName ?? tr('Outside the team areas')} · {t.code}
                        </span>
                      </div>
                    ))}
                    <div className="unassigned-item">
                      <Link to="/tickets?view=unassigned" style={{ fontWeight: 700, textDecoration: 'none' }}>
                        {tr('See all unassigned')}
                      </Link>
                    </div>
                  </>
                )}
              </section>

              <section className="card" style={{ overflow: 'hidden' }}>
                <div className="card-head">
                  <h2>{tr('Live map')}</h2>
                  <Link to="/live">{tr('Open map')}</Link>
                  <span className="live">{tr('Live')}</span>
                </div>
                <div className="map-figures">
                  <div>
                    <strong>{data.map.length}</strong>
                    <span className="meta">{tr('on the map')}</span>
                  </div>
                  <div>
                    <strong>{data.staffOnDuty}</strong>
                    <span className="meta">{tr('staff on duty')}</span>
                  </div>
                  <div>
                    <strong style={{ color: late ? 'var(--late)' : undefined }}>{late}</strong>
                    <span className="meta">{tr('late')}</span>
                  </div>
                </div>
                <TicketMap
                  tickets={data.map}
                  staff={live.data?.staff ?? []}
                  height={300}
                  onOpen={(id) => navigate(`/tickets/${id}`)}
                  onStaff={() => navigate('/live')}
                />
                <div className="legend">
                  <span>
                    <i style={{ background: MAP_COLORS.late }} /> {tr('Late')}
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.open }} /> {tr('Open')}
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.working }} /> {tr('Being fixed')}
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.waiting }} /> {tr('Waiting for check')}
                  </span>
                </div>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
