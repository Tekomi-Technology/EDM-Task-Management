import type { Lookups, StaffSuggestion, TicketDetail } from '../types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, BellRing, Undo2, UserRoundCog, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { api, ApiRequestError } from '../api';
import { firstName, formatTime } from '../format';
import { t as tr } from '../i18n';
import { Avatar, CHOOSE_TEAM_ROLES, hasRole, useMe } from './ui';

const FINISHED = ['resolved', 'closed', 'cancelled'];
const HOLDING = ['assigned', 'accepted', 'in_progress', 'on_hold'];

type Mode = 'team' | 'takeBack' | 'person' | null;

/**
 * "Who is on it": the team and the person holding the ticket, in one place. A waiting ticket is offered to the whole
 * team in the app, and whoever claims it first goes; from here NOC, technical managers and administrators move a
 * ticket to another team, and managers tell the team again, take a job back or name the person who goes.
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
  const offer = !t.assignee && unfinished ? t.offer : null;
  const tellAgain = useMutation({
    mutationFn: () => api<TicketDetail>(`/tickets/${t.id}/offer`, { method: 'POST' }),
    onSuccess: onChange
  });

  const state = !t.assignee
    ? unfinished
      ? offer
        ? { text: 'Waiting for someone to claim it', tone: 'warn' }
        : { text: 'Nobody yet', tone: 'late' }
      : null
    : PERSON_STATE[t.status];
  return (
    <section className="card card-pad responsible" aria-label={tr('Who is on it')}>
      <div className="responsible-head">
        <span className="label" style={{ fontSize: 15 }}>
          {tr('Who is on it')}
        </span>
        {state && <span className={`chip chip-${state.tone}`}>{tr(state.text)}</span>}
      </div>

      {offer ? (
        <>
          <div className="responsible-person">
            <span className="avatar lg nobody" aria-hidden="true">
              <UsersRound size={20} />
            </span>
            <div className="responsible-text">
              <strong>
                {tr('Told {0} people of team {1}', { 0: offer.notified.length, 1: offer.teamName })}
              </strong>
              <span className="meta" title={offer.notified.join(', ')}>
                {offer.round > 1
                  ? tr('Told again (time {0}) at {1} · nobody has claimed it yet', {
                      0: offer.round,
                      1: formatTime(offer.at)
                    })
                  : tr('Told at {0} · nobody has claimed it yet', { 0: formatTime(offer.at) })}
              </span>
            </div>
          </div>
          <div className="responsible-note">
            {t.type === 'planned_work'
              ? tr(
                  'Whoever presses "Claim the job" in the app first goes. Until then the team is told again every 15 minutes, from the day before the work.'
                )
              : tr(
                  'Whoever presses "Claim the job" in the app first goes. Until then the team is told again every 15 minutes.'
                )}
          </div>
        </>
      ) : (
        <div className="responsible-person">
          {t.assignee ? (
            <Avatar name={t.assignee.fullName} size="lg" />
          ) : (
            <Avatar name="?" size="lg" kind="nobody" />
          )}
          <div className="responsible-text">
            <strong>{t.assignee ? t.assignee.fullName : unfinished ? tr('Nobody on it yet') : '—'}</strong>
            <span className="meta">
              {!t.teamId
                ? tr('No team yet')
                : t.assignee || !unfinished
                  ? tr('Team {0}', { 0: t.teamName ?? '' })
                  : t.incident
                    ? tr('Nobody is sent: it closes with network incident {0}.', { 0: t.incident.code })
                    : tr('Nobody is left in team {0} to tell.', { 0: t.teamName ?? '' })}
            </span>
          </div>
        </div>
      )}

      {mode === null && canAssign && holding && (
        <div className="responsible-actions">
          <button type="button" className="btn" onClick={() => setMode('person')}>
            <UserRoundCog size={16} /> {tr('Change person')}
          </button>
          <button type="button" className="btn" onClick={() => setMode('takeBack')}>
            <Undo2 size={16} /> {tr('Take the job back')}
          </button>
        </div>
      )}
      {mode === null && canAssign && offer && (
        <div className="responsible-actions">
          <button type="button" className="btn" onClick={() => setMode('person')}>
            <UserRoundCog size={16} /> {tr('Choose a person')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={tellAgain.isPending}
            onClick={() => tellAgain.mutate()}
          >
            <BellRing size={16} /> {tr('Tell the team again')}
          </button>
        </div>
      )}
      {tellAgain.error && <div className="error">{(tellAgain.error as ApiRequestError).message}</div>}
      {mode === null && canAssign && unfinished && !t.assignee && !offer && t.teamId && !t.incident && (
        <button type="button" className="btn btn-primary" onClick={() => setMode('person')}>
          <UserRoundCog size={16} /> {tr('Choose a person')}
        </button>
      )}
      {mode === 'takeBack' && <TakeBackForm t={t} onDone={close} onCancel={() => setMode(null)} />}
      {mode === 'person' && <PersonForm t={t} onDone={close} onCancel={() => setMode(null)} />}

      {canRoute && (
        <div className="responsible-foot">
          {mode === 'team' ? (
            <TeamForm t={t} onDone={close} onCancel={() => setMode(null)} />
          ) : (
            <span className="meta" style={{ fontSize: 14 }}>
              {t.teamId ? tr('Wrong team?') : tr('No team yet.')}{' '}
              <button type="button" className="link-button" onClick={() => setMode('team')}>
                <ArrowLeftRight size={14} /> {t.teamId ? tr('Move to another team') : tr('Choose a team')}
              </button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** What the person holding the ticket is doing, in words, with the colour of the chip. */
const PERSON_STATE: Partial<Record<TicketDetail['status'], { text: string; tone: string }>> = {
  assigned: { text: 'Has not accepted the job yet', tone: 'blue' },
  accepted: { text: 'Accepted, on the way', tone: 'blue' },
  in_progress: { text: 'Working on site', tone: 'ok' },
  on_hold: { text: 'Paused', tone: 'warn' },
  resolved: { text: 'Reported the job done', tone: 'purple' },
  closed: { text: 'Did the job', tone: 'ok' }
};

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
      <strong>{t.teamId ? tr('Move to another team') : tr('Choose a team')}</strong>
      {!t.teamId && (
        <span className="meta" style={{ fontSize: 14 }}>
          {tr('The place is outside every team area. Choose the team that should go.')}
        </span>
      )}
      <div className="field">
        <label htmlFor="move-team">{t.teamId ? tr('New team') : tr('Team')}</label>
        <select id="move-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">{tr('Choose a team…')}</option>
          {lookups.data?.teams
            .filter((x) => x.id !== t.teamId)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.areaName}
              </option>
            ))}
        </select>
      </div>
      {needsReason && (
        <div className="field">
          <label htmlFor="move-reason">{tr('Why it moves')}</label>
          <input
            id="move-reason"
            value={reason}
            maxLength={300}
            placeholder={tr('e.g. place marked wrongly')}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}
      {t.assignee && (
        <div className="meta" style={{ fontSize: 14 }}>
          {tr('{0} no longer has the job and is told; the new team is told like for a new ticket.', {
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
      <strong>{tr('Take the job back from {0}', { 0: t.assignee!.fullName })}</strong>
      <div className="field">
        <label htmlFor="take-back-reason">{tr('Why the job is taken back')}</label>
        <input
          id="take-back-reason"
          value={reason}
          maxLength={500}
          placeholder={tr('e.g. sick, phone off')}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <div className="meta" style={{ fontSize: 14 }}>
        {tr('{0} no longer has the job and is told. The rest of the team is told in the app.', {
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
      <strong>{t.assignee ? tr('Change person') : tr('Choose a person')}</strong>
      <div className="field">
        <label htmlFor="pick-person">{tr('Who goes')}</label>
        <select id="pick-person" value={picked} onChange={(e) => setPicked(e.target.value)}>
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
      </div>
      {chosen && !chosen.onDuty && (
        <div className="meta" style={{ fontSize: 14 }}>
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
