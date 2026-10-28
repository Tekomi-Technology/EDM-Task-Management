import type { AdminUser, CreateUser, Lookups, UserRole } from '../types';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ROLE_HELP, ROLE_LABEL } from '../format';
import { t } from '../i18n';

const ROLES: UserRole[] = [
  'field_staff',
  'team_manager',
  'noc',
  'network_team',
  'bo_support',
  'technical_manager',
  'admin'
];
const TEAM_ROLES: UserRole[] = ['field_staff', 'team_manager'];

interface Props {
  lookups: Lookups;
  /** Editing an existing account; creating a new one when absent. */
  user?: AdminUser;
  busy: boolean;
  onSubmit: (values: CreateUser) => void;
  /** Reset password, block and remove buttons, shown when editing. */
  actions?: ReactNode;
}

/** Create or edit an account: name, sign-in name, role, area and team, phone for SMS. */
export function UserEditor({ lookups, user, busy, onSubmit, actions }: Props) {
  const startTeam = lookups.teams.find((t) => t.id === user?.teamId);
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [role, setRole] = useState<UserRole>((user?.roles[0] as UserRole | undefined) ?? 'field_staff');
  const [areaId, setAreaId] = useState(startTeam?.areaId ?? '');
  const [teamId, setTeamId] = useState(user?.teamId ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');

  const needsTeam = TEAM_ROLES.includes(role);
  const teams = lookups.teams.filter((t) => !areaId || t.areaId === areaId);
  const problem = needsTeam && !teamId ? t('Field staff and team managers need a team.') : null;
  const otherRoles = (user?.roles ?? []).filter((r) => r !== role);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (problem) return;
    onSubmit({
      username: username.trim(),
      fullName: fullName.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      roles: [role],
      teamId: teamId || null
    });
  }

  return (
    <form
      className="card card-pad editor"
      style={{ gap: 16, padding: 24 }}
      onSubmit={submit}
      aria-label={user ? t('Edit account') : t('New account')}
    >
      <h2 style={{ fontSize: 20 }}>{user ? user.fullName : t('New account')}</h2>
      <div className="field">
        <label htmlFor="u-name">{t('Full name')}</label>
        <input id="u-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="u-username">{t('Username')}</label>
        <input
          id="u-username"
          required
          disabled={!!user}
          value={username}
          placeholder={t('e.g. rui.langa')}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="u-role">{t('Role')}</label>
        <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {otherRoles.length > 0 && (
          <span className="meta">
            {t('Also has:')} {otherRoles.map((r) => ROLE_LABEL[r] ?? r).join(', ')}
            {t('. Saving keeps only the role above.')}
          </span>
        )}
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="u-area">{t('Working area')}</label>
          <select
            id="u-area"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setTeamId('');
            }}
          >
            <option value="">{t('All areas')}</option>
            {lookups.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="u-team">
            {t('Team')}
            {needsTeam ? '' : t(' (optional)')}
          </label>
          <select id="u-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">{t('No team')}</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="u-phone">{t('Phone for SMS')}</label>
        <input
          id="u-phone"
          value={phone}
          placeholder="+258 84 000 0000"
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="u-email">{t('Email (optional)')}</label>
        <input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="role-help">
        <strong>{t('What this role can do')}</strong>
        <div style={{ color: 'var(--text-2)', marginTop: 4 }}>{ROLE_HELP[role]}</div>
      </div>
      {problem && <div className="meta">{problem}</div>}
      {actions && <div className="btn-row">{actions}</div>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !!problem}>
        {busy ? t('Saving…') : user ? t('Save changes') : t('Create account')}
      </button>
    </form>
  );
}
