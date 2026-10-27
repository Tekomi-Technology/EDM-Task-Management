import type { LiveMap, Overview, StaffSuggestion, TicketSummary } from '../types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { api, ApiRequestError } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { MAP_COLORS, TicketMap } from '../components/TicketMap';
import { AssigneeCell, hasRole, useCrumbs, useMe } from '../components/ui';
import { firstName, greeting, longDate, timeCell, timeLeft, TYPE_LABEL } from '../format';
import { useRegion } from '../components/topbar';

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

/** The first unassigned ticket with the person automatic assignment would pick, and a one-click assign. */
function Suggestion({ ticket }: { ticket: TicketSummary }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const staff = useQuery({
    queryKey: ['suggestions', ticket.teamId],
    queryFn: () => api<StaffSuggestion[]>(`/teams/${ticket.teamId}/suggestions`),
    enabled: !!ticket.teamId
  });
  const best = staff.data?.find((s) => s.bestMatch);
  const assign = useMutation({
    mutationFn: (assigneeId: string) =>
      api(`/tickets/${ticket.id}/assign`, { method: 'POST', body: { assigneeId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
    }
  });
  const left = timeLeft(ticket.dueAt, ticket.status);
  return (
    <div className="unassigned-item">
      <Link className="ticket-title" to={`/tickets/${ticket.id}`}>
        {ticket.title}
      </Link>
      <span className="meta" style={{ fontSize: 14 }}>
        {ticket.areaName ?? 'Outside the team areas'}
        {left && (
          <>
            {' · '}
            <span className={left.late ? 'late' : undefined}>
              {left.late ? left.text : `${left.text} left`}
            </span>
          </>
        )}
      </span>
      {best ? (
        <span>
          Suggested: <strong>{best.fullName}</strong>, on duty · {best.openJobs} open{' '}
          {best.openJobs === 1 ? 'job' : 'jobs'}
        </span>
      ) : (
        ticket.teamId && <span className="meta">Nobody in the team is on duty.</span>
      )}
      {assign.error && <div className="error">{(assign.error as ApiRequestError).message}</div>}
      <div className="btn-row" style={{ marginTop: 6 }}>
        {best && (
          <button
            type="button"
            className="btn btn-soft"
            disabled={assign.isPending}
            onClick={() => assign.mutate(best.id)}
          >
            Assign to {firstName(best.fullName)}
          </button>
        )}
        <button type="button" className="btn" onClick={() => navigate(`/tickets/${ticket.id}/assign`)}>
          {best ? 'Other' : 'Choose someone'}
        </button>
      </div>
    </div>
  );
}

export function OverviewPage() {
  const { areaId, name: areaName, withArea } = useRegion();
  useCrumbs([{ label: 'Overview', to: '/' }, { label: 'Today' }]);
  const me = useMe();
  const navigate = useNavigate();
  const { data, error } = useQuery({
    queryKey: ['overview', areaId],
    queryFn: () => api<Overview>(withArea('/overview')),
    // Keep showing the last figures while another area loads, rather than an empty page.
    placeholderData: keepPreviousData,
    refetchInterval: 30_000
  });
  const canAssign = hasRole(me.data, 'team_manager', 'technical_manager', 'admin');
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
            {me.data?.teamName ? `Team ${me.data.teamName}` : areaName} · {longDate()}
          </div>
        </div>
      </div>
      {error && <div className="error">{(error as Error).message}</div>}
      {data && (
        <>
          <div className="kpis">
            <Kpi title="Open tickets" value={data.open} note={`${data.newToday} new today`} />
            <Kpi title="Being fixed now" value={data.beingFixed} note={`${data.staffOnDuty} staff on duty`} />
            <Kpi
              title="Waiting for check"
              value={data.waitingCheck}
              note={`Call Center ${data.waitingCallCenter} · NOC ${data.waitingCheck - data.waitingCallCenter}`}
            />
            <Kpi title="Late" value={data.late} note="Past their time limit and not fixed" alert />
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Tickets that need attention</h2>
                <Link to="/tickets">See all</Link>
              </div>
              {data.attention.length === 0 ? (
                <div className="empty">Nothing waiting. Well done.</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Ticket</th>
                        <th>Area</th>
                        <th>Assigned to</th>
                        <th>Status</th>
                        <th className="right">Time left</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attention.map((t) => {
                        const cell = timeCell(t);
                        return (
                          <tr key={t.id} className="clickable" onClick={() => navigate(`/tickets/${t.id}`)}>
                            <td className="wrap">
                              <Link className="ticket-title" to={`/tickets/${t.id}`}>
                                {t.title}
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
                  <h2>Nobody assigned yet</h2>
                  {data.unassigned.length > 0 && (
                    <span className="badge badge-late">{data.unassigned.length}</span>
                  )}
                </div>
                {data.unassigned.length === 0 ? (
                  <div className="empty" style={{ paddingTop: 8 }}>
                    Every ticket has someone.
                  </div>
                ) : (
                  <>
                    {canAssign ? (
                      <Suggestion ticket={data.unassigned[0]!} />
                    ) : (
                      <div className="unassigned-item">
                        <Link className="ticket-title" to={`/tickets/${data.unassigned[0]!.id}`}>
                          {data.unassigned[0]!.title}
                        </Link>
                        <span className="meta">
                          {data.unassigned[0]!.areaName ?? 'Outside the team areas'}
                        </span>
                      </div>
                    )}
                    {data.unassigned.slice(1).map((t) => (
                      <div key={t.id} className="unassigned-item">
                        <Link className="ticket-title" to={`/tickets/${t.id}`}>
                          {t.title}
                        </Link>
                        <span className="meta">
                          {t.areaName ?? 'Outside the team areas'} · {t.code}
                        </span>
                      </div>
                    ))}
                    <div className="unassigned-item">
                      <Link to="/tickets?view=unassigned" style={{ fontWeight: 700, textDecoration: 'none' }}>
                        See all unassigned
                      </Link>
                    </div>
                  </>
                )}
              </section>

              <section className="card" style={{ overflow: 'hidden' }}>
                <div className="card-head">
                  <h2>Live map</h2>
                  <Link to="/live">Open map</Link>
                  <span className="live">Live</span>
                </div>
                <div className="map-figures">
                  <div>
                    <strong>{data.map.length}</strong>
                    <span className="meta">on the map</span>
                  </div>
                  <div>
                    <strong>{data.staffOnDuty}</strong>
                    <span className="meta">staff on duty</span>
                  </div>
                  <div>
                    <strong style={{ color: late ? 'var(--late)' : undefined }}>{late}</strong>
                    <span className="meta">late</span>
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
                    <i style={{ background: MAP_COLORS.late }} /> Late
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.open }} /> Open
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.working }} /> Being fixed
                  </span>
                  <span>
                    <i style={{ background: MAP_COLORS.waiting }} /> Waiting for check
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
