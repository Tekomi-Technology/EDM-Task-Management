import type { Role } from './roles.js';

export const TICKET_STATUSES = [
  'new',
  'assigned',
  'accepted',
  'in_progress',
  'on_hold',
  'resolved',
  'closed',
  'reopened',
  'cancelled'
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** Statuses after which nothing more happens to the ticket. */
export const FINAL_STATUSES: readonly TicketStatus[] = ['closed', 'cancelled'];
/** Statuses in which a field staff member is still holding the job; used to measure workload. */
export const OPEN_JOB_STATUSES: readonly TicketStatus[] = ['assigned', 'accepted', 'in_progress', 'on_hold'];

export const TICKET_TYPES = [
  'customer_complaint',
  'network_incident',
  'planned_work',
  'new_customer_survey',
  'new_connection',
  /** Anything else that comes up; the office says what it is, picks the priority and checks it before closing. */
  'other'
] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** "office": typed in on the New ticket screen by EDM staff who took the call themselves. */
export const TICKET_SOURCES = ['call_center', 'sales', 'nms', 'network_team', 'office'] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

/** Problem types the Call Center can report, with the priority and time limit each one gets. */
export const PROBLEM_TYPES = {
  no_power_single: { label: 'No power, one home', priority: 2, slaMinutes: 240 },
  no_power_street: { label: 'No power, whole street', priority: 1, slaMinutes: 120 },
  low_voltage: { label: 'Low or unstable voltage', priority: 3, slaMinutes: 1440 },
  prepaid_meter: { label: 'Prepaid meter problem', priority: 3, slaMinutes: 1440 },
  cable_down: { label: 'Cable down or danger', priority: 1, slaMinutes: 60 },
  other: { label: 'Something else', priority: 3, slaMinutes: 1440 }
} as const;
export type ProblemType = keyof typeof PROBLEM_TYPES;
export const PROBLEM_TYPE_KEYS = Object.keys(PROBLEM_TYPES) as [ProblemType, ...ProblemType[]];

/** Problems the public reports to the Call Center on 800 145 145 (network, not their own supply). */
export const NETWORK_REPORT_TYPES = {
  cable_down: { label: 'Cable down or hanging low', priority: 1, slaMinutes: 60 },
  transformer_fault: { label: 'Transformer smoke, noise or fire', priority: 1, slaMinutes: 60 },
  sparks: { label: 'Sparks or burning smell', priority: 1, slaMinutes: 60 },
  pole_damaged: { label: 'Damaged or leaning pole', priority: 2, slaMinutes: 240 },
  theft_vandalism: { label: 'Theft or damage of equipment', priority: 2, slaMinutes: 480 },
  other: { label: 'Other network problem', priority: 3, slaMinutes: 1440 }
} as const;
export type NetworkReportType = keyof typeof NETWORK_REPORT_TYPES;
export const NETWORK_REPORT_TYPE_KEYS = Object.keys(NETWORK_REPORT_TYPES) as [
  NetworkReportType,
  ...NetworkReportType[]
];

/** NMS alarm severities. Warnings are recorded but do not open an incident. */
export const ALARM_SEVERITIES = ['critical', 'major', 'minor', 'warning'] as const;
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];
export const SEVERITY_RULES: Record<
  Exclude<AlarmSeverity, 'warning'>,
  { priority: number; slaMinutes: number }
> = {
  critical: { priority: 1, slaMinutes: 120 },
  major: { priority: 2, slaMinutes: 240 },
  minor: { priority: 3, slaMinutes: 1440 }
};

export const PLANNED_WORK_KINDS = ['maintenance', 'network_change'] as const;
export type PlannedWorkKind = (typeof PLANNED_WORK_KINDS)[number];

/** Customer complaints that may be caused by a known network incident nearby (no power, low voltage). */
export const OUTAGE_PROBLEM_TYPES: readonly string[] = ['no_power_single', 'no_power_street', 'low_voltage'];

export const TICKET_ACTIONS = [
  'assign',
  'accept',
  'decline',
  'start',
  'hold',
  'resume',
  'resolve',
  'close',
  'reopen',
  'cancel'
] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

/** Actions that must come with a written reason. */
export const REASON_REQUIRED_ACTIONS: readonly TicketAction[] = ['decline', 'hold', 'cancel'];

interface ActionRule {
  from: readonly TicketStatus[];
  to: TicketStatus;
  roles: readonly Role[];
  /** Only the staff member the ticket is assigned to may do this. */
  assigneeOnly?: boolean;
}

/**
 * Ticket state machine:
 * new → assigned → accepted → in_progress ⇄ on_hold → resolved → closed
 * - staff can decline an assigned job (back to new, for someone else);
 * - a failed check reopens the ticket (resolved → reopened → assigned);
 * - any unfinished ticket can be cancelled (duplicate, customer withdrew, reported by mistake).
 */
export const ACTION_RULES: Record<TicketAction, ActionRule> = {
  assign: {
    from: ['new', 'assigned', 'accepted', 'in_progress', 'on_hold', 'reopened'],
    to: 'assigned',
    roles: ['team_manager', 'technical_manager', 'admin']
  },
  accept: { from: ['assigned'], to: 'accepted', roles: ['field_staff'], assigneeOnly: true },
  decline: { from: ['assigned', 'accepted'], to: 'new', roles: ['field_staff'], assigneeOnly: true },
  start: { from: ['accepted'], to: 'in_progress', roles: ['field_staff'], assigneeOnly: true },
  hold: { from: ['in_progress'], to: 'on_hold', roles: ['field_staff'], assigneeOnly: true },
  resume: { from: ['on_hold'], to: 'in_progress', roles: ['field_staff'], assigneeOnly: true },
  resolve: { from: ['in_progress'], to: 'resolved', roles: ['field_staff'], assigneeOnly: true },
  /** The Sales system closes new connections when the service is activated (checked in the service). */
  /** Team and technical managers only check "other" tickets (checked in the service). */
  close: {
    from: ['resolved'],
    to: 'closed',
    roles: [
      'integration_call_center',
      'integration_sales',
      'noc',
      'admin',
      'team_manager',
      'technical_manager'
    ]
  },
  reopen: {
    from: ['resolved'],
    to: 'reopened',
    roles: [
      'integration_call_center',
      'integration_sales',
      'noc',
      'admin',
      'team_manager',
      'technical_manager'
    ]
  },
  cancel: {
    from: ['new', 'assigned', 'accepted', 'in_progress', 'on_hold', 'resolved', 'reopened'],
    to: 'cancelled',
    roles: ['integration_call_center', 'noc', 'admin', 'team_manager', 'technical_manager']
  }
};

/** Who may check a finished ticket and close or reopen it: team and technical managers only check "other" tickets. */
export function mayCheck(type: TicketType, roles: readonly Role[]): boolean {
  return (
    roles.some(
      (r) => r === 'integration_call_center' || r === 'integration_sales' || r === 'noc' || r === 'admin'
    ) ||
    (type === 'other' && roles.some((r) => r === 'team_manager' || r === 'technical_manager'))
  );
}

export class TransitionError extends Error {
  constructor(
    readonly code: 'INVALID_TRANSITION' | 'FORBIDDEN_ROLE' | 'NOT_ASSIGNEE',
    message: string
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

export interface TransitionActor {
  userId: string | null;
  roles: readonly Role[];
}

/** Returns the status after `action`, or throws TransitionError when the action is not allowed. */
export function nextStatus(
  current: TicketStatus,
  action: TicketAction,
  actor: TransitionActor,
  assigneeId: string | null
): TicketStatus {
  const rule = ACTION_RULES[action];
  if (!rule.roles.some((r) => actor.roles.includes(r))) {
    throw new TransitionError('FORBIDDEN_ROLE', `Role cannot ${action} a ticket`);
  }
  if (!rule.from.includes(current)) {
    throw new TransitionError('INVALID_TRANSITION', `Cannot ${action} a ticket that is ${current}`);
  }
  if (rule.assigneeOnly && (!actor.userId || actor.userId !== assigneeId)) {
    throw new TransitionError('NOT_ASSIGNEE', `Only the assigned staff member can ${action} this ticket`);
  }
  return rule.to;
}

/** Actions a user may take on a ticket right now, for showing buttons in the web and the app. */
export function allowedActions(
  current: TicketStatus,
  actor: TransitionActor,
  assigneeId: string | null
): TicketAction[] {
  return TICKET_ACTIONS.filter((action) => {
    try {
      nextStatus(current, action, actor, assigneeId);
      return true;
    } catch {
      return false;
    }
  });
}

// ---- New customers (phase 4) ----

export const PREMISES_TYPES = ['home', 'shop', 'school', 'business', 'farm', 'other'] as const;
export type PremisesType = (typeof PREMISES_TYPES)[number];
export const SUPPLY_TYPES = ['single_phase', 'three_phase'] as const;
export type SupplyType = (typeof SUPPLY_TYPES)[number];
export const SURVEY_RESULTS = ['feasible', 'feasible_with_works', 'not_feasible'] as const;
export type SurveyResult = (typeof SURVEY_RESULTS)[number];

/** Time limits for new customer work: a survey within 3 days, a connection within 7. */
export const NEW_CUSTOMER_SLA_MINUTES = { survey: 3 * 1440, connection: 7 * 1440 } as const;

// ---- Stock (phase 4) ----

export const STOCK_UNITS = ['pcs', 'm', 'kg', 'set'] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const MOVEMENT_KINDS = ['receive', 'transfer', 'consume', 'adjust'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

// ---- Help requests from the field to the back office (phase 4) ----

export const HELP_KINDS = ['second_person', 'truck', 'material', 'switch_off', 'advice', 'other'] as const;
export type HelpKind = (typeof HELP_KINDS)[number];
export const HELP_STATUSES = ['new', 'in_progress', 'solved'] as const;
export type HelpStatus = (typeof HELP_STATUSES)[number];

/** The systems this one exchanges data with, shown on the Connected systems screen. */
export const INTEGRATION_SYSTEMS = ['call_center', 'sales', 'nms', 'stock', 'sms', 'push'] as const;
export type IntegrationSystem = (typeof INTEGRATION_SYSTEMS)[number];

/** The share of tickets that should be fixed within their time limit. */
export const ON_TIME_TARGET_PCT = 90;
