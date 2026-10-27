import type { Role } from '../contract';

/** The signed-in person or system, attached to the request by AuthGuard. */
export interface AuthUser {
  sub: string;
  username: string;
  fullName: string;
  roles: Role[];
  /** Row id in `users`; null for other systems (Call Center, Sales), which have no user row. */
  userId: string | null;
  teamId: string | null;
  /** Field staff only: whether they have switched on duty in the app. */
  onDuty: boolean;
  isIntegration: boolean;
}

/** Actor recorded in ticket history when the system assigns a job by itself. */
export const SYSTEM_ACTOR: AuthUser = {
  sub: 'system',
  username: 'system',
  fullName: 'System (auto-assign)',
  roles: ['admin'],
  userId: null,
  teamId: null,
  onDuty: false,
  isIntegration: false
};

/** Label written into ticket history for an actor. */
export function actorLabel(user: AuthUser): string {
  if (user.roles.includes('integration_call_center')) return 'Call Center system';
  if (user.roles.includes('integration_sales')) return 'Sales system';
  if (user.roles.includes('integration_nms')) return 'NMS';
  if (user.roles.includes('integration_stock')) return 'EDM stock system';
  return user.fullName;
}

/** Actor recorded in ticket history for time-limit reminders and escalations. */
export const TIME_LIMITS_ACTOR: AuthUser = {
  ...SYSTEM_ACTOR,
  sub: 'system-time-limits',
  fullName: 'System (time limits)'
};
