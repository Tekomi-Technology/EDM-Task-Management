import { z } from 'zod';
import { API_KEY_SYSTEMS, USER_ROLES } from './roles.js';
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
  externalRef: z.string().trim().min(1).max(64).meta({
    description: 'Your own reference for the call; sending it again does not create a second ticket.',
    example: 'CC-2026-000123'
  }),
  contractNo: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .meta({ description: 'Contract number of the EDM customer who called.', example: '40217735' }),
  problemType: z.enum(PROBLEM_TYPE_KEYS).meta({
    description: 'What the customer reports; it sets the priority and the time limit.',
    example: 'no_power_single'
  }),
  description: z.string().trim().min(1).max(2000).meta({
    description: 'What the caller said, for the field staff.',
    example: 'No power since 7 am; the neighbours have power.'
  }),
  callerPhone: z.string().trim().max(32).optional().meta({
    description: 'Phone to call back and to send SMS to, when not the one on the contract.',
    example: '+258841110002'
  })
});
export type CallCenterComplaint = z.infer<typeof callCenterComplaintSchema>;

/** Sent by the Call Center system after calling the customer back. */
export const callCenterCheckResultSchema = z.object({
  result: z
    .enum(['fixed', 'not_fixed'])
    .meta({ description: 'What the customer said when called back.', example: 'fixed' }),
  note: z.string().trim().max(1000).optional().meta({
    description: 'What the customer said, kept in the ticket history.',
    example: 'Power is back since 10:40.'
  })
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
  reason: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .meta({ description: 'Why, kept in the ticket history.', example: 'Duplicate of CC-2026-000120.' })
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
  lat: z.number().min(-90).max(90).meta({ description: 'Latitude (WGS 84).', example: -25.915 }),
  lng: z.number().min(-180).max(180).meta({ description: 'Longitude (WGS 84).', example: 32.455 })
});

/**
 * One alarm event from the network management system (NMS). "raise" opens or updates an alarm, "clear" ends it.
 * Alarms with the same cause (same correlationId, same element, or a parent element already in an incident) are
 * grouped into one network incident ticket.
 */
export const nmsAlarmEventSchema = z.object({
  alarmId: z.string().trim().min(1).max(100).meta({
    description: "The NMS's own id for the alarm; raise and clear of the same alarm share it.",
    example: 'NMS-889120'
  }),
  event: z
    .enum(['raise', 'clear'])
    .meta({ description: '"raise" opens or updates the alarm, "clear" ends it.', example: 'raise' }),
  elementCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .meta({ description: 'Network element: feeder, breaker, transformer, substation…', example: 'PT-4471' }),
  elementName: z
    .string()
    .trim()
    .max(200)
    .optional()
    .meta({ description: 'Name of the element, shown to the staff.', example: 'PT Matola Gare 3' }),
  elementType: z
    .string()
    .trim()
    .max(40)
    .optional()
    .meta({ description: 'Kind of element.', example: 'transformer' }),
  parentElementCode: z.string().trim().max(64).optional().meta({
    description:
      'Element that feeds this one (e.g. the feeder of a transformer); used to group alarms with the same cause.',
    example: 'F-12'
  }),
  correlationId: z.string().trim().max(100).optional().meta({
    description: 'Root-cause id when the NMS already knows which alarms belong together.',
    example: 'RC-5531'
  }),
  alarmType: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .meta({ description: 'What the NMS detected.', example: 'Transformer overload trip' }),
  severity: z.enum(ALARM_SEVERITIES).meta({
    description: 'Sets the priority and the time limit; "warning" is recorded but opens no incident.',
    example: 'major'
  }),
  occurredAt: z
    .string()
    .datetime({ offset: true })
    .meta({ description: 'When it happened, with the time zone.', example: '2026-10-28T08:15:00+02:00' }),
  location: pointSchema.optional().meta({
    description: 'Where the element is, to send the nearest team.',
    example: { lat: -25.951, lng: 32.462 }
  }),
  customersAffected: z
    .number()
    .int()
    .min(0)
    .optional()
    .meta({ description: 'NMS estimate of customers without power.', example: 320 }),
  details: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .meta({ description: 'Anything else the staff should know.', example: 'Breaker B2 open.' })
});
export type NmsAlarmEvent = z.infer<typeof nmsAlarmEventSchema>;

export const nmsAlarmBatchSchema = z.object({
  alarms: z
    .array(nmsAlarmEventSchema)
    .min(1)
    .max(500)
    .meta({ description: 'Alarm events, handled in the order sent (a clear may follow its raise).' })
});
export type NmsAlarmBatch = z.infer<typeof nmsAlarmBatchSchema>;

/** A member of the public reports a network problem to the Call Center (800 145 145). */
export const networkReportSchema = z.object({
  externalRef: z.string().trim().min(1).max(64).meta({
    description: 'Your own reference for the call; sending it again does not create a second ticket.',
    example: 'CC-2026-000124'
  }),
  reportType: z.enum(NETWORK_REPORT_TYPE_KEYS).meta({
    description: 'What the caller saw; it sets the priority and the time limit.',
    example: 'cable_down'
  }),
  description: z.string().trim().min(1).max(2000).meta({
    description: 'What the caller said, for the field staff.',
    example: 'Cable on the ground next to the school.'
  }),
  address: z.string().trim().min(1).max(300).meta({
    description: 'Street, landmark, neighbourhood.',
    example: 'Av. de Moçambique, near Escola 3 de Fevereiro'
  }),
  location: pointSchema.optional().meta({
    description: 'The place, to send the nearest team. Without it NOC routes the ticket.',
    example: { lat: -25.962, lng: 32.57 }
  }),
  callerPhone: z
    .string()
    .trim()
    .max(32)
    .optional()
    .meta({ description: 'Caller’s phone, for the SMS updates.', example: '+258849000002' })
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
  fullName: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .meta({ description: 'Customer or company name.', example: 'Loja Esperança' }),
  phone: z.string().trim().max(32).optional().meta({
    description: 'Customer phone, for the SMS updates and the handover code.',
    example: '+258849000001'
  }),
  address: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .meta({ description: 'Address of the premises.', example: 'Matola Gare, Rua 4' }),
  location: pointSchema.optional().meta({
    description: 'The premises, to send the team of that area.',
    example: { lat: -25.915, lng: 32.455 }
  })
});

/** Sales asks for a technical survey before selling a connection. */
export const surveyRequestSchema = z.object({
  externalRef: z.string().trim().min(1).max(64).meta({
    description: 'Your reference for the request; results and status use it.',
    example: 'KS-2026-0001'
  }),
  customer: prospectSchema.meta({ description: 'The future customer.' }),
  premises: z.enum(PREMISES_TYPES).meta({ description: 'Kind of premises.', example: 'shop' }),
  supply: z.enum(SUPPLY_TYPES).meta({ description: 'Supply asked for.', example: 'single_phase' }),
  requestedLoadKw: z
    .number()
    .positive()
    .max(10_000)
    .optional()
    .meta({ description: 'Power asked for, in kW.', example: 6 }),
  notes: z.string().trim().max(2000).optional().meta({
    description: 'Anything the surveyor should know.',
    example: 'Customer is there on weekdays after 14:00.'
  })
});
export type SurveyRequest = z.infer<typeof surveyRequestSchema>;

/** The contract is signed: Sales asks for the connection to be built. */
export const connectionRequestSchema = z
  .object({
    externalRef: z.string().trim().min(1).max(64).meta({
      description: 'Your reference for the request; activation and status use it.',
      example: 'DN-2026-0001'
    }),
    contractNo: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .meta({ description: 'The signed contract.', example: 'HD-2026-0001' }),
    surveyRef: z.string().trim().max(64).optional().meta({
      description:
        'The survey request this follows, if any: customer, place and material estimate are taken from it.',
      example: 'KS-2026-0001'
    }),
    customer: prospectSchema.optional().meta({ description: 'The customer, when there was no survey.' }),
    premises: z
      .enum(PREMISES_TYPES)
      .optional()
      .meta({ description: 'Kind of premises, when there was no survey.' }),
    supply: z.enum(SUPPLY_TYPES).meta({ description: 'Supply to connect.', example: 'single_phase' }),
    notes: z.string().trim().max(2000).optional().meta({ description: 'Anything the team should know.' })
  })
  .refine((v) => !!v.surveyRef || !!v.customer, {
    message: 'Give the survey reference or the customer',
    path: ['customer']
  });
export type ConnectionRequest = z.infer<typeof connectionRequestSchema>;

export const activationResultSchema = z.object({
  activated: z.boolean().meta({
    description: 'true: the service works and the connection closes; false: it goes back to the team.',
    example: true
  }),
  note: z.string().trim().max(1000).optional().meta({
    description: 'Why it could not be activated, for the team.',
    example: 'Meter not seen by the billing system.'
  })
});
export type ActivationResult = z.infer<typeof activationResultSchema>;

/** A survey typed in by the office, without the Sales system: nothing is sent back to Sales. */
export const officeSurveySchema = surveyRequestSchema.omit({ externalRef: true });
export type OfficeSurvey = z.infer<typeof officeSurveySchema>;

/**
 * A connection typed in by the office, without the Sales system. Once built, the Call Center checks it with the
 * customer and the office closes it (there is no Sales activation).
 */
export const officeConnectionSchema = z
  .object({
    contractNo: z.string().trim().min(1).max(32),
    /** The survey ticket this follows, if any: customer, place and material estimate are taken from it. */
    surveyTicketId: z.string().uuid().optional(),
    /** An existing customer (found with the lookup), when there was no survey. */
    customerId: z.string().uuid().optional(),
    /** A new customer, when there was no survey and they are not known yet. */
    customer: prospectSchema.optional(),
    premises: z.enum(PREMISES_TYPES).optional(),
    supply: z.enum(SUPPLY_TYPES),
    notes: z.string().trim().max(2000).optional()
  })
  .refine((v) => !!v.surveyTicketId || !!v.customerId || !!v.customer, {
    message: 'Give the survey, or the customer',
    path: ['customer']
  });
export type OfficeConnection = z.infer<typeof officeConnectionSchema>;

// ---- Stock (phase 4) ----

export const stockItemSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .meta({ description: 'Item code, the same as in the stock management system.', example: 'CAB-ABC-16' }),
  name: z
    .string()
    .trim()
    .min(2)
    .max(200)
    .meta({ description: 'Item name shown to the staff.', example: 'ABC cable 2x16 mm²' }),
  unit: z.enum(STOCK_UNITS).meta({ description: 'Unit of the quantities.', example: 'm' }),
  lowLevel: z
    .number()
    .min(0)
    .default(0)
    .meta({ description: 'Below this in the depots the item is shown as low.', example: 100 }),
  watchLevel: z
    .number()
    .min(0)
    .default(0)
    .meta({ description: 'Below this in the depots the item is shown as "watch".', example: 300 })
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
  externalRef: z.string().trim().min(1).max(100).meta({
    description: 'Your delivery reference; sending it again does nothing.',
    example: 'GR-2026-0457'
  }),
  depotCode: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .meta({ description: 'Code of the depot that received the goods.', example: 'DEP-MAT' }),
  lines: z
    .array(
      z.object({
        itemCode: z.string().trim().min(1).max(40).meta({ description: 'Item code.', example: 'CAB-ABC-16' }),
        quantity: z
          .number()
          .positive()
          .meta({ description: 'Quantity received, in the item unit.', example: 500 })
      })
    )
    .min(1)
    .max(500)
    .meta({ description: 'What arrived.' })
});
export type StockReceiptSync = z.infer<typeof stockReceiptSyncSchema>;

export const stockItemsSyncSchema = z.object({
  items: z
    .array(stockItemSchema)
    .min(1)
    .max(1000)
    .meta({ description: 'Items to add, or to update when the code exists.' })
});

export const consumptionQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).meta({
    description: 'Return what was used after this time; send the last time you received.',
    example: '2026-10-27T00:00:00+02:00'
  }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(500)
    .meta({ description: 'At most this many lines.', example: 500 })
});

// ---- Vehicles ----

export const vehicleSchema = z.object({
  plate: z.string().trim().min(3).max(20),
  label: z.string().trim().max(100).optional(),
  teamId: z.string().uuid()
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const assignVehicleSchema = z.object({ userId: z.string().uuid().nullable() });

// ---- Depots ----

/** A depot is where stock is received; each area has one, which also holds the reservations for its tickets. */
export const depotSchema = z.object({
  /** The depot's code in EDM's stock management system, which sends receipts by it (VAN- is kept for vans). */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, 'Use 2–40 letters, numbers, dashes or underscores')
    .refine((v) => !v.startsWith('VAN-'), 'Codes starting with VAN- are kept for vans'),
  name: z.string().trim().min(2).max(100),
  areaId: z.string().uuid()
});
export type DepotInput = z.infer<typeof depotSchema>;

/** Correcting a depot's name or code; it stays in its area, with its stock. */
export const updateDepotSchema = depotSchema.omit({ areaId: true }).partial();
export type UpdateDepot = z.infer<typeof updateDepotSchema>;

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

/**
 * Tickets typed in on the New ticket screen: a customer of EDM calling about their supply (like a Call Center
 * complaint), someone reporting the network, or anything else that comes up. Planned work, surveys and connections
 * have their own forms (/network/planned-work, /new-customers/surveys, /new-customers/connections).
 */
export const officeTicketSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('customer_complaint'),
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
    type: z.literal('network_incident'),
    reportType: z.enum(NETWORK_REPORT_TYPE_KEYS),
    address: z.string().trim().min(3).max(300),
    location: pointSchema.optional(),
    description: z.string().trim().min(3).max(2000),
    callerName: z.string().trim().max(200).optional(),
    callerPhone
  }),
  z.object({
    type: z.literal('other'),
    title: z.string().trim().min(3).max(200),
    description: z.string().trim().min(3).max(2000),
    priority: z.number().int().min(1).max(3),
    /** The customer it is about, if any; their place is used when no other place is given. */
    customerId: z.string().uuid().optional(),
    address: z.string().trim().min(3).max(300).optional(),
    location: pointSchema.optional(),
    callerPhone
  })
]);
export type OfficeTicket = z.infer<typeof officeTicketSchema>;

/** What would happen if the ticket were created now (the "What happens next" panel). */
export const ticketPreviewSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('customer_complaint'),
    customerId: z.string().uuid(),
    problemType: z.enum(PROBLEM_TYPE_KEYS),
    priority: z.number().int().min(1).max(3).optional()
  }),
  z.object({
    type: z.literal('network_incident'),
    reportType: z.enum(NETWORK_REPORT_TYPE_KEYS),
    location: pointSchema.optional()
  }),
  z.object({
    type: z.literal('other'),
    priority: z.number().int().min(1).max(3),
    customerId: z.string().uuid().optional(),
    location: pointSchema.optional()
  })
]);
export type TicketPreviewInput = z.infer<typeof ticketPreviewSchema>;

export const customerLookupSchema = z.object({ q: z.string().trim().min(3).max(64) });

/** A point marked on the map, to find its address. */
export const reverseGeocodeSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180)
});

/** Marks bell notifications as read: the ones given, or all of them. */
export const inboxReadSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });
export type InboxRead = z.infer<typeof inboxReadSchema>;

/** The region picker at the top of the web app: lists and summaries for one area only. */
export const areaFilterSchema = z.object({ areaId: z.string().uuid().optional() });
export type AreaFilter = z.infer<typeof areaFilterSchema>;

// ---- Signing in ----

export const signInSchema = z.object({
  username: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
  /** The web app keeps its renewal in a cookie; the phone app keeps it itself and gets it in the answer. */
  client: z.enum(['web', 'app']).default('web')
});
export type SignIn = z.infer<typeof signInSchema>;

/** The phone app sends its renewal token; the web app's is in the cookie. */
export const refreshSchema = z.object({ refreshToken: z.string().max(200).optional() });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200)
});
export type ChangePassword = z.infer<typeof changePasswordSchema>;

/** Admin area → Sign-in security. */
export const signInSettingsSchema = z.object({
  minPasswordLength: z.number().int().min(8).max(64),
  maxFailedSignIns: z.number().int().min(3).max(20),
  lockMinutes: z.number().int().min(1).max(1440),
  webSessionDays: z.number().int().min(1).max(90),
  appSessionDays: z.number().int().min(1).max(365)
});
export type SignInSettings = z.infer<typeof signInSettingsSchema>;

/** Admin area → API keys: a key for one of the other EDM systems. */
export const createApiKeySchema = z.object({
  system: z.enum(API_KEY_SYSTEMS),
  name: z.string().trim().min(2).max(100)
});
export type CreateApiKey = z.infer<typeof createApiKeySchema>;

// ---- Areas and teams (admin area) ----

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** A ring: at least a triangle, closed or not (it is closed on saving). */
const ring = z.array(lngLat).min(3).max(5000);

/** An area's boundary as GeoJSON (drawn on the map, or a file from EDM's mapping system). */
export const boundarySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1).max(50) }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(ring).min(1).max(50)).min(1).max(200)
  })
]);
export type Boundary = z.infer<typeof boundarySchema>;

export const createAreaSchema = z.object({
  name: z.string().trim().min(2).max(100),
  boundary: boundarySchema
});
export type CreateArea = z.infer<typeof createAreaSchema>;

export const updateAreaSchema = createAreaSchema.partial();
export type UpdateArea = z.infer<typeof updateAreaSchema>;

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  areaId: z.string().uuid()
});
export type CreateTeam = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema.partial();
export type UpdateTeam = z.infer<typeof updateTeamSchema>;
