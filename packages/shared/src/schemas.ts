import { z } from 'zod';
import { USER_ROLES } from './roles.js';
import {
  ALARM_SEVERITIES,
  HELP_KINDS,
  HELP_STATUSES,
  MOVEMENT_KINDS,
  PREMISES_TYPES,
  STOCK_UNITS,
  SUPPLY_TYPES,
  SURVEY_RESULTS,
  NETWORK_REPORT_TYPE_KEYS,
  PLANNED_WORK_KINDS,
  PROBLEM_TYPE_KEYS,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TICKET_TYPES
} from './ticket.js';

/** Sent by the Call Center system when a customer reports a technical problem. */
export const callCenterComplaintSchema = z.object({
  externalRef: z.string().trim().min(1).max(64),
  contractNo: z.string().trim().min(1).max(32),
  problemType: z.enum(PROBLEM_TYPE_KEYS),
  description: z.string().trim().min(1).max(2000),
  callerPhone: z.string().trim().max(32).optional()
});
export type CallCenterComplaint = z.infer<typeof callCenterComplaintSchema>;

/** Sent by the Call Center system after calling the customer back. */
export const callCenterCheckResultSchema = z.object({
  result: z.enum(['fixed', 'not_fixed']),
  note: z.string().trim().max(1000).optional()
});
export type CallCenterCheckResult = z.infer<typeof callCenterCheckResultSchema>;

export const assignTicketSchema = z.object({
  assigneeId: z.string().uuid()
});
export type AssignTicket = z.infer<typeof assignTicketSchema>;

/** Materials used on a job, taken from the staff member's van (deducted from stock when the ticket closes). */
export const materialLineSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().positive().max(100_000)
});
export type MaterialLine = z.infer<typeof materialLineSchema>;

/** What the staff member found when surveying a new customer's premises. */
export const surveyReportSchema = z.object({
  result: z.enum(SURVEY_RESULTS),
  /** Metres from the premises to the nearest point of the network. */
  distanceToNetworkM: z.number().int().min(0).max(100_000).optional(),
  nearestElement: z.string().trim().max(100).optional(),
  /** Works needed first (new pole, line extension…), when feasible with works or not feasible. */
  worksNeeded: z.string().trim().max(1000).optional(),
  estimatedMaterials: z.array(materialLineSchema).max(30).default([])
});
export type SurveyReport = z.infer<typeof surveyReportSchema>;

/** A new connection handed over to the customer. */
export const installationReportSchema = z
  .object({
    meterNumber: z.string().trim().min(3).max(40),
    sealNumber: z.string().trim().max(40).optional(),
    /** The code the customer received by SMS and read out to the staff member. */
    handoverCode: z
      .string()
      .trim()
      .regex(/^\d{4}$/)
      .optional(),
    /** Without signal: a photo of the handover form signed by the customer (attachment id). */
    signedFormAttachmentId: z.string().uuid().optional()
  })
  .refine((v) => !!v.handoverCode || !!v.signedFormAttachmentId, {
    message: 'The customer must confirm: enter the SMS code, or attach the signed handover form',
    path: ['handoverCode']
  });
export type InstallationReport = z.infer<typeof installationReportSchema>;

export const resolveTicketSchema = z.object({
  note: z.string().trim().min(1).max(2000),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  materials: z.array(materialLineSchema).max(30).default([]),
  /** Required for new customer surveys. */
  survey: surveyReportSchema.optional(),
  /** Required for new connections. */
  installation: installationReportSchema.optional()
});
export type ResolveTicket = z.infer<typeof resolveTicketSchema>;

export const ATTACHMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const attachmentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(ATTACHMENT_CONTENT_TYPES),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES)
});
export type AttachmentUpload = z.infer<typeof attachmentUploadSchema>;

/**
 * Ready-made views of the ticket list (the tabs on the Tickets screen):
 * active = not closed or cancelled; late = past or within 30 minutes of the time limit and not yet fixed.
 */
export const TICKET_VIEWS = [
  'active',
  'unassigned',
  'late',
  'waiting_check',
  'closed_today',
  'closed',
  'all'
] as const;
export type TicketView = (typeof TICKET_VIEWS)[number];

export const ticketListQuerySchema = z.object({
  view: z.enum(TICKET_VIEWS).default('active'),
  status: z.enum(TICKET_STATUSES).optional(),
  /** Ticket code, external reference, customer name, contract, phone or address. */
  q: z.string().trim().max(100).optional(),
  type: z.enum(TICKET_TYPES).optional(),
  source: z.enum(TICKET_SOURCES).optional(),
  areaId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0)
});
export type TicketListQuery = z.infer<typeof ticketListQuerySchema>;

/** Declining, pausing and cancelling must say why; the reason is kept in the ticket history. */
export const reasonSchema = z.object({
  reason: z.string().trim().min(3).max(500)
});
export type Reason = z.infer<typeof reasonSchema>;

/** A note on a ticket from the office; optionally sent to the assigned staff member too. */
export const ticketNoteSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  notifyAssignee: z.boolean().default(false)
});
export type TicketNote = z.infer<typeof ticketNoteSchema>;

export const dutySchema = z.object({
  onDuty: z.boolean()
});
export type Duty = z.infer<typeof dutySchema>;

/** The EDM Field app registers the phone's Expo push token after sign-in. */
export const pushDeviceSchema = z.object({
  token: z
    .string()
    .trim()
    .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Not an Expo push token'),
  platform: z.enum(['android', 'ios'])
});
export type PushDevice = z.infer<typeof pushDeviceSchema>;

export const removePushDeviceSchema = pushDeviceSchema.pick({ token: true });

/**
 * Header the app sends when replaying an action it did while offline: when it really happened (ISO 8601).
 * Kept in the history; the server still records its own time.
 */
export const OCCURRED_AT_HEADER = 'x-occurred-at';

// ---- Account management (admin) ----

export const USER_STATUSES = ['active', 'blocked', 'cancelled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, 'Use 3–40 letters, numbers, dots, dashes or underscores');

export const createUserSchema = z.object({
  username,
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(32).optional(),
  roles: z.array(z.enum(USER_ROLES)).min(1).max(3),
  teamId: z.string().uuid().nullable().optional()
});
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.omit({ username: true }).partial();
export type UpdateUser = z.infer<typeof updateUserSchema>;

export const userListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional()
});
export type UserListQuery = z.infer<typeof userListQuerySchema>;

// ---- Network (phase 3) ----

export const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

/**
 * One alarm event from the network management system (NMS). "raise" opens or updates an alarm, "clear" ends it.
 * Alarms with the same cause (same correlationId, same element, or a parent element already in an incident) are
 * grouped into one network incident ticket.
 */
export const nmsAlarmEventSchema = z.object({
  /** The NMS's own id for the alarm; raise and clear of the same alarm share it. */
  alarmId: z.string().trim().min(1).max(100),
  event: z.enum(['raise', 'clear']),
  /** Network element: feeder, breaker, transformer, substation… e.g. "F-12", "PT-4471". */
  elementCode: z.string().trim().min(1).max(64),
  elementName: z.string().trim().max(200).optional(),
  elementType: z.string().trim().max(40).optional(),
  /** Element that feeds this one (e.g. the feeder of a transformer); used to group alarms with the same cause. */
  parentElementCode: z.string().trim().max(64).optional(),
  /** Root-cause id when the NMS already knows which alarms belong together. */
  correlationId: z.string().trim().max(100).optional(),
  alarmType: z.string().trim().min(1).max(200),
  severity: z.enum(ALARM_SEVERITIES),
  occurredAt: z.string().datetime({ offset: true }),
  location: pointSchema.optional(),
  /** NMS estimate of customers without power. */
  customersAffected: z.number().int().min(0).optional(),
  details: z.string().trim().max(2000).optional()
});
export type NmsAlarmEvent = z.infer<typeof nmsAlarmEventSchema>;

export const nmsAlarmBatchSchema = z.object({
  alarms: z.array(nmsAlarmEventSchema).min(1).max(500)
});
export type NmsAlarmBatch = z.infer<typeof nmsAlarmBatchSchema>;

/** A member of the public reports a network problem to the Call Center (800 145 145). */
export const networkReportSchema = z.object({
  externalRef: z.string().trim().min(1).max(64),
  reportType: z.enum(NETWORK_REPORT_TYPE_KEYS),
  description: z.string().trim().min(1).max(2000),
  address: z.string().trim().min(1).max(300),
  location: pointSchema.optional(),
  callerPhone: z.string().trim().max(32).optional()
});
export type NetworkReport = z.infer<typeof networkReportSchema>;

/** Maintenance or a network change planned by the network team. */
export const plannedWorkSchema = z
  .object({
    kind: z.enum(PLANNED_WORK_KINDS),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional(),
    /** Equipment or place, e.g. "PT-1180 · Matola, Liberdade". */
    element: z.string().trim().min(1).max(200),
    teamId: z.string().uuid(),
    location: pointSchema.optional(),
    scheduledStart: z.string().datetime({ offset: true }),
    scheduledEnd: z.string().datetime({ offset: true }),
    /** Power will be cut during the work. */
    outage: z.boolean().default(false),
    customersAffected: z.number().int().min(0).optional()
  })
  .refine((v) => Date.parse(v.scheduledEnd) > Date.parse(v.scheduledStart), {
    message: 'The end must be after the start',
    path: ['scheduledEnd']
  });
export type PlannedWork = z.infer<typeof plannedWorkSchema>;

export const plannedWorkQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  areaId: z.string().uuid().optional()
});
export type PlannedWorkQuery = z.infer<typeof plannedWorkQuerySchema>;

/** Positions recorded by the app while on duty, sent in batches (also after being offline). */
export const locationBatchSchema = z.object({
  points: z
    .array(
      pointSchema.extend({
        accuracy: z.number().min(0).max(100_000).optional(),
        recordedAt: z.string().datetime({ offset: true })
      })
    )
    .min(1)
    .max(500)
});
export type LocationBatch = z.infer<typeof locationBatchSchema>;

export const setTeamSchema = z.object({ teamId: z.string().uuid() });
export const linkTicketsSchema = z.object({ ticketIds: z.array(z.string().uuid()).min(1).max(100) });
export const notifyCustomersSchema = z.object({ message: z.string().trim().min(5).max(300).optional() });

export const fieldStaffQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(92).default(30),
  teamId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional()
});
export type FieldStaffQuery = z.infer<typeof fieldStaffQuerySchema>;

// ---- New customers from the Sales system (phase 4) ----

export const prospectSchema = z.object({
  fullName: z.string().trim().min(2).max(200),
  phone: z.string().trim().max(32).optional(),
  address: z.string().trim().min(3).max(300),
  location: pointSchema.optional()
});

/** Sales asks for a technical survey before selling a connection. */
export const surveyRequestSchema = z.object({
  externalRef: z.string().trim().min(1).max(64),
  customer: prospectSchema,
  premises: z.enum(PREMISES_TYPES),
  supply: z.enum(SUPPLY_TYPES),
  requestedLoadKw: z.number().positive().max(10_000).optional(),
  notes: z.string().trim().max(2000).optional()
});
export type SurveyRequest = z.infer<typeof surveyRequestSchema>;

/** The contract is signed: Sales asks for the connection to be built. */
export const connectionRequestSchema = z
  .object({
    externalRef: z.string().trim().min(1).max(64),
    contractNo: z.string().trim().min(1).max(32),
    /** The survey request this follows, if any (customer and place are taken from it). */
    surveyRef: z.string().trim().max(64).optional(),
    customer: prospectSchema.optional(),
    premises: z.enum(PREMISES_TYPES).optional(),
    supply: z.enum(SUPPLY_TYPES),
    notes: z.string().trim().max(2000).optional()
  })
  .refine((v) => !!v.surveyRef || !!v.customer, {
    message: 'Give the survey reference or the customer',
    path: ['customer']
  });
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;

export const activationResultSchema = z.object({
  activated: z.boolean(),
  note: z.string().trim().max(1000).optional()
});
export type ActivationResult = z.infer<typeof activationResultSchema>;

// ---- Stock (phase 4) ----

export const stockItemSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(200),
  unit: z.enum(STOCK_UNITS),
  /** Below this in the depots the item is "low"; below watchLevel it is "watch". */
  lowLevel: z.number().min(0).default(0),
  watchLevel: z.number().min(0).default(0)
});
export type StockItemInput = z.infer<typeof stockItemSchema>;

const stockLines = z
  .array(z.object({ itemId: z.string().uuid(), quantity: z.number().positive().max(1_000_000) }))
  .min(1)
  .max(100);

/** Goods arriving at a depot (e.g. from the supplier or EDM's central store). */
export const receiveStockSchema = z.object({
  locationId: z.string().uuid(),
  lines: stockLines,
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional()
});
export type ReceiveStock = z.infer<typeof receiveStockSchema>;

/** Moving stock between places: depot to van ("give to a van"), van back to depot, depot to depot. */
export const transferStockSchema = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  lines: stockLines,
  note: z.string().trim().max(500).optional()
});
export type TransferStock = z.infer<typeof transferStockSchema>;

/** Correcting the count after a stock-take: the new quantity actually there. */
export const adjustStockSchema = z.object({
  locationId: z.string().uuid(),
  itemId: z.string().uuid(),
  countedQuantity: z.number().min(0).max(1_000_000),
  reason: z.string().trim().min(3).max(500)
});
export type AdjustStock = z.infer<typeof adjustStockSchema>;

export const reserveStockSchema = z.object({
  lines: stockLines
});

export const movementQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  kind: z.enum(MOVEMENT_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});
export type MovementQuery = z.infer<typeof movementQuerySchema>;

/** From EDM's stock management system: goods received at a depot, by depot and item code. */
export const stockReceiptSyncSchema = z.object({
  externalRef: z.string().trim().min(1).max(100),
  depotCode: z.string().trim().min(1).max(40),
  lines: z
    .array(z.object({ itemCode: z.string().trim().min(1).max(40), quantity: z.number().positive() }))
    .min(1)
    .max(500)
});
export type StockReceiptSync = z.infer<typeof stockReceiptSyncSchema>;

export const stockItemsSyncSchema = z.object({ items: z.array(stockItemSchema).min(1).max(1000) });

export const consumptionQuerySchema = z.object({
  since: z.string().datetime({ offset: true }),
  limit: z.coerce.number().int().min(1).max(1000).default(500)
});

// ---- Vehicles ----

export const vehicleSchema = z.object({
  plate: z.string().trim().min(3).max(20),
  label: z.string().trim().max(100).optional(),
  teamId: z.string().uuid()
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const assignVehicleSchema = z.object({ userId: z.string().uuid().nullable() });

// ---- Help requests ----

export const helpRequestSchema = z.object({
  kind: z.enum(HELP_KINDS),
  message: z.string().trim().min(3).max(1000),
  ticketId: z.string().uuid().optional()
});
export type HelpRequestInput = z.infer<typeof helpRequestSchema>;

export const helpReplySchema = z.object({
  body: z.string().trim().min(1).max(1000),
  status: z.enum(HELP_STATUSES).optional()
});
export type HelpReply = z.infer<typeof helpReplySchema>;

export const helpListQuerySchema = z.object({
  status: z.enum(HELP_STATUSES).optional(),
  areaId: z.string().uuid().optional()
});

// ---- Reports ----

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** A period of whole days in Maputo time, both ends included; at most a year. */
export const reportQuerySchema = z
  .object({
    from: day,
    to: day,
    areaId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional()
  })
  .refine((q) => q.from <= q.to, { message: 'The start must be before the end', path: ['from'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 366, {
    message: 'Choose a period of a year or less',
    path: ['to']
  });
export type ReportQuery = z.infer<typeof reportQuerySchema>;

// ---- New ticket screen (W05): EDM staff take the call themselves ----

const callerPhone = z.string().trim().max(32).optional();

/** A customer of EDM calling about their supply (like a Call Center complaint), or someone reporting the network. */
export const officeTicketSchema = z.discriminatedUnion('caller', [
  z.object({
    caller: z.literal('customer'),
    customerId: z.string().uuid(),
    problemType: z.enum(PROBLEM_TYPE_KEYS),
    /** Only for "Something else", which has no set priority. */
    priority: z.number().int().min(1).max(3).optional(),
    description: z.string().trim().min(3).max(2000),
    callerPhone,
    /** False when the person taking the call decides it is not the open incident nearby. */
    joinIncident: z.boolean().default(true)
  }),
  z.object({
    caller: z.literal('public'),
    reportType: z.enum(NETWORK_REPORT_TYPE_KEYS),
    address: z.string().trim().min(3).max(300),
    location: pointSchema.optional(),
    description: z.string().trim().min(3).max(2000),
    callerName: z.string().trim().max(200).optional(),
    callerPhone
  })
]);
export type OfficeTicket = z.infer<typeof officeTicketSchema>;

/** What would happen if the ticket were created now (the "What happens next" panel). */
export const ticketPreviewSchema = z.discriminatedUnion('caller', [
  z.object({
    caller: z.literal('customer'),
    customerId: z.string().uuid(),
    problemType: z.enum(PROBLEM_TYPE_KEYS),
    priority: z.number().int().min(1).max(3).optional()
  }),
  z.object({
    caller: z.literal('public'),
    reportType: z.enum(NETWORK_REPORT_TYPE_KEYS),
    location: pointSchema.optional()
  })
]);
export type TicketPreviewInput = z.infer<typeof ticketPreviewSchema>;

export const customerLookupSchema = z.object({ q: z.string().trim().min(3).max(64) });

/** Marks bell notifications as read: the ones given, or all of them. */
export const inboxReadSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });
export type InboxRead = z.infer<typeof inboxReadSchema>;

/** The region picker at the top of the web app: lists and summaries for one area only. */
export const areaFilterSchema = z.object({ areaId: z.string().uuid().optional() });
export type AreaFilter = z.infer<typeof areaFilterSchema>;
