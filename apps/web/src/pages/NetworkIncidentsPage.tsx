import type { IncidentSummary, TicketDetail } from '@edm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, MessageSquare, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiRequestError } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { hasRole, useCrumbs, useMe } from '../components/ui';
import { formatTime, formatWhen, SEVERITY_LABEL, SOURCE_LABEL, timeCell, timeLeft } from '../format';
import { useRegion } from '../components/topbar';

const SEVERITY_CLASS: Record<string, string> = {
  critical: 'badge-late',
  major: 'badge-brand',
  minor: 'badge'
};

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity) return <span className="badge">Reported by phone</span>;
  return <span className={`badge ${SEVERITY_CLASS[severity] ?? ''}`}>{SEVERITY_LABEL[severity]}</span>;
}

function crewLine(i: IncidentSummary): string {
  if (!i.assignee) return i.teamName ? `Team ${i.teamName} · nobody assigned yet` : 'No team yet';
  const where =
    i.status === 'in_progress'
      ? 'on site'
      : i.status === 'accepted'
        ? 'on the way'
        : i.status === 'resolved'
          ? 'says it is fixed'
          : '';
  return `${i.assignee.fullName}${where ? ` ${where}` : ''}`;
}

function IncidentPanel({ id }: { id: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>(`/tickets/${id}`),
    refetchInterval: 20_000
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['incidents'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-counts'] });
  };
  const ack = useMutation({
    mutationFn: () => api<TicketDetail>(`/tickets/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: refresh
  });
  const notify = useMutation({
    mutationFn: () =>
      api<{ sent: number }>(`/incidents/${id}/notify-customers`, { method: 'POST', body: {} }),
    onSuccess: refresh
  });
  const check = useMutation({
    mutationFn: (action: 'close' | 'reopen') =>
      api<TicketDetail>(`/tickets/${id}/${action}`, {
        method: 'POST',
        body: { note: note.trim() || undefined }
      }),
    onSuccess: () => {
      setNote('');
      refresh();
    }
  });

  const t = ticket.data;
  if (!t) return <section className="card empty">Loading…</section>;
  const net = t.network!;
  const left = timeLeft(t.dueAt, t.status);
  const isNoc = hasRole(me.data, 'noc', 'admin', 'technical_manager');
  const error = (ack.error ?? notify.error ?? check.error) as ApiRequestError | null;

  return (
    <section className="card card-pad" style={{ gap: 18, padding: '24px 28px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="meta" style={{ fontSize: 14 }}>
            {t.code} · opened {formatWhen(t.createdAt)} by{' '}
            {t.source === 'nms' ? 'NMS' : `${SOURCE_LABEL[t.source]} (public report)`}
          </span>
          <h2 style={{ fontSize: 26 }}>{t.title}</h2>
          <span style={{ color: 'var(--text-2)' }}>
            {[t.areaName, net.elementName ?? net.elementCode].filter(Boolean).join(' · ')}
          </span>
          <div className="btn-row" style={{ gap: 8 }}>
            <StatusBadge status={t.status} />
            <SeverityBadge severity={net.severity} />
            {net.acknowledgedAt ? (
              <span className="badge badge-active">
                NOC: {net.acknowledgedBy ?? 'seen'} · {formatTime(net.acknowledgedAt)}
              </span>
            ) : (
              <span className="badge badge-late">Not acknowledged by NOC</span>
            )}
          </div>
        </div>
        <div className="btn-row">
          {isNoc && !net.acknowledgedAt && (
            <button type="button" className="btn" disabled={ack.isPending} onClick={() => ack.mutate()}>
              <Eye size={16} /> Acknowledge
            </button>
          )}
          {t.allowedActions.includes('assign') && (
            <button type="button" className="btn" onClick={() => navigate(`/tickets/${t.id}/assign`)}>
              <UserPlus size={16} /> {t.assignee ? 'Change crew' : 'Send a crew'}
            </button>
          )}
          {isNoc && net.linkedTickets.length > 0 && !['closed', 'cancelled'].includes(t.status) && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={notify.isPending}
              onClick={() => notify.mutate()}
            >
              <MessageSquare size={16} /> SMS affected customers
            </button>
          )}
        </div>
      </div>
      {notify.data && <div className="notice">SMS sent to {notify.data.sent} customers.</div>}
      {error && <div className="error">{error.message}</div>}

      <div className="facts" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <div className="box">
          <span className="label">Customers without power</span>
          <strong style={{ fontSize: 26 }}>
            {net.customersAffected !== null ? `≈ ${net.customersAffected.toLocaleString('en')}` : '—'}
          </strong>
        </div>
        <div className="box">
          <span className="label">Calls linked</span>
          <strong style={{ fontSize: 26 }}>{net.linkedTickets.length}</strong>
        </div>
        <div className="box">
          <span className="label">Crew</span>
          <strong style={{ fontSize: 17 }}>{t.assignee?.fullName ?? 'Nobody yet'}</strong>
          <span className="meta">{t.teamName ? `Team ${t.teamName}` : 'No team'}</span>
        </div>
        <div className="box">
          <span className="label">Time left</span>
          <strong
            style={{
              fontSize: 26,
              color: left?.late ? 'var(--late)' : left?.soon ? 'var(--warn)' : undefined
            }}
          >
            {left?.text ?? timeCell(t).text}
          </strong>
        </div>
      </div>

      <div>
        <h2 style={{ marginBottom: 10 }}>
          Grouped alarms · {net.alarms.length}
          {net.alarms.length > 0 && net.activeAlarms === 0 && (
            <span className="badge badge-active" style={{ marginLeft: 10 }}>
              all cleared
            </span>
          )}
        </h2>
        {net.alarms.length === 0 ? (
          <span className="meta">Reported by phone, no NMS alarms.</span>
        ) : (
          <div className="card table-wrap">
            <table>
              <tbody>
                {net.alarms.map((a) => (
                  <tr key={a.id}>
                    <td style={{ width: 70 }}>{formatTime(a.raisedAt)}</td>
                    <td className="wrap" style={{ fontWeight: 500 }}>
                      {a.alarmType}
                      {a.clearedAt && <span className="meta"> · cleared {formatTime(a.clearedAt)}</span>}
                    </td>
                    <td className="right meta">{a.elementName ?? a.elementCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2>Customer tickets linked to this incident · {net.linkedTickets.length}</h2>
        <span className="meta" style={{ fontSize: 14 }}>
          No-power calls from nearby are linked automatically. They are closed together when NOC closes the
          incident, and every caller gets an SMS.
        </span>
        {net.linkedTickets.slice(0, 6).map((l) => (
          <Link key={l.id} to={`/tickets/${l.id}`} style={{ textDecoration: 'none' }}>
            {l.code} · {l.customerName ?? l.title} · {l.address}
          </Link>
        ))}
        {net.linkedTickets.length > 6 && (
          <Link to={`/tickets/${t.id}`}>See all {net.linkedTickets.length}</Link>
        )}
      </div>

      {t.allowedActions.includes('close') && (
        <div className="box" style={{ gap: 10 }}>
          <strong>The crew says it is fixed: NOC check</strong>
          <textarea
            rows={2}
            placeholder="What the network shows (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={check.isPending}
              onClick={() => check.mutate('close')}
            >
              <Check size={16} /> Network is back, close
            </button>
            <button
              type="button"
              className="btn"
              disabled={check.isPending}
              onClick={() => check.mutate('reopen')}
            >
              Not fixed, send back
            </button>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link className="btn" to={`/tickets/${t.id}`}>
          Open ticket
        </Link>
      </div>
    </section>
  );
}

/** W08: alarms from the NMS grouped into incidents, and network problems reported by the public. */
export function NetworkIncidentsPage() {
  const { areaId, withArea } = useRegion();
  useCrumbs([{ label: 'Tickets', to: '/tickets' }, { label: 'Network incidents' }]);
  const [view, setView] = useState<'open' | 'recent'>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['incidents', view, areaId],
    queryFn: () => api<IncidentSummary[]>(withArea(`/incidents?view=${view}`)),
    refetchInterval: 20_000
  });
  const items = list.data ?? [];
  const current = items.find((i) => i.id === selected) ?? items[0];
  const lastAlarm = items
    .map((i) => i.lastAlarmAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>Network incidents</h1>
          <div className="subtitle">
            Alarms from the network management system (NMS) and network problems reported by the public.
            Alarms with the same cause are grouped into one incident.
          </div>
        </div>
        {lastAlarm && <span className="live">Last NMS alarm {formatWhen(lastAlarm)}</span>}
      </div>
      <div className="segmented">
        <button type="button" aria-pressed={view === 'open'} onClick={() => setView('open')}>
          Open
        </button>
        <button type="button" aria-pressed={view === 'recent'} onClick={() => setView('recent')}>
          Finished this week
        </button>
      </div>
      {list.error && <div className="error">{(list.error as Error).message}</div>}
      {list.data && items.length === 0 ? (
        <section className="card empty">
          {view === 'open' ? 'No open network incidents.' : 'Nothing finished this week.'}
        </section>
      ) : (
        <div className="two-col" style={{ gridTemplateColumns: 'minmax(280px, 420px) minmax(0, 1fr)' }}>
          <div className="stack" style={{ gap: 12 }}>
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                className="card card-pad"
                onClick={() => setSelected(i.id)}
                style={{
                  textAlign: 'left',
                  cursor: 'pointer',
                  gap: 6,
                  border: current?.id === i.id ? '2px solid var(--brand)' : undefined
                }}
              >
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <SeverityBadge severity={i.severity} />
                  <span className="meta">{formatWhen(i.createdAt)}</span>
                </span>
                <strong style={{ fontSize: 16 }}>{i.title}</strong>
                <span className="meta" style={{ fontSize: 14 }}>
                  {[
                    i.alarmCount ? `${i.alarmCount} alarm${i.alarmCount === 1 ? '' : 's'}` : 'phone report',
                    i.customersAffected !== null
                      ? `≈ ${i.customersAffected.toLocaleString('en')} customers`
                      : null,
                    i.linkedTickets ? `${i.linkedTickets} calls` : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span style={{ fontSize: 14 }}>{crewLine(i)}</span>
              </button>
            ))}
          </div>
          {current && <IncidentPanel key={current.id} id={current.id} />}
        </div>
      )}
    </div>
  );
}
