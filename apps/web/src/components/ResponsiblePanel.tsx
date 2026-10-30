import type { Lookups, StaffSuggestion, TicketDetail } from '../types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { firstName } from '../format';
import { t as tr } from '../i18n';
import { Avatar, CHOOSE_TEAM_ROLES, hasRole, useMe } from './ui';

const FINISHED = ['resolved', 'closed', 'cancelled'];
const HOLDING = ['assigned', 'accepted', 'in_progress', 'on_hold'];

type Mode = 'team' | 'takeBack' | 'person' | null;

/**
 * "Who is on it": the team and the person holding the ticket, in one place. Jobs are given out automatically; from
 * here NOC, technical managers and administrators move a ticket to another team, and managers take a job back or
 * name the person who goes.
 */
export function ResponsiblePanel({
  t,
  onChange
}: {
  t: TicketDetail;
  onChange: (updated: TicketDetail) => void;
}) {
  const me = useMe();
  const unfinished = !FINISHED.includes(t.status);
  const canRoute = unfinished && hasRole(me.data, ...CHOOSE_TEAM_ROLES);
  const canAssign = t.allowedActions.includes('assign');
  const holding = !!t.assignee && HOLDING.includes(t.status);
  const [mode, setMode] = useState<Mode>(canRoute && !t.teamId ? 'team' : null);
  const close = (updated: TicketDetail) => {
    setMode(null);
    onChange(updated);
  };

  return (
    <section className="card card-pad responsible" aria-label={tr('Who is on it')}>
      <span className="label" style={{ fontSize: 15 }}>
        {tr('Who is on it')}
      </span>

      <div className="responsible-row">
        <span className="meta">{tr('Team')}</span>
        <strong>{t.teamName ?? tr('No team yet')}</strong>
        {canRoute && mode !== 'team' && (
          <button type="button" className="btn btn-sm" onClick={() => setMode('team')}>
            {t.teamId ? tr('Move to another team') : tr('Choose a team')}
          </button>
        )}
      </div>
      {mode === 'team' && <TeamForm t={t} onDone={close} onCancel={() => setMode(null)} />}

      <div className="responsible-row">
        <span className="meta">{tr('Person')}</span>
        {t.assignee ? (
          <span className="person">
            <Avatar name={t.assignee.fullName} />
            <strong>{t.assignee.fullName}</strong>
          </span>
        ) : unfinished ? (
          <strong className="late">{tr('Nobody yet')}</strong>
        ) : (
          <span className="meta">—</span>
        )}
        {mode === null && (holding || (canAssign && unfinished)) && (
          <span className="btn-row" style={{ gap: 6 }}>
            {holding && canAssign && (
              <button type="button" className="btn btn-sm" onClick={() => setMode('takeBack')}>
                {tr('Take the job back')}
              </button>
            )}
            {canAssign && t.teamId && (
              <button type="button" className="btn btn-sm" onClick={() => setMode('person')}>
                {t.assignee ? tr('Change person') : tr('Choose a person')}
              </button>
            )}
          </span>
        )}
      </div>
      {unfinished && !t.assignee && mode === null && (
        <div className="meta" style={{ fontSize: 14 }}>
          {t.incident
            ? tr('Nobody is sent: it closes with network incident {0}.', { 0: t.incident.code })
            : !t.teamId
              ? tr('Choose a team first; the job is then given out automatically.')
              : tr(
                  'Nobody in the team is on duty to take it. It goes to the first one who switches duty on.'
                )}
        </div>
      )}
      {mode === 'takeBack' && <TakeBackForm t={t} onDone={close} onCancel={() => setMode(null)} />}
      {mode === 'person' && <PersonForm t={t} onDone={close} onCancel={() => setMode(null)} />}
    </section>
  );
}

interface FormProps {
  t: TicketDetail;
  onDone: (updated: TicketDetail) => void;
  onCancel: () => void;
}

function TeamForm({ t, onDone, onCancel }: FormProps) {
  const [teamId, setTeamId] = useState('');
  const [reason, setReason] = useState('');
  const lookups = useQuery({ queryKey: ['lookups'], queryFn: () => api<Lookups>('/lookups') });
  const move = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/tickets/${t.id}/team`, {
        method: 'POST',
        body: { teamId, reason: reason.trim() || undefined }
      }),
    onSuccess: onDone
  });
  const needsReason = !!t.teamId;
  return (
    <div className="responsible-form">
      {!t.teamId && (
        <span className="meta" style={{ fontSize: 14 }}>
          {tr('The place is outside every team area. Choose the team that should go.')}
        </span>
      )}
      <select aria-label={tr('Team')} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
        <option value="">{tr('Choose a team…')}</option>
        {lookups.data?.teams
          .filter((x) => x.id !== t.teamId)
          .map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {x.areaName}
            </option>
          ))}
      </select>
      {needsReason && (
        <input
          aria-label={tr('Why it moves')}
          value={reason}
          maxLength={300}
          placeholder={tr('Why it moves, e.g. place marked wrongly, closer team')}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      {t.assignee && (
        <div className="notice" style={{ margin: 0 }}>
          {tr('{0} no longer has the job and is told; the new team gets it like a new ticket.', {
            0: t.assignee.fullName
          })}
        </div>
      )}
      {move.error && <div className="error">{(move.error as ApiRequestError).message}</div>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!teamId || (needsReason && reason.trim().length < 3) || move.isPending}
          onClick={() => move.mutate()}
        >
          {t.teamId ? tr('Move to this team') : tr('Send to this team')}
        </button>
        {t.teamId && (
          <button type="button" className="btn" onClick={onCancel}>
            {tr('Keep this team')}
          </button>
        )}
      </div>
    </div>
  );
}

function TakeBackForm({ t, onDone, onCancel }: FormProps) {
  const [reason, setReason] = useState('');
  const takeBack = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/tickets/${t.id}/take-back`, { method: 'POST', body: { reason: reason.trim() } }),
    onSuccess: onDone
  });
  return (
    <div className="responsible-form">
      <input
        aria-label={tr('Why the job is taken back')}
        value={reason}
        maxLength={500}
        placeholder={tr('Why, e.g. sick, phone off, cannot be reached')}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="notice" style={{ margin: 0 }}>
        {tr('{0} no longer has the job and is told. It goes to the next person of the team on duty.', {
          0: t.assignee!.fullName
        })}
      </div>
      {takeBack.error && <div className="error">{(takeBack.error as ApiRequestError).message}</div>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-danger"
          disabled={reason.trim().length < 3 || takeBack.isPending}
          onClick={() => takeBack.mutate()}
        >
          {tr('Take the job back')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {tr('Keep it with {0}', { 0: firstName(t.assignee!.fullName) })}
        </button>
      </div>
    </div>
  );
}

function PersonForm({ t, onDone, onCancel }: FormProps) {
  const [picked, setPicked] = useState('');
  const staff = useQuery({
    queryKey: ['suggestions', t.teamId, t.id],
    queryFn: () => api<StaffSuggestion[]>(`/teams/${t.teamId}/suggestions?ticketId=${t.id}`)
  });
  const assign = useMutation({
    mutationFn: () =>
      api<TicketDetail>(`/tickets/${t.id}/assign`, { method: 'POST', body: { assigneeId: picked } }),
    onSuccess: onDone
  });
  const others = (staff.data ?? []).filter((s) => s.id !== t.assignee?.id);
  const chosen = others.find((s) => s.id === picked);
  if (staff.isSuccess && others.length === 0) {
    return (
      <div className="responsible-form">
        <span className="meta" style={{ fontSize: 14 }}>
          {tr('Nobody else in team {0}.', { 0: t.teamName ?? '' })}
        </span>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onCancel}>
            {tr('Close')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="responsible-form">
      <select aria-label={tr('Person')} value={picked} onChange={(e) => setPicked(e.target.value)}>
        <option value="">{tr('Choose a person…')}</option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.fullName} ·{' '}
            {s.onDuty
              ? tr(s.openJobs === 1 ? 'on duty, {0} unfinished job' : 'on duty, {0} unfinished jobs', {
                  0: s.openJobs
                })
              : tr('off duty')}
          </option>
        ))}
      </select>
      {chosen && !chosen.onDuty && (
        <div className="notice" style={{ margin: 0 }}>
          {tr('{0} is off duty and sees the job when back on the app; an SMS is sent now.', {
            0: firstName(chosen.fullName)
          })}
        </div>
      )}
      {t.assignee && (
        <div className="meta" style={{ fontSize: 14 }}>
          {tr('{0} no longer has the job and is told.', { 0: t.assignee.fullName })}
        </div>
      )}
      {assign.error && <div className="error">{(assign.error as ApiRequestError).message}</div>}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!chosen || assign.isPending}
          onClick={() => assign.mutate()}
        >
          {chosen ? tr('Give it to {0}', { 0: firstName(chosen.fullName) }) : tr('Give the job')}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          {tr('Close')}
        </button>
      </div>
    </div>
  );
}
