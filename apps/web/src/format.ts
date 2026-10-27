import type { TicketSource, TicketStatus, TicketSummary, TicketType } from '@edm/shared';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  new: 'Open',
  assigned: 'Assigned',
  accepted: 'Accepted',
  in_progress: 'Being fixed',
  on_hold: 'Paused',
  resolved: 'Waiting for check',
  closed: 'Closed',
  reopened: 'Reopened',
  cancelled: 'Cancelled'
};

export const TYPE_LABEL: Record<TicketType, string> = {
  customer_complaint: 'Customer',
  network_incident: 'Network incident',
  planned_work: 'Planned work',
  new_customer_survey: 'New customer survey',
  new_connection: 'New connection'
};

export const SOURCE_LABEL: Record<TicketSource, string> = {
  call_center: 'Call Center',
  sales: 'Sales',
  nms: 'NMS',
  network_team: 'Network team',
  office: 'EDM office'
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  technical_manager: 'Technical manager',
  team_manager: 'Team manager',
  noc: 'NOC operator',
  network_team: 'Network team',
  bo_support: 'BO support',
  field_staff: 'Field staff'
};

/** Shown on the Users & roles screen so admins know what they are giving. */
export const ROLE_HELP: Record<string, string> = {
  field_staff: 'Sees and updates own jobs in the EDM Field app: accept, pause, finish with notes and photos.',
  team_manager: 'Sees the tickets of their team, assigns them to field staff and cancels duplicates.',
  noc: 'Sees every ticket, checks network jobs and closes or reopens them, cancels tickets.',
  network_team: 'Sees every ticket and adds notes; network work orders come in phase 3.',
  bo_support: 'Sees every ticket to help field staff and adds notes.',
  technical_manager:
    'Sees every ticket, team and field staff member, assigns in any team, and is told when tickets are badly late.',
  admin: 'Everything above, plus accounts, roles and teams.'
};

export const EVENT_LABEL: Record<string, string> = {
  created: 'created the ticket',
  assign: 'assigned the ticket',
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
  escalate: 'raised the alarm on the time limit',
  reserved: 'set material aside in the depot',
  stock_short: 'found the van short of material',
  help_requested: 'asked the back office for help',
  handover_code_sent: 'sent the customer a handover code'
};

export const PREMISES_LABEL: Record<string, string> = {
  home: 'Home',
  shop: 'Shop',
  school: 'School',
  business: 'Business',
  farm: 'Farm',
  other: 'Other'
};

export const SUPPLY_LABEL: Record<string, string> = {
  single_phase: 'single-phase',
  three_phase: '3-phase'
};

export const SURVEY_RESULT_LABEL: Record<string, string> = {
  feasible: 'Feasible',
  feasible_with_works: 'Feasible with works',
  not_feasible: 'Not feasible'
};

export const HELP_KIND_LABEL: Record<string, string> = {
  second_person: 'Second person',
  truck: 'Truck',
  material: 'Material',
  switch_off: 'Switch a line off',
  advice: 'Advice',
  other: 'Other'
};

export const MOVEMENT_LABEL: Record<string, string> = {
  receive: 'Received',
  transfer: 'Moved',
  consume: 'Used on a job',
  adjust: 'Count corrected'
};

/** "1,240 m", "86", "2 sets". */
export function qty(n: number, unit: string): string {
  const v = Number.isInteger(n)
    ? n.toLocaleString('en')
    : n.toLocaleString('en', { maximumFractionDigits: 2 });
  return unit === 'pcs' ? v : `${v} ${unit}`;
}

export const SEVERITY_LABEL: Record<string, string> = {
  critical: 'High',
  major: 'Medium',
  minor: 'Low',
  warning: 'Warning'
};

export const STAFF_STATE_LABEL: Record<string, string> = {
  on_job: 'On a job',
  free: 'Free',
  offline: 'Offline',
  off_duty: 'Off duty'
};

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
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 2880) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} days ago`;
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
      ? `${days} days`
      : abs >= 60
        ? `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ''}`
        : `${abs} min`;
  return minutes < 0
    ? { text: `${text} late`, late: true, soon: false }
    : { text, late: false, soon: minutes <= 30 };
}

/** What to show in the "Time left" column for any ticket. */
export function timeCell(t: Pick<TicketSummary, 'dueAt' | 'status' | 'source'>): {
  text: string;
  className?: string;
} {
  if (t.status === 'resolved') return { text: t.source === 'call_center' ? 'Call Center' : 'NOC' };
  if (t.status === 'closed') return { text: 'Done' };
  if (t.status === 'cancelled') return { text: '—' };
  const left = timeLeft(t.dueAt, t.status);
  if (!left) return { text: '—' };
  return { text: left.text, className: left.late ? 'late' : left.soon ? 'soon' : undefined };
}

/** "for 12 min", "for 3 h", "for 2 days": how long something has been waiting. */
export function waitingFor(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 2880) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} days`;
}

const TZ = 'Africa/Maputo';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

/** "09:24" today, "26 Oct, 09:24" on other days. */
export function formatWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => x.toLocaleDateString('en-GB', { timeZone: TZ });
  if (day(d) === day(now)) return formatTime(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ
  });
}

export function greeting(now = new Date()): string {
  const hour = Number(now.toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function longDate(now = new Date()): string {
  return now.toLocaleString('en-GB', {
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
