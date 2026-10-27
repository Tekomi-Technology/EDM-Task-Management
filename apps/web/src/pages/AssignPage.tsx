import type { LiveMap, StaffSuggestion, TicketDetail } from '@edm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { MAP_COLORS, markerColor, TicketMap } from '../components/TicketMap';
import { Avatar, useCrumbs } from '../components/ui';
import { ago, distance, driveMinutes, firstName, timeLeft } from '../format';

function describeStaff(s: StaffSuggestion, teamName: string | null): string {
  const work =
    s.openJobs === 0 ? 'free now' : `${s.openJobs} unfinished ${s.openJobs === 1 ? 'job' : 'jobs'}`;
  const done = `${s.doneToday} done today`;
  return [teamName, s.onDuty ? work : 'off duty', done].filter(Boolean).join(' · ');
}

/** "Who should go?": choose field staff for a ticket. */
export function AssignPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => api<TicketDetail>(`/tickets/${id}`) });
  const t = ticket.data;
  const staff = useQuery({
    queryKey: ['suggestions', t?.teamId, id],
    queryFn: () => api<StaffSuggestion[]>(`/teams/${t!.teamId}/suggestions?ticketId=${id}`),
    enabled: !!t?.teamId
  });
  useCrumbs([{ label: 'All tickets', to: '/tickets' }, { label: t ? `Assign ${t.code}` : 'Assign' }]);

  const live = useQuery({
    queryKey: ['live'],
    queryFn: () => api<LiveMap>('/live'),
    refetchInterval: 30_000
  });
  const teamStaff = (live.data?.staff ?? []).filter((s) => s.teamId === t?.teamId);
  const options = (staff.data ?? []).filter((s) => s.id !== t?.assignee?.id);
  const chosen = options.find((s) => s.id === picked) ?? options.find((s) => s.bestMatch) ?? options[0];

  const assign = useMutation({
    mutationFn: (assigneeId: string) =>
      api<TicketDetail>(`/tickets/${id}/assign`, { method: 'POST', body: { assigneeId } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ticket', id], updated);
      void queryClient.invalidateQueries({ queryKey: ['tickets'] });
      void queryClient.invalidateQueries({ queryKey: ['overview'] });
      void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
      void queryClient.invalidateQueries({ queryKey: ['suggestions'] });
      navigate(`/tickets/${id}`);
    }
  });

  const mapTickets = useMemo(
    () =>
      t?.location
        ? [
            {
              id: t.id,
              code: t.code,
              title: t.title,
              status: t.status,
              lat: t.location.lat,
              lng: t.location.lng,
              type: t.type,
              late: !!timeLeft(t.dueAt, t.status)?.late
            }
          ]
        : [],
    [t]
  );

  if (ticket.isLoading) return <div className="content empty">Loading…</div>;
  if (!t)
    return (
      <div className="content error">{(ticket.error as Error | null)?.message ?? 'Ticket not found'}</div>
    );
  const left = timeLeft(t.dueAt, t.status);

  if (!t.allowedActions.includes('assign')) {
    return (
      <div className="content">
        <div className="notice">This ticket cannot be assigned now ({t.status.replace('_', ' ')}).</div>
        <Link to={`/tickets/${t.id}`}>Back to the ticket</Link>
      </div>
    );
  }

  return (
    <div className="content">
      <div>
        <h1>Who should go?</h1>
        <div className="subtitle">
          {t.title} · {t.areaName ?? 'outside the team areas'}
          {left && (
            <>
              {' · '}
              <span className={left.late ? 'late' : undefined}>
                {left.late ? left.text : `${left.text} left`}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(340px, 1fr)' }}>
        <section className="card" style={{ overflow: 'hidden' }}>
          {mapTickets.length ? (
            <TicketMap
              tickets={mapTickets}
              staff={teamStaff}
              selectedStaffId={chosen?.id}
              onStaff={setPicked}
              height={460}
              zoom={14}
            />
          ) : (
            <div className="empty">This ticket has no location.</div>
          )}
          <div className="legend">
            <span>
              <i style={{ background: mapTickets[0] ? markerColor(mapTickets[0]) : MAP_COLORS.open }} />{' '}
              Ticket
            </span>
            <span className="meta">
              <i style={{ background: MAP_COLORS.staff }} /> Selected staff
            </span>
            <span>
              <i style={{ border: `2px solid ${MAP_COLORS.staff}`, background: '#fff' }} /> Other staff
            </span>
            <span className="meta">{t.customer?.address ?? t.network?.elementName ?? ''}</span>
          </div>
        </section>

        <section className="card">
          <div className="card-head" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            <h2>Suggested staff</h2>
            <span className="meta" style={{ fontSize: 14 }}>
              Team {t.teamName}: on duty first, then fewest unfinished jobs, then nearest
            </span>
          </div>
          {staff.isLoading && <div className="empty">Loading…</div>}
          {staff.data && options.length === 0 && (
            <div className="empty">No other field staff in this team.</div>
          )}
          <div className="choices" role="radiogroup" aria-label="Field staff">
            {options.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={chosen?.id === s.id}
                className="choice"
                onClick={() => setPicked(s.id)}
              >
                <Avatar name={s.fullName} kind={s.onDuty ? undefined : 'system'} />
                <span className="grow">
                  <strong style={{ fontSize: 15 }}>{s.fullName}</strong>{' '}
                  {s.bestMatch && <span className="badge badge-brand">Best match</span>}
                  <div className="meta" style={{ fontSize: 14 }}>
                    {describeStaff(s, t.teamName)}
                  </div>
                </span>
                <span style={{ textAlign: 'right' }}>
                  <strong style={{ fontSize: 15 }}>
                    {distance(s.distanceM) ?? (s.onDuty ? 'on duty' : 'off duty')}
                  </strong>
                  <div className="meta">
                    {s.distanceM !== null
                      ? `about ${driveMinutes(s.distanceM)} min`
                      : s.locationAt
                        ? `seen ${ago(s.locationAt)}`
                        : 'position unknown'}
                  </div>
                </span>
              </button>
            ))}
          </div>
          {assign.error && (
            <div className="error" style={{ margin: '0 24px 12px' }}>
              {(assign.error as ApiRequestError).message}
            </div>
          )}
          <div className="panel-foot">
            <span className="meta" style={{ flex: 1, minWidth: 200, fontSize: 14 }}>
              {chosen ? `${firstName(chosen.fullName)} gets` : 'They get'} the job in the app (or by SMS); the
              customer was told when the ticket was opened.
            </span>
            <Link className="btn" to={`/tickets/${t.id}`}>
              Cancel
            </Link>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              disabled={!chosen || assign.isPending}
              onClick={() => chosen && assign.mutate(chosen.id)}
            >
              {chosen ? `Assign to ${firstName(chosen.fullName)}` : 'Assign'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
