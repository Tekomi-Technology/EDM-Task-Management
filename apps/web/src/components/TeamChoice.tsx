import type { Lookups } from '../types';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '../api';
import { t } from '../i18n';
import { CHOOSE_TEAM_ROLES, hasRole, useMe } from './ui';

/** Another team chosen instead of the team of the place; teamId is '' until one is picked. */
export interface TeamPick {
  teamId: string;
  reason: string;
}

/**
 * "Team: South 1 (team of the place) · Choose another team". The team of the place goes by default; NOC, technical
 * managers and administrators may send it to another team, saying why (the reason goes into the ticket's history).
 */
export function TeamChoice({
  autoTeamName,
  value,
  onChange
}: {
  /** The team of the place, or null when the place is not known yet or is outside every area. */
  autoTeamName: string | null;
  value: TeamPick | null;
  onChange: (value: TeamPick | null) => void;
}) {
  const me = useMe();
  const mayChoose = hasRole(me.data, ...CHOOSE_TEAM_ROLES);
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api<Lookups>('/lookups'),
    enabled: mayChoose && !!value
  });

  if (!value) {
    return (
      <div className="team-choice">
        <Users size={18} aria-hidden />
        <span style={{ flex: 1 }}>
          {t('Team')}: <strong>{autoTeamName ?? t('from the place marked')}</strong>{' '}
          <span className="meta">{t('(team of the place)')}</span>
        </span>
        {mayChoose && (
          <button type="button" className="btn btn-sm" onClick={() => onChange({ teamId: '', reason: '' })}>
            {t('Choose another team')}
          </button>
        )}
      </div>
    );
  }

  const others = (lookups.data?.teams ?? []).filter((x) => x.name !== autoTeamName);
  return (
    <div className="team-choice open" role="group" aria-label={t('Another team')}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="team-choice-team">{t('Team that goes')}</label>
          <select
            id="team-choice-team"
            value={value.teamId}
            onChange={(e) => onChange({ ...value, teamId: e.target.value })}
          >
            <option value="">{t('Choose…')}</option>
            {others.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {x.areaName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="team-choice-reason">{t('Why another team goes')}</label>
          <input
            id="team-choice-reason"
            value={value.reason}
            maxLength={300}
            placeholder={t('For example: closer, the team of the area is on a big outage')}
            onChange={(e) => onChange({ ...value, reason: e.target.value })}
          />
        </div>
      </div>
      <div className="meta">
        {autoTeamName
          ? t('Instead of {0}, the team of the place. The reason is kept in the ticket history.', {
              0: autoTeamName
            })
          : t('The reason is kept in the ticket history.')}
      </div>
      <div>
        <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>
          {t('Use the team of the place')}
        </button>
      </div>
    </div>
  );
}

/** The team choice as the API takes it, or an error to show when it is not complete. */
export function teamChoiceBody(pick: TeamPick | null): { teamId?: string; teamReason?: string } {
  if (!pick) return {};
  if (!pick.teamId) throw new Error(t('Choose the team that goes, or use the team of the place.'));
  if (pick.reason.trim().length < 3) throw new Error(t('Write why another team goes.'));
  return { teamId: pick.teamId, teamReason: pick.reason.trim() };
}
