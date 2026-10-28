import type { CurrentUser, TicketSummary, TicketType } from '../types';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api } from '../api';
import { initials } from '../format';
import { t } from '../i18n';

export function Avatar({
  name,
  size,
  kind
}: {
  name: string;
  size?: 'sm' | 'lg';
  kind?: 'system' | 'nobody';
}) {
  return (
    <span className={['avatar', size, kind].filter(Boolean).join(' ')} aria-hidden="true">
      {kind === 'nobody' ? '?' : initials(name)}
    </span>
  );
}

/** "Armando Cossa" with initials, or a dashed "Nobody yet". */
export function AssigneeCell({ ticket }: { ticket: Pick<TicketSummary, 'assignee'> }) {
  if (!ticket.assignee) {
    return (
      <span className="person meta" style={{ fontSize: 14 }}>
        <Avatar name="?" size="sm" kind="nobody" />
        {t('Nobody yet')}
      </span>
    );
  }
  return (
    <span className="person">
      <Avatar name={ticket.assignee.fullName} size="sm" />
      {ticket.assignee.fullName}
    </span>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export const CrumbContext = createContext<(crumbs: Crumb[]) => void>(() => undefined);

/** Sets the trail shown in the top bar, e.g. All tickets › TK-26-00012. */
export function useCrumbs(crumbs: Crumb[]): void {
  const set = useContext(CrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
  }, [key, set]);
}

/** The signed-in person; cached for the whole session. */
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<CurrentUser>('/me'), staleTime: 60_000 });
}

/** EDM staff who may answer a call and enter a ticket themselves (New ticket screen). */
export const TAKES_CALLS_ROLES = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support'];

/** Who may create each ticket type on the New ticket screen (the API checks it too). */
export const CREATE_ROLES: Record<TicketType, string[]> = {
  customer_complaint: TAKES_CALLS_ROLES,
  network_incident: TAKES_CALLS_ROLES,
  planned_work: ['network_team', 'noc', 'technical_manager', 'admin'],
  new_customer_survey: ['technical_manager', 'admin'],
  new_connection: ['technical_manager', 'admin'],
  other: TAKES_CALLS_ROLES
};

/** The ticket types this person may create, in the order of the New ticket screen. */
export function creatableTypes(me: CurrentUser | undefined): TicketType[] {
  return (Object.keys(CREATE_ROLES) as TicketType[]).filter((type) => hasRole(me, ...CREATE_ROLES[type]));
}

export const OFFICE_ROLES = [
  'admin',
  'technical_manager',
  'team_manager',
  'noc',
  'bo_support',
  'network_team'
];

export function hasRole(me: CurrentUser | undefined, ...roles: string[]): boolean {
  return !!me && me.roles.some((r) => roles.includes(r));
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={['card', className].filter(Boolean).join(' ')}>{children}</section>;
}
