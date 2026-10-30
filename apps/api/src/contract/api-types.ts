import type {
  AlarmSeverity,
  HelpKind,
  HelpStatus,
  IntegrationSystem,
  MovementKind,
  PlannedWorkKind,
  PremisesType,
  StockUnit,
  SupplyType,
  SurveyResult,
  TicketAction,
  TicketSource,
  TicketStatus,
  TicketType
} from './ticket.js';
import type { ApiKeySystem } from './roles.js';

/** Shapes returned by the API. */
export interface TicketSummary {
  id: string;
  code: string;
  type: TicketType;
  source: TicketSource;
  /** Customer problem type, network report type, or planned work kind. */
  problemType: string | null;
  status: TicketStatus;
  priority: number;
  title: string;
  areaName: string | null;
  teamId: string | null;
  teamName: string | null;
  assignee: { id: string; fullName: string } | null;
  customerName: string | null;
  /** Customer's address, where the job is. */
  address: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketEventView {
  id: string;
  type: string;
  actorName: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AttachmentView {
  id: string;
  fileName: string;
  contentType: string;
  url: string | null;
  createdAt: string;
}

export interface TicketDetail extends TicketSummary {
  description: string;
  externalRef: string | null;
  customer: {
    id: string;
    /** Empty for a new customer who has no contract yet. */
    contractNo: string | null;
    meterNumber: string | null;
    fullName: string;
    phone: string | null;
    address: string;
  } | null;
  location: { lat: number; lng: number } | null;
  events: TicketEventView[];
  attachments: AttachmentView[];
  allowedActions: TicketAction[];
  /** Network incidents: the element, severity, alarms and the customer tickets linked to it. */
  network: NetworkInfo | null;
  /** Planned work: when, and whether power is cut. */
  planned: PlannedInfo | null;
  /** Customer tickets caused by a known network incident. */
  incident: { id: string; code: string; title: string; status: TicketStatus } | null;
  /** 0 = on time; 1 = staff reminded; 2 = late, team manager and NOC told; 3 = badly late, technical manager told. */
  escalationLevel: number;
  /** Materials recorded on the job; deducted from stock when the ticket closes. */
  materials: TicketMaterialView[];
  /** Materials set aside in a depot for this ticket. */
  reservations: ReservationView[];
  /** Surveys and connections for new customers. */
  newCustomer: NewCustomerInfo | null;
}

export interface TicketMaterialView {
  id: string;
  itemId: string;
  code: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  /** Where it was taken from (the van). */
  fromLocation: string | null;
  /** Deducted from stock (the ticket has closed). */
  posted: boolean;
  recordedBy: string | null;
  recordedAt: string;
}

export interface ReservationView {
  id: string;
  itemId: string;
  code: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  locationName: string;
}

export interface NewCustomerInfo {
  kind: 'survey' | 'connection';
  premises: PremisesType | null;
  supply: SupplyType | null;
  requestedLoadKw: number | null;
  contractNo: string | null;
  /** The survey this connection follows. */
  surveyTicket: { id: string; code: string } | null;
  survey: {
    result: SurveyResult;
    distanceToNetworkM: number | null;
    nearestElement: string | null;
    worksNeeded: string | null;
    estimatedMaterials: { itemId: string; code: string; name: string; unit: StockUnit; quantity: number }[];
  } | null;
  installation: {
    meterNumber: string;
    sealNumber: string | null;
    confirmedBy: 'sms_code' | 'signed_form';
    confirmedAt: string;
  } | null;
  /** When the Sales system activated the service. */
  activatedAt: string | null;
  /** A handover code has been sent to the customer and not used yet. */
  handoverCodeSentAt: string | null;
}

export interface AlarmView {
  id: string;
  alarmId: string;
  elementCode: string;
  elementName: string | null;
  alarmType: string;
  severity: AlarmSeverity;
  raisedAt: string;
  clearedAt: string | null;
}

export interface NetworkInfo {
  elementCode: string | null;
  elementName: string | null;
  severity: AlarmSeverity | null;
  customersAffected: number | null;
  alarms: AlarmView[];
  activeAlarms: number;
  linkedTickets: TicketSummary[];
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface PlannedInfo {
  kind: PlannedWorkKind;
  element: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  outage: boolean;
  customersAffected: number | null;
}

/** A network incident in the list of the Network incidents screen. */
export interface IncidentSummary extends TicketSummary {
  severity: AlarmSeverity | null;
  elementCode: string | null;
  alarmCount: number;
  activeAlarms: number;
  customersAffected: number | null;
  linkedTickets: number;
  acknowledgedAt: string | null;
  lastAlarmAt: string | null;
}

export interface PlannedWorkItem extends TicketSummary {
  planned: PlannedInfo;
}

export type StaffState = 'on_job' | 'free' | 'offline' | 'off_duty';

export interface StaffLocation {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: string;
}

/** A field staff member on the live map and the Field staff screen. */
export interface StaffLive {
  id: string;
  fullName: string;
  phone: string | null;
  teamId: string | null;
  teamName: string | null;
  state: StaffState;
  location: StaffLocation | null;
  currentJob: { id: string; code: string; title: string; status: TicketStatus } | null;
  openJobs: number;
  doneToday: number;
}

export interface LiveMap {
  staff: StaffLive[];
  tickets: MapTicket[];
  areas: { id: string; name: string; boundary: [number, number][][][] }[];
  updatedAt: string;
}

/** How a field staff member has worked over a period (Field staff screen). */
export interface StaffPerformance extends StaffLive {
  jobsAssigned: number;
  jobsDone: number;
  /** Share of finished jobs reported done before their time limit (0–1). */
  onTimeRate: number | null;
  /** Average minutes from being given a job to arriving (start). */
  avgToArriveMin: number | null;
  /** Average minutes from arriving to reporting it done. */
  avgFixMin: number | null;
  /** Share of closed jobs that never had to be reopened (0–1). */
  firstTimeFixRate: number | null;
  reopened: number;
  declined: number;
}

export interface StaffMember {
  id: string;
  fullName: string;
  phone: string | null;
  onDuty: boolean;
  openJobs: number;
}

export interface CurrentUser {
  id: string;
  username: string;
  fullName: string;
  roles: string[];
  teamId: string | null;
  teamName: string | null;
  onDuty: boolean;
}

export interface AdminUser {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  teamId: string | null;
  teamName: string | null;
  areaName: string | null;
  status: 'active' | 'blocked' | 'cancelled';
  onDuty: boolean;
  /** Last time they used the system; null = has not signed in yet. */
  lastSeenAt: string | null;
  createdAt: string;
}

export interface TeamView {
  id: string;
  code: string;
  name: string;
  areaName: string;
}

/** Number of tickets in each tab of the Tickets screen, within what the caller may see. */
export type TicketCounts = Record<
  'active' | 'unassigned' | 'late' | 'waiting_check' | 'closed_today' | 'incidents' | 'help',
  number
>;

export interface Lookups {
  areas: { id: string; name: string }[];
  teams: { id: string; name: string; areaId: string; areaName: string }[];
}

/** A field staff member as a choice for a ticket, best first. */
export interface StaffSuggestion extends StaffMember {
  /** Straight-line distance from the staff member's last known position to the ticket, in metres. */
  distanceM: number | null;
  /** When that position was recorded. */
  locationAt: string | null;
  /** Jobs they reported done today. */
  doneToday: number;
  /** The person automatic assignment would choose. */
  bestMatch: boolean;
}

/** An SMS or push notification sent about a ticket. */
export interface TicketMessage {
  id: string;
  channel: 'sms' | 'push' | 'webhook';
  /** Who it went to, in words: "Customer", "Armando Cossa (field staff)", "Team manager". */
  to: string;
  body: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
}

export interface MapTicket {
  id: string;
  type: TicketType;
  code: string;
  title: string;
  status: TicketStatus;
  lat: number;
  lng: number;
  late: boolean;
}

/** Figures and lists for the Overview screen. */
export interface Overview {
  open: number;
  newToday: number;
  beingFixed: number;
  staffOnDuty: number;
  waitingCheck: number;
  waitingCallCenter: number;
  late: number;
  attention: TicketSummary[];
  unassigned: TicketSummary[];
  map: MapTicket[];
}

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

// ---- Stock ----

export type StockLevel = 'good' | 'watch' | 'low';

export interface StockItemView {
  id: string;
  code: string;
  name: string;
  unit: StockUnit;
  lowLevel: number;
  watchLevel: number;
  inDepots: number;
  inVans: number;
  reserved: number;
  /** From what is free in the depots (in depots − reserved) against the item's levels. */
  level: StockLevel;
}

export interface StockLocationView {
  id: string;
  kind: 'depot' | 'van';
  code: string;
  name: string;
  areaId: string | null;
  areaName: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface StockLine {
  itemId: string;
  code: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  reserved: number;
}

export interface MovementView {
  id: string;
  kind: MovementKind;
  itemCode: string;
  itemName: string;
  unit: StockUnit;
  quantity: number;
  from: string | null;
  to: string | null;
  ticket: { id: string; code: string } | null;
  actorName: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface VehicleView {
  id: string;
  plate: string;
  label: string | null;
  teamId: string;
  teamName: string;
  locationId: string;
  assignedTo: { id: string; fullName: string } | null;
  /** Kinds of material on board. */
  itemsOnBoard: number;
}

/** The field staff member's van and what is in it (EDM Field app). */
export interface MyVan {
  vehicle: VehicleView | null;
  lines: StockLine[];
  /** The whole catalogue, for recording material not carried in the van. */
  catalog: { id: string; code: string; name: string; unit: StockUnit }[];
}

// ---- New customers board ----

export type NewCustomerStage =
  'survey_requested' | 'survey_done' | 'contract_signed' | 'being_connected' | 'connected';

export interface NewCustomerCard {
  ticketId: string;
  code: string;
  stage: NewCustomerStage;
  title: string;
  place: string | null;
  premises: PremisesType | null;
  supply: SupplyType | null;
  /** Short state shown on the card: "Not assigned", "Feasible", "Waiting for activation"… */
  badge: string | null;
  badgeTone: 'good' | 'warn' | 'bad' | null;
  assignee: { id: string; fullName: string } | null;
  date: string;
}

// ---- Help requests ----

export interface HelpMessageView {
  id: string;
  authorName: string;
  fromField: boolean;
  body: string;
  createdAt: string;
}

export interface HelpRequestView {
  id: string;
  kind: HelpKind;
  message: string;
  status: HelpStatus;
  ticket: { id: string; code: string; title: string } | null;
  requestedBy: { id: string; fullName: string; phone: string | null };
  teamName: string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
  messages: HelpMessageView[];
}

// ---- Reports (phase 5) ----

export interface ReportTeamRow {
  teamId: string;
  teamName: string;
  closed: number;
  /** Share of tickets fixed within their time limit (null when none had one). */
  onTimePct: number | null;
  avgFixMinutes: number | null;
  reopenedPct: number | null;
}

export interface ReportStaffRow {
  userId: string;
  fullName: string;
  teamName: string | null;
  fixed: number;
  onTimePct: number | null;
  avgFixMinutes: number | null;
  firstTimePct: number | null;
}

export interface ReportMaterialRow {
  itemId: string;
  code: string;
  name: string;
  unit: StockUnit;
  quantity: number;
  tickets: number;
}

export interface Report {
  from: string;
  to: string;
  /** The same KPI over the period of the same length just before. */
  closed: number;
  closedBefore: number;
  onTimePct: number | null;
  onTimeTarget: number;
  /** Mean time to repair: ticket created → reported fixed (planned work left out). */
  mttrMinutes: number | null;
  /** Closed without the check ever finding the job not done. */
  firstTimePct: number | null;
  received: number;
  stillOpen: number;
  perDay: { day: string; closed: number }[];
  byType: { type: TicketType; closed: number }[];
  byTeam: ReportTeamRow[];
  byStaff: ReportStaffRow[];
  incidents: {
    count: number;
    avgRestoreMinutes: number | null;
    customersAffected: number;
    alarms: number;
  };
  newCustomers: {
    surveysDone: number;
    avgSurveyDays: number | null;
    connectionsDone: number;
    avgConnectionDays: number | null;
    waitingActivation: number;
  };
  materials: ReportMaterialRow[];
}

// ---- Connected systems (phase 5) ----

export type IntegrationStatus = 'connected' | 'slow' | 'problem' | 'quiet' | 'not_set';

export interface IntegrationView {
  system: IntegrationSystem;
  status: IntegrationStatus;
  /** Last request or delivery that went through. */
  lastOkAt: string | null;
  lastAt: string | null;
  /** What came in or went out today, in the system's own terms ("412 tickets received"). */
  today: string;
  /** Short reason when the status is not "connected". */
  note: string | null;
}

export interface IntegrationProblem {
  system: IntegrationSystem;
  firstAt: string;
  lastAt: string;
  count: number;
  message: string;
  solved: boolean;
}

export interface IntegrationsOverview {
  systems: IntegrationView[];
  problems: IntegrationProblem[];
}

export interface IntegrationCallView {
  id: string;
  direction: 'in' | 'out';
  operation: string;
  statusCode: number | null;
  ok: boolean;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
  durationMs: number | null;
}

/** One input of an integration API, flattened: "customer.fullName", "alarms[].severity". */
export interface IntegrationDocField {
  name: string;
  in: 'path' | 'query' | 'body';
  type: string;
  format: string | null;
  required: boolean;
  description: string | null;
  /** Allowed values. */
  values: string[] | null;
  /** Length for text, value for numbers, number of items for lists. */
  min: number | null;
  max: number | null;
  /** The value must be above min, not equal to it. */
  minExclusive: boolean;
}

export interface IntegrationDocOperation {
  method: string;
  path: string;
  summary: string;
  description: string | null;
  fields: IntegrationDocField[];
  /** A request body that is accepted as it is. */
  example: unknown;
}

/** An event EDM Tasks posts to the other system. */
export interface IntegrationDocWebhook {
  event: string;
  description: string;
  example: unknown;
}

export interface IntegrationDocSystem {
  system: IntegrationSystem;
  operations: IntegrationDocOperation[];
  webhooks: IntegrationDocWebhook[];
}

/** The "API documentation" screen: what the other EDM systems can call, built from the API description. */
export interface IntegrationDocs {
  systems: IntegrationDocSystem[];
}

// ---- New ticket screen ----

export interface CustomerMatch {
  id: string;
  fullName: string;
  contractNo: string | null;
  meterNumber: string | null;
  phone: string | null;
  address: string;
  location: { lat: number; lng: number } | null;
  areaName: string | null;
  teamName: string | null;
  /** Tickets of this customer not finished yet, so the same problem is not entered twice. */
  openTickets: { id: string; code: string; title: string; status: TicketStatus }[];
}

export interface TicketPreview {
  /** The team that goes: the one chosen, or else the team covering the place. */
  team: { id: string; name: string } | null;
  /** The team covering the place, whatever was chosen. */
  autoTeam: { id: string; name: string } | null;
  areaName: string | null;
  /** Who automatic assignment would pick now; null when nobody of the team is on duty (the manager is told). */
  /** Who automatic assignment would pick: someone on duty first, else someone off duty (sees it on their next shift). */
  assignee: {
    id: string;
    fullName: string;
    distanceM: number | null;
    openJobs: number;
    onDuty: boolean;
  } | null;
  priority: number;
  slaMinutes: number;
  dueAt: string;
  /** An open network incident close to the customer, for "Is this the same problem?". */
  incident: {
    id: string;
    code: string;
    title: string;
    elementName: string | null;
    linkedCustomers: number;
  } | null;
  /** The SMS the caller gets: as a new job, or as part of the known incident. */
  sms: { newJob: string; knownOutage: string | null } | null;
}

export interface CreatedTicketView {
  id: string;
  code: string;
  status: TicketStatus;
  assigneeName: string | null;
  incident: { id: string; code: string } | null;
}

// ---- The bell in the web app ----

export interface InboxItem {
  id: string;
  title: string;
  /** Where clicking it goes, e.g. /tickets/<id> or /help. */
  link: string | null;
  createdAt: string;
  read: boolean;
}

export interface Inbox {
  unread: number;
  items: InboxItem[];
}

// ---- Signing in ----

export interface SignInResult {
  /** Sent as "Authorization: Bearer …"; short-lived, renewed with /auth/refresh. */
  accessToken: string;
  expiresIn: number;
  /** Phone app only; the web app gets it in an httpOnly cookie. */
  refreshToken?: string;
  /** The person must choose their own password before using anything else. */
  mustChangePassword: boolean;
}

export interface ApiKeyView {
  id: string;
  system: ApiKeySystem;
  name: string;
  /** First characters of the key, to recognise it; the key itself is shown only once. */
  prefix: string;
  createdAt: string;
  createdByName: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreatedApiKey {
  apiKey: ApiKeyView;
  /** The whole key: shown once, give it to the team running that system. */
  key: string;
}

// ---- Areas and teams (admin area) ----

export interface AreaTeamView {
  id: string;
  code: string;
  name: string;
  /** Active people in the team (field staff and team managers). */
  people: number;
  managers: string[];
}

export interface AreaView {
  id: string;
  code: string;
  name: string;
  /** GeoJSON MultiPolygon coordinates: polygons of rings of [lng, lat]. */
  boundary: [number, number][][][];
  /** Square kilometres. */
  sizeKm2: number;
  /** In order: the first team gets the area's new tickets. */
  teams: AreaTeamView[];
  openTickets: number;
}

/** Which area and team a point on the map falls in (forms that only have a place, like surveys). */
export interface PlaceTeam {
  areaName: string | null;
  team: { id: string; name: string } | null;
}
