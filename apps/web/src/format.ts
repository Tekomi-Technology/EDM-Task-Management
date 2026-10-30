import { dateLocale, t, translated } from './i18n';
import type { TicketSource, TicketStatus, TicketSummary, TicketType } from './types';

export const STATUS_LABEL: Record<TicketStatus, string> = translated({
  new: 'Open',
  assigned: 'Assigned',
  accepted: 'Accepted',
  in_progress: 'Being fixed',
  on_hold: 'Paused',
  resolved: 'Waiting for check',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled'
});

export const TYPE_LABEL: Record<TicketType, string> = translated({
  customer_complaint: 'Customer',
  network_incident: 'Network incident',
  planned_work: 'Planned work',
  new_customer_survey: 'New customer survey',
  new_connection: 'New connection',
  other: 'Other'
});

export const SOURCE_LABEL: Record<TicketSource, string> = translated({
  call_center: 'Call Center',
  sales: 'Sales',
  nms: 'NMS',
  network_team: 'Network team',
  office: 'EDM office'
});

export const ROLE_LABEL: Record<string, string> = translated({
  admin: 'Administrator',
  technical_manager: 'Technical manager',
  team_manager: 'Team manager',
  noc: 'NOC operator',
  network_team: 'Network team',
  bo_support: 'BO support',
  field_staff: 'Field staff'
});

/** Shown on the Users & roles screen so admins know what they are giving. */
export const ROLE_HELP: Record<string, string> = translated({
  field_staff: 'Sees and updates own jobs in the EDM Field app: accept, pause, finish with notes and photos.',
  team_manager: 'Sees the tickets of their team, assigns them to field staff and cancels duplicates.',
  noc: 'Sees every ticket, checks network jobs and closes or reopens them, cancels tickets.',
  network_team: 'Sees every ticket and adds notes; network work orders come in phase 3.',
  bo_support: 'Sees every ticket to help field staff and adds notes.',
  technical_manager:
    'Sees every ticket, team and field staff member, assigns in any team, and is told when tickets are badly late.',
  admin: 'Everything above, plus accounts, roles and teams.'
});

export const EVENT_LABEL: Record<string, string> = translated({
  created: 'created the ticket',
  assign: 'assigned the ticket',
  claim: 'claimed the job in the app',
  offered: 'offered the job to the team',
  accept: 'accepted the job',
  decline: 'declined the job',
  start: 'arrived and started work',
  hold: 'paused work',
  resume: 'resumed work',
  resolve: 'reported the job done',
  close: 'closed the ticket',
  reopen: 'reopened the ticket',
  cancel: 'cancelled the ticket',
  note: 'added a note',
  linked: 'linked it to a network incident',
  unlinked: 'unlinked it from the network incident',
  closed_with_incident: 'closed it together with the network incident',
  alarm_raised: 'reported another alarm',
  alarm_cleared: 'reported an alarm cleared',
  all_alarms_cleared: 'reported every alarm cleared',
  acknowledge: 'acknowledged the incident (NOC)',
  customers_notified: 'sent an SMS to the affected customers',
  team_changed: 'moved it to another team',
  take_back: 'took the job back',
  escalate: 'raised the alarm on the time limit',
  reserved: 'set material aside in the depot',
  stock_short: 'found the van short of material',
  help_requested: 'asked the back office for help',
  handover_code_sent: 'sent the customer a handover code'
});

export const PREMISES_LABEL: Record<string, string> = translated({
  home: 'Home',
  shop: 'Shop',
  school: 'School',
  business: 'Business',
  farm: 'Farm',
  other: 'Other'
});

export const SUPPLY_LABEL: Record<string, string> = translated({
  single_phase: 'single-phase',
  three_phase: '3-phase'
});

export const SURVEY_RESULT_LABEL: Record<string, string> = translated({
  feasible: 'Feasible',
  feasible_with_works: 'Feasible with works',
  not_feasible: 'Not feasible'
});

export const HELP_KIND_LABEL: Record<string, string> = translated({
  second_person: 'Second person',
  truck: 'Truck',
  material: 'Material',
  switch_off: 'Switch a line off',
  advice: 'Advice',
  other: 'Other'
});

export const MOVEMENT_LABEL: Record<string, string> = translated({
  receive: 'Received',
  transfer: 'Moved',
  consume: 'Used on a job',
  adjust: 'Count corrected'
});

/** "1,240 m", "86", "2 sets". */
export function qty(n: number, unit: string): string {
  const v = Number.isInteger(n)
    ? n.toLocaleString(dateLocale())
    : n.toLocaleString(dateLocale(), { maximumFractionDigits: 2 });
  return unit === 'pcs' ? v : `${v} ${unit}`;
}

export const SEVERITY_LABEL: Record<string, string> = translated({
  critical: 'High',
  major: 'Medium',
  minor: 'Low',
  warning: 'Warning'
});

export const STAFF_STATE_LABEL: Record<string, string> = translated({
  on_job: 'On a job',
  free: 'Free',
  offline: 'Offline',
  off_duty: 'Off duty'
});

/** "1.2 km", "350 m". */
export function distance(m: number | null): string | null {
  if (m === null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

/** Rough driving time in town (about 25 km/h). */
export function driveMinutes(m: number | null): number | null {
  return m === null ? null : Math.max(1, Math.round((m / 1000 / 25) * 60));
}

/** "2 min ago", "45 min ago", "3 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return t('just now');
  if (min < 60) return t('{n} min ago', { n: min });
  if (min < 2880) return t('{n} h ago', { n: Math.floor(min / 60) });
  return t('{n} days ago', { n: Math.floor(min / 1440) });
}

const UNFINISHED: TicketStatus[] = ['new', 'assigned', 'accepted', 'in_progress', 'on_hold', 'reopened'];

/** "1 h 20 min", "22 min late", or null when there is no time limit or the work is done. */
export function timeLeft(
  dueAt: string | null,
  status: TicketStatus,
  now = Date.now()
): { text: string; late: boolean; soon: boolean } | null {
  if (!dueAt || !UNFINISHED.includes(status)) return null;
  const minutes = Math.round((new Date(dueAt).getTime() - now) / 60_000);
  const abs = Math.abs(minutes);
  const days = Math.floor(abs / 1440);
  const text =
    days >= 2
      ? t('{n} days', { n: days })
      : abs >= 60
        ? abs % 60
          ? t('{h} h {m} min', { h: Math.floor(abs / 60), m: abs % 60 })
          : t('{h} h', { h: Math.floor(abs / 60) })
        : t('{m} min', { m: abs });
  return minutes < 0
    ? { text: t('{time} late', { time: text }), late: true, soon: false }
    : { text, late: false, soon: minutes <= 30 };
}

/** What to show in the "Time left" column for any ticket. */
export function timeCell(ticket: Pick<TicketSummary, 'dueAt' | 'status' | 'source'>): {
  text: string;
  className?: string;
} {
  if (ticket.status === 'resolved') return { text: ticket.source === 'call_center' ? 'Call Center' : 'NOC' };
  if (ticket.status === 'closed') return { text: t('Done') };
  if (ticket.status === 'cancelled') return { text: '—' };
  const left = timeLeft(ticket.dueAt, ticket.status);
  if (!left) return { text: '—' };
  return { text: left.text, className: left.late ? 'late' : left.soon ? 'soon' : undefined };
}

/** "for 12 min", "for 3 h", "for 2 days": how long something has been waiting. */
export function waitingFor(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return t('{m} min', { m: minutes });
  if (minutes < 2880) return t('{h} h', { h: Math.floor(minutes / 60) });
  return t('{n} days', { n: Math.floor(minutes / 1440) });
}

const TZ = 'Africa/Maputo';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

/** "09:24" today, "26 Oct, 09:24" on other days. */
/**
 * History line of a team change: chosen at creation instead of the place's team, or moved later. The reason is shown
 * on its own line under it, like the reason of any step.
 */
export function teamChangeText(d: Record<string, unknown>): string {
  const to = String(d.teamName ?? '');
  if (d.atCreation) {
    return t('chose team {0} instead of {1} (team of the place)', { 0: to, 1: String(d.fromName ?? '') });
  }
  const moved =
    typeof d.fromName === 'string' && d.fromName
      ? t('moved it from team {0} to team {1}', { 0: d.fromName, 1: to })
      : t('moved it to team {0}', { 0: to });
  const taken =
    typeof d.unassignedName === 'string' && d.unassignedName
      ? ' ' + t('(taken back from {0})', { 0: d.unassignedName })
      : '';
  return moved + taken;
}

export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString(dateLocale(), { timeZone: TZ });
  if (day(d) === day(now)) return formatTime(iso);
  return d.toLocaleString(dateLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ
  });
}

export function greeting(now = new Date()): string {
  const hour = Number(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }));
  return hour < 12 ? t('Good morning') : hour < 18 ? t('Good afternoon') : t('Good evening');
}

export function longDate(now = new Date()): string {
  return now.toLocaleString(dateLocale(), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ
  });
}

export function initials(name: string): string {
  return (
    name
      .split(' ')
      // Only words that start with a letter: "System (auto-assign)" is "SA", not "S(".
      .map((w) => w.replace(/^[^\p{L}]+/u, ''))
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  );
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

/**
 * A ticket's title in the current language. The server writes titles in English from the problem type
 * ("No power, one home", "Survey for new shop", "New connection, contract 88213"); other titles (typed by
 * people, alarm names from the NMS) stay as they are.
 */
export function ticketTitle(title: string): string {
  const survey = /^Survey for new (\w+)$/.exec(title);
  if (survey)
    return t('Survey for new {premises}', {
      premises: (PREMISES_LABEL[survey[1]!] ?? survey[1]!).toLowerCase()
    });
  const contract = /^Contract (.+)$/.exec(title);
  if (contract) return t('Contract {0}', { 0: contract[1] });
  const connection = /^New connection, contract (.+)$/.exec(title);
  if (connection) return t('New connection, contract {n}', { n: connection[1] });
  return t(title);
}
