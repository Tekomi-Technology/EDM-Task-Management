import type { Lookups, TicketDetail, TicketEventView, TicketMessage, TicketStatus } from '@edm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, MapPin, Phone, UserPlus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, ApiRequestError } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { TicketMap } from '../components/TicketMap';
import { Avatar, hasRole, OFFICE_ROLES, useCrumbs, useMe } from '../components/ui';
import {
  EVENT_LABEL,
  firstName,
  formatTime,
  formatWhen,
  PREMISES_LABEL,
  qty,
  SEVERITY_LABEL,
  SUPPLY_LABEL,
  SURVEY_RESULT_LABEL,
  SOURCE_LABEL,
  timeLeft,
  TYPE_LABEL
} from '../format';

type Action = 'close' | 'reopen' | 'cancel';

const ORDER: TicketStatus[] = ['new', 'assigned', 'accepted', 'in_progress', 'resolved', 'closed'];
const rank = (s: TicketStatus) =>
  s === 'on_hold' ? 3 : s === 'reopened' ? 0 : s === 'cancelled' ? -1 : ORDER.indexOf(s);

/** The six steps of the progress bar, with the time each was reached (latest occurrence). */
function steps(t: TicketDetail) {
  const last = (type: string) => [...t.events].reverse().find((e) => e.type === type);
  const at = (e?: TicketEventView) => (e ? formatTime(e.createdAt) : undefined);
  const r = rank(t.status);
  const checker =
    t.source === 'call_center'
      ? 'by Call Center'
      : t.source === 'sales'
        ? t.type === 'new_connection'
          ? 'activated by Sales'
          : 'by itself'
        : 'by NOC';
  const doneLabel =
    t.type === 'new_customer_survey' ? 'Surveyed' : t.type === 'new_connection' ? 'Connected' : 'Fixed';
  const closeLabel = t.type === 'new_connection' ? 'Activated and closed' : 'Checked and closed';
  return [
    { label: 'Created', done: r >= 0 || t.status === 'reopened', note: at(last('created')) },
    { label: 'Assigned', done: r >= 1, note: r >= 1 ? at(last('assign')) : undefined },
    { label: 'Accepted', done: r >= 2, note: r >= 2 ? at(last('accept')) : undefined },
    { label: 'On site', done: r >= 3, note: r >= 3 ? at(last('start')) : undefined },
    {
      label: t.status === 'on_hold' ? `${doneLabel} (paused)` : doneLabel,
      done: r >= 4,
      note: r >= 4 ? at(last('resolve')) : r === 3 ? 'in progress' : undefined
    },
    { label: closeLabel, done: r >= 5, note: r >= 5 ? at(last('close')) : checker }
  ];
}

function describe(e: TicketEventView): string {
  const base = EVENT_LABEL[e.type] ?? e.type;
  if (e.type === 'assign' && typeof e.data.assigneeName === 'string') {
    return `${e.data.auto ? 'gave the job automatically to' : 'assigned the ticket to'} ${e.data.assigneeName}`;
  }
  if (e.type === 'resolve' && Array.isArray(e.data.attachmentIds) && e.data.attachmentIds.length) {
    const n = e.data.attachmentIds.length;
    return `reported the job done with ${n} ${n === 1 ? 'photo' : 'photos'}`;
  }
  if (e.type === 'note' && e.data.notified) return 'added a note, also sent to the staff member';
  if (e.type === 'linked' || e.type === 'unlinked' || e.type === 'closed_with_incident') {
    return `${base} ${String(e.data.incidentCode ?? '')}`.trim();
  }
  if (e.type === 'alarm_raised' || e.type === 'alarm_cleared') {
    return `${base}: ${String(e.data.alarmType ?? '')} (${String(e.data.elementCode ?? '')})`;
  }
  if (e.type === 'team_changed' && typeof e.data.teamName === 'string')
    return `moved it to team ${e.data.teamName}`;
  if (e.type === 'escalate') {
    const told =
      Array.isArray(e.data.notified) && e.data.notified.length ? `: told ${e.data.notified.join(', ')}` : '';
    const what =
      e.data.level === 1 ? 'time is running out' : e.data.level === 2 ? 'past the time limit' : 'badly late';
    return `${what}${told}`;
  }
  return base;
}

function Timeline({ events }: { events: TicketEventView[] }) {
  return (
    <ol className="timeline">
      {[...events].reverse().map((e) => {
        const system = !e.actorName || e.actorName.startsWith('System') || e.actorName.endsWith('system');
        return (
          <li key={e.id}>
            <Avatar name={e.actorName ?? 'System'} kind={system ? 'system' : undefined} />
            <div className="what">
              <div>
                <span className="meta when">{formatWhen(e.createdAt)}</span>
                <strong>{e.actorName ?? 'System'}</strong>{' '}
                <span style={{ color: 'var(--text-2)' }}>{describe(e)}</span>
              </div>
              {typeof e.data.occurredAt === 'string' && (
                <div className="meta">
                  Done at {formatWhen(e.data.occurredAt)} without signal, sent when back online
                </div>
              )}
              {typeof e.data.note === 'string' && <div className="note">{e.data.note}</div>}
              {typeof e.data.reason === 'string' && <div className="note">Reason: {e.data.reason}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const office = hasRole(me.data, ...OFFICE_ROLES);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'activity' | 'photos' | 'messages'>('activity');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [checkNote, setCheckNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>(`/tickets/${id}`),
    refetchInterval: 30_000
  });
  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<TicketMessage[]>(`/tickets/${id}/messages`),
    enabled: office
  });
  useCrumbs([
    { label: 'All tickets', to: '/tickets' },
    { label: ticket.data ? `${ticket.data.code} · ${ticket.data.title}` : 'Ticket' }
  ]);

  const done = (updated: TicketDetail) => {
    queryClient.setQueryData(['ticket', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
    void queryClient.invalidateQueries({ queryKey: ['messages', id] });
  };
  const act = useMutation({
    mutationFn: (v: { action: Action; body: object }) =>
      api<TicketDetail>(`/tickets/${id}/${v.action}`, { method: 'POST', body: v.body }),
    onSuccess: (updated) => {
      done(updated);
      setCheckNote('');
      setCancelling(false);
      setCancelReason('');
    }
  });
  const post = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/tickets/${id}/notes`, {
        method: 'POST',
        body: { text: note, notifyAssignee: notify }
      }),
    onSuccess: (updated) => {
      done(updated);
      setNote('');
    }
  });

  if (ticket.isLoading) return <div className="content empty">Loading…</div>;
  if (ticket.error) {
    const err = ticket.error as ApiRequestError;
    return (
      <div className="content">
        <div className="error">
          {err.error?.statusCode === 404 ? 'This ticket does not exist or is not in your team.' : err.message}
        </div>
        <Link to="/tickets">Back to tickets</Link>
      </div>
    );
  }
  const t = ticket.data!;
  const left = timeLeft(t.dueAt, t.status);
  const error = (act.error ?? post.error) as ApiRequestError | null;
  const canAssign = t.allowedActions.includes('assign');
  const canCheck = t.allowedActions.includes('close');
  const canRoute = hasRole(me.data, 'noc', 'admin', 'technical_manager');
  const assigneeHasJob =
    !!t.assignee && ['assigned', 'accepted', 'in_progress', 'on_hold'].includes(t.status);
  const cancelEvent =
    t.status === 'cancelled' ? [...t.events].reverse().find((e) => e.type === 'cancel') : undefined;
  const created = t.events.find((e) => e.type === 'created');
  const totalMinutes = t.dueAt ? (new Date(t.dueAt).getTime() - new Date(t.createdAt).getTime()) / 60_000 : 0;
  const usedMinutes = (Date.now() - new Date(t.createdAt).getTime()) / 60_000;
  const photos = t.attachments.filter((a) => a.url);

  return (
    <div className="content">
      <section className="card card-pad" style={{ gap: 20, padding: '24px 28px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="btn-row" style={{ gap: 8 }}>
              <StatusBadge status={t.status} />
              <span className="badge">
                {TYPE_LABEL[t.type] === 'Customer' ? 'Customer complaint' : TYPE_LABEL[t.type]}
              </span>
              <span className="badge">Priority {t.priority}</span>
            </div>
            <h1>{t.title}</h1>
            <div className="subtitle">
              {t.code} · Opened {created ? formatWhen(created.createdAt) : formatWhen(t.createdAt)} by{' '}
              {SOURCE_LABEL[t.source]}
              {t.externalRef ? ` (ref ${t.externalRef})` : ''} ·{' '}
              {t.teamName ? `Team ${t.teamName}` : 'not in any team area'}
            </div>
          </div>
          <div className="btn-row">
            {canAssign && (
              <button
                type="button"
                className="btn btn-lg"
                onClick={() => navigate(`/tickets/${t.id}/assign`)}
              >
                <UserPlus size={18} /> {t.assignee ? 'Reassign' : 'Assign'}
              </button>
            )}
            {t.allowedActions.includes('cancel') && !cancelling && (
              <button type="button" className="btn btn-lg btn-danger" onClick={() => setCancelling(true)}>
                <XCircle size={18} /> Cancel ticket
              </button>
            )}
          </div>
        </div>
        {cancelling && (
          <div className="box" style={{ gap: 10 }}>
            <label htmlFor="cancel-reason" style={{ fontWeight: 700 }}>
              Why cancel? For example a duplicate, or the customer withdrew the request.
            </label>
            <textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
            />
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-danger"
                disabled={act.isPending || cancelReason.trim().length < 3}
                onClick={() => act.mutate({ action: 'cancel', body: { reason: cancelReason } })}
              >
                Cancel ticket
              </button>
              <button type="button" className="btn" onClick={() => setCancelling(false)}>
                Keep it
              </button>
            </div>
          </div>
        )}
        {cancelEvent && (
          <div className="note">
            Cancelled by {cancelEvent.actorName ?? 'System'} on {formatWhen(cancelEvent.createdAt)}:{' '}
            {String(cancelEvent.data.reason ?? '')}
          </div>
        )}
        {t.incident && (
          <div className="notice">
            Caused by network incident{' '}
            <Link to={`/tickets/${t.incident.id}`} style={{ fontWeight: 700 }}>
              {t.incident.code} · {t.incident.title}
            </Link>
            . Nobody else is sent; this ticket closes when the incident is closed.
          </div>
        )}
        {t.escalationLevel >= 2 && !['closed', 'cancelled', 'resolved'].includes(t.status) && (
          <div className="error">
            {t.escalationLevel === 3
              ? 'Badly late: technical managers, team manager and NOC have been told.'
              : 'Past the time limit: the team manager and NOC have been told.'}
          </div>
        )}
        {t.status !== 'cancelled' && (
          <ol className="steps" aria-label="Progress">
            {steps(t).map((s, i, all) => {
              const now = !s.done && (i === 0 || all[i - 1]!.done);
              return (
                <li key={s.label} className={s.done ? 'done' : now ? 'now' : undefined}>
                  <span className="bar" />
                  <strong>{s.label}</strong>
                  <span className="meta">{s.note ?? ''}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {error && <div className="error">{error.message}</div>}

      <div className="two-col">
        <section className="card">
          <div className="tabs" role="tablist" aria-label="Ticket information">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'activity'}
              onClick={() => setTab('activity')}
            >
              Activity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'photos'}
              onClick={() => setTab('photos')}
            >
              Photos · {photos.length}
            </button>
            {office && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'messages'}
                onClick={() => setTab('messages')}
              >
                SMS &amp; notifications · {messages.data?.length ?? 0}
              </button>
            )}
          </div>

          {tab === 'activity' && (
            <>
              {office && (
                <form
                  className="composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (note.trim()) post.mutate();
                  }}
                >
                  {me.data && <Avatar name={me.data.fullName} />}
                  <div className="box-input">
                    <textarea
                      rows={2}
                      aria-label="Note"
                      placeholder={
                        t.assignee
                          ? `Write a note for ${firstName(t.assignee.fullName)} or the team…`
                          : 'Write a note for the team…'
                      }
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="row">
                      {assigneeHasJob ? (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={notify}
                            onChange={(e) => setNotify(e.target.checked)}
                          />
                          Also send to {firstName(t.assignee!.fullName)} (app or SMS)
                        </label>
                      ) : (
                        <span className="meta">Only the office sees notes.</span>
                      )}
                      <button type="submit" className="btn" disabled={!note.trim() || post.isPending}>
                        Post note
                      </button>
                    </div>
                  </div>
                </form>
              )}
              <Timeline events={t.events} />
            </>
          )}

          {tab === 'photos' &&
            (photos.length === 0 ? (
              <div className="empty">No photos yet. Field staff add them when they finish the job.</div>
            ) : (
              <div className="photos">
                {photos.map((a) => (
                  <a key={a.id} href={a.url!} target="_blank" rel="noreferrer">
                    <img src={a.url!} alt={a.fileName} />
                  </a>
                ))}
              </div>
            ))}

          {tab === 'messages' &&
            (messages.data?.length ? (
              <ul className="messages">
                {messages.data.map((m) => (
                  <li key={m.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong>
                        {m.channel === 'push' ? 'App notification' : 'SMS'} to {m.to}
                      </strong>
                      <span className="meta">
                        {formatWhen(m.createdAt)} ·{' '}
                        <span className={m.status === 'failed' ? 'late' : undefined}>
                          {m.status === 'sent' ? 'sent' : m.status === 'failed' ? 'not delivered' : 'sending'}
                        </span>
                      </span>
                    </div>
                    <span style={{ color: 'var(--text-2)' }}>{m.body}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty">No messages sent yet.</div>
            ))}
        </section>

        <aside className="stack">
          {t.network && <NetworkCard t={t} onChange={done} />}
          {t.newCustomer && <NewCustomerCard t={t} />}
          {(t.materials.length > 0 || t.reservations.length > 0) && <MaterialsCard t={t} />}
          {t.planned && (
            <section className="card card-pad">
              <span className="label" style={{ fontSize: 15 }}>
                {t.planned.kind === 'network_change' ? 'Planned network change' : 'Planned maintenance'}
              </span>
              <strong style={{ fontSize: 17 }}>
                {formatWhen(t.planned.scheduledStart)} – {formatTime(t.planned.scheduledEnd)}
              </strong>
              {t.planned.element && <span>{t.planned.element}</span>}
              <span className={t.planned.outage ? 'late' : 'meta'}>
                {t.planned.outage
                  ? `Power cut${t.planned.customersAffected !== null ? ` for about ${t.planned.customersAffected} customers` : ''}`
                  : 'No power cut'}
              </span>
            </section>
          )}
          {!t.teamId && canRoute && !['closed', 'cancelled'].includes(t.status) && (
            <TeamPanel ticketId={t.id} onChange={done} />
          )}
          {left ? (
            <section className="card card-pad">
              <span className="label" style={{ fontSize: 15 }}>
                Time left to fix
              </span>
              <div>
                <span style={{ fontSize: 32, fontWeight: 700, color: left.late ? 'var(--late)' : undefined }}>
                  {left.text}
                </span>
                {totalMinutes > 0 && (
                  <span className="meta" style={{ fontSize: 15 }}>
                    {' '}
                    of{' '}
                    {totalMinutes >= 120
                      ? `${Math.round(totalMinutes / 60)} h`
                      : `${Math.round(totalMinutes)} min`}
                  </span>
                )}
              </div>
              <div className={left.late ? 'progress over' : 'progress'}>
                <span
                  style={{ width: `${Math.min(100, (usedMinutes / Math.max(totalMinutes, 1)) * 100)}%` }}
                />
              </div>
              <span className="meta" style={{ fontSize: 14 }}>
                Due at {formatWhen(t.dueAt!)}.{left.late ? ' It is shown as late to the team manager.' : ''}
              </span>
            </section>
          ) : null}

          {canCheck && (
            <section className="card card-pad" aria-label="Check the work">
              <h2>Check the work</h2>
              <span className="meta" style={{ fontSize: 14 }}>
                {t.source === 'call_center'
                  ? 'Normally the Call Center system records this after calling the customer.'
                  : 'Confirm with the network that the fault is cleared.'}
              </span>
              <textarea
                rows={2}
                placeholder="Note (optional)"
                value={checkNote}
                onChange={(e) => setCheckNote(e.target.value)}
              />
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: 'close', body: { note: checkNote } })}
                >
                  Close ticket
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: 'reopen', body: { note: checkNote } })}
                >
                  Not fixed, send back
                </button>
              </div>
            </section>
          )}

          {t.customer && (
            <section className="card card-pad">
              <span className="label" style={{ fontSize: 15 }}>
                Customer
              </span>
              <div>
                <strong style={{ fontSize: 17 }}>{t.customer.fullName}</strong>
                <div className="meta" style={{ fontSize: 14 }}>
                  {t.customer.contractNo ? `Contract ${t.customer.contractNo}` : 'No contract yet'}
                  {t.customer.meterNumber ? ` · meter ${t.customer.meterNumber}` : ''}
                </div>
              </div>
              <span>{t.customer.address}</span>
              {t.customer.phone && (
                <a href={`tel:${t.customer.phone}`} style={{ textDecoration: 'none' }}>
                  <Phone size={14} /> {t.customer.phone}
                </a>
              )}
              {office && t.customer.contractNo && (
                <Link
                  to={`/tickets?view=all&q=${encodeURIComponent(t.customer.contractNo)}`}
                  style={{ fontWeight: 700, textDecoration: 'none' }}
                >
                  All tickets of this customer
                </Link>
              )}
            </section>
          )}

          <section className="card card-pad">
            <span className="label" style={{ fontSize: 15 }}>
              Assigned to
            </span>
            {t.assignee ? (
              <div className="person">
                <Avatar name={t.assignee.fullName} size="lg" />
                <div>
                  <strong>{t.assignee.fullName}</strong>
                  <div className="meta" style={{ fontSize: 14 }}>
                    {t.teamName ? `Team ${t.teamName}` : ''}
                  </div>
                </div>
              </div>
            ) : (
              <span className="meta" style={{ fontSize: 14 }}>
                Nobody yet
              </span>
            )}
          </section>

          {t.location && (
            <section className="card" style={{ overflow: 'hidden' }}>
              <div className="card-head">
                <h2>Where</h2>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${t.location.lat}&mlon=${t.location.lng}#map=17/${t.location.lat}/${t.location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin size={14} /> Open map
                </a>
              </div>
              <TicketMap
                height={200}
                tickets={[
                  {
                    id: t.id,
                    code: t.code,
                    title: t.title,
                    status: t.status,
                    lat: t.location.lat,
                    lng: t.location.lng,
                    type: t.type,
                    late: !!left?.late
                  }
                ]}
              />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Network incident: element, alarms, linked customer tickets and NOC acknowledgement. */
function NetworkCard({ t, onChange }: { t: TicketDetail; onChange: (updated: TicketDetail) => void }) {
  const me = useMe();
  const net = t.network!;
  const ack = useMutation({
    mutationFn: () => api<TicketDetail>(`/tickets/${t.id}/acknowledge`, { method: 'POST' }),
    onSuccess: onChange
  });
  return (
    <section className="card card-pad">
      <span className="label" style={{ fontSize: 15 }}>
        Network
      </span>
      <strong style={{ fontSize: 17 }}>{net.elementName ?? net.elementCode ?? 'Reported by phone'}</strong>
      <span className="meta" style={{ fontSize: 14 }}>
        {[
          net.severity ? `${SEVERITY_LABEL[net.severity]} severity` : null,
          net.alarms.length ? `${net.activeAlarms} of ${net.alarms.length} alarms active` : null,
          net.customersAffected !== null ? `≈ ${net.customersAffected.toLocaleString('en')} customers` : null
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {net.alarms.map((a) => (
        <span key={a.id} style={{ fontSize: 14, color: a.clearedAt ? 'var(--muted)' : undefined }}>
          {formatTime(a.raisedAt)} {a.alarmType} · {a.elementCode}
          {a.clearedAt ? ' (cleared)' : ''}
        </span>
      ))}
      <span>
        {net.linkedTickets.length} customer {net.linkedTickets.length === 1 ? 'ticket' : 'tickets'} linked
      </span>
      {net.acknowledgedAt ? (
        <span className="meta">
          Acknowledged by {net.acknowledgedBy ?? 'NOC'} at {formatTime(net.acknowledgedAt)}
        </span>
      ) : (
        hasRole(me.data, 'noc', 'admin', 'technical_manager') && (
          <button type="button" className="btn" disabled={ack.isPending} onClick={() => ack.mutate()}>
            <Eye size={16} /> Acknowledge (NOC)
          </button>
        )
      )}
      <Link to="/incidents" style={{ fontWeight: 700, textDecoration: 'none' }}>
        Network incidents
      </Link>
    </section>
  );
}

/** Tickets outside every area have no team: NOC puts them in one, and they are assigned as usual. */
function TeamPanel({ ticketId, onChange }: { ticketId: string; onChange: (updated: TicketDetail) => void }) {
  const [teamId, setTeamId] = useState('');
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups') });
  const move = useMutation({
    mutationFn: () => api<TicketDetail>(`/tickets/${ticketId}/team`, { method: 'POST', body: { teamId } }),
    onSuccess: onChange
  });
  return (
    <section className="card card-pad" aria-label="Choose a team">
      <h2>No team yet</h2>
      <span className="meta" style={{ fontSize: 14 }}>
        The place is outside every team area. Choose the team that should go.
      </span>
      <select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        <option value="">Choose a team…</option>
        {lookups.data?.teams.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} · {x.areaName}
          </option>
        ))}
      </select>
      {move.error && <div className="error">{(move.error as ApiRequestError).message}</div>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={!teamId || move.isPending}
        onClick={() => move.mutate()}
      >
        Send to this team
      </button>
    </section>
  );
}

/** Survey report or installation of a new customer. */
function NewCustomerCard({ t }: { t: TicketDetail }) {
  const n = t.newCustomer!;
  return (
    <section className="card card-pad">
      <span className="label" style={{ fontSize: 15 }}>
        {n.kind === 'survey' ? 'New customer survey' : 'New connection'}
      </span>
      <strong style={{ fontSize: 17 }}>
        {[n.premises ? PREMISES_LABEL[n.premises] : null, n.supply ? SUPPLY_LABEL[n.supply] : null]
          .filter(Boolean)
          .join(' · ')}
        {n.requestedLoadKw ? ` · ${n.requestedLoadKw} kW` : ''}
      </strong>
      {n.contractNo && <span>Contract {n.contractNo}</span>}
      {n.surveyTicket && (
        <Link to={`/tickets/${n.surveyTicket.id}`} style={{ textDecoration: 'none' }}>
          Survey {n.surveyTicket.code}
        </Link>
      )}
      {n.survey && (
        <div className="box" style={{ gap: 6 }}>
          <strong className={n.survey.result === 'not_feasible' ? 'late' : undefined}>
            {SURVEY_RESULT_LABEL[n.survey.result]}
          </strong>
          {n.survey.distanceToNetworkM !== null && (
            <span>
              {n.survey.distanceToNetworkM} m to the network
              {n.survey.nearestElement ? ` (${n.survey.nearestElement})` : ''}
            </span>
          )}
          {n.survey.worksNeeded && <span>Works: {n.survey.worksNeeded}</span>}
          {n.survey.estimatedMaterials.length > 0 && (
            <span className="meta">
              Estimate:{' '}
              {n.survey.estimatedMaterials.map((m) => `${m.name} ${qty(m.quantity, m.unit)}`).join(', ')}
            </span>
          )}
        </div>
      )}
      {n.installation && (
        <div className="box" style={{ gap: 4 }}>
          <span>
            Meter <strong>{n.installation.meterNumber}</strong>
            {n.installation.sealNumber ? ` · seal ${n.installation.sealNumber}` : ''}
          </span>
          <span className="meta">
            Customer confirmed {formatWhen(n.installation.confirmedAt)} by{' '}
            {n.installation.confirmedBy === 'sms_code' ? 'the SMS code' : 'signing the handover form'}
          </span>
        </div>
      )}
      {n.kind === 'connection' &&
        (n.activatedAt ? (
          <span className="badge badge-active" style={{ alignSelf: 'flex-start' }}>
            Active since {formatWhen(n.activatedAt)}
          </span>
        ) : (
          t.status === 'resolved' && (
            <span className="meta">Waiting for the Sales system to activate the service.</span>
          )
        ))}
    </section>
  );
}

/** Materials recorded on the job (deducted when it closes) and material set aside in the depot. */
function MaterialsCard({ t }: { t: TicketDetail }) {
  return (
    <section className="card card-pad">
      <span className="label" style={{ fontSize: 15 }}>
        Materials
      </span>
      {t.materials.map((m) => (
        <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span>
            {m.name} <span className="meta">{m.fromLocation ? `· ${m.fromLocation}` : ''}</span>
          </span>
          <span>
            {qty(m.quantity, m.unit)} <span className="meta">{m.posted ? 'deducted' : 'when closed'}</span>
          </span>
        </div>
      ))}
      {t.reservations.length > 0 && (
        <>
          <span className="label">Set aside</span>
          {t.reservations.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span>
                {r.name} <span className="meta">· {r.locationName}</span>
              </span>
              <span>{qty(r.quantity, r.unit)}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
