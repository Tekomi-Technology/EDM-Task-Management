import {
  ALARM_SEVERITIES,
  API_KEY_SYSTEMS,
  HELP_KINDS,
  HELP_STATUSES,
  INTEGRATION_SYSTEMS,
  MOVEMENT_KINDS,
  STOCK_UNITS,
  TICKET_SOURCES,
  TICKET_STATUSES,
  TICKET_TYPES,
  USER_STATUSES
} from '../contract';
import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';
import { multiPolygon, point } from './types';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const ticketStatus = pgEnum('ticket_status', TICKET_STATUSES);
export const ticketType = pgEnum('ticket_type', TICKET_TYPES);
export const ticketSource = pgEnum('ticket_source', TICKET_SOURCES);
export const notificationStatus = pgEnum('notification_status', ['pending', 'sent', 'failed']);
export const notificationChannel = pgEnum('notification_channel', ['sms', 'push', 'webhook']);
export const attachmentStatus = pgEnum('attachment_status', ['pending', 'uploaded']);
export const userStatus = pgEnum('user_status', USER_STATUSES);
export const alarmSeverity = pgEnum('alarm_severity', ALARM_SEVERITIES);
export const stockUnit = pgEnum('stock_unit', STOCK_UNITS);
export const movementKind = pgEnum('movement_kind', MOVEMENT_KINDS);
export const locationKind = pgEnum('stock_location_kind', ['depot', 'van']);
export const helpKind = pgEnum('help_kind', HELP_KINDS);
export const helpStatus = pgEnum('help_status', HELP_STATUSES);

export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  boundary: multiPolygon('boundary').notNull(),
  createdAt: createdAt()
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  areaId: uuid('area_id')
    .notNull()
    .references(() => areas.id),
  /** The team that gets the new tickets of its area; when none is marked, the first by code does. */
  receivesNew: boolean('receives_new').notNull().default(false),
  createdAt: createdAt()
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    teamId: uuid('team_id').references(() => teams.id),
    roles: text('roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Blocked and cancelled accounts cannot sign in; cancelled ones are kept for history. */
    status: userStatus('status').notNull().default('active'),
    /** argon2id; null until an administrator gives the person a password. */
    passwordHash: text('password_hash'),
    /** Set with a temporary password: the person chooses their own before doing anything else. */
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    /** Wrong passwords in a row; reaching the limit locks signing in until lockedUntil. */
    failedSignIns: integer('failed_sign_ins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    /** Field staff switch this on in the app when their shift starts; only staff on duty get jobs automatically. */
    onDuty: boolean('on_duty').notNull().default(false),
    lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
    /** Last time they used the system (updated at most hourly); null = has not signed in yet. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [index('users_team_idx').on(t.teamId)]
);

/** A signed-in browser or phone: its renewal token (stored hashed) keeps the person signed in until it expires. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    client: text('client', { enum: ['web', 'app'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [index('sessions_user_idx').on(t.userId)]
);

/** Keys the other EDM systems call the API with (stored hashed; the key is shown once when made). */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  system: text('system', { enum: API_KEY_SYSTEMS }).notNull(),
  name: text('name').notNull(),
  prefix: text('prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  createdBy: uuid('created_by').references(() => users.id),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt()
});

/** Settings administrators change in the web app (admin area), one JSON value per key. */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt()
});

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Empty for people asking for a new connection who have no contract yet. */
  contractNo: text('contract_no').unique(),
  /** The meter fitted at the customer's premises; set when a new connection is installed. */
  meterNumber: text('meter_number').unique(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  address: text('address').notNull(),
  location: point('location'),
  createdAt: createdAt()
});

/** One row per year; holds the last number used in ticket codes TK-YY-NNNNN. */
export const ticketCounters = pgTable('ticket_counters', {
  year: integer('year').primaryKey(),
  lastValue: integer('last_value').notNull()
});

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    type: ticketType('type').notNull(),
    source: ticketSource('source').notNull(),
    externalRef: text('external_ref'),
    problemType: text('problem_type'),
    status: ticketStatus('status').notNull().default('new'),
    priority: smallint('priority').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    location: point('location'),
    areaId: uuid('area_id').references(() => areas.id),
    teamId: uuid('team_id').references(() => teams.id),
    assigneeId: uuid('assignee_id').references(() => users.id),
    dueAt: timestamp('due_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** When staff last reported it fixed (the phone's time). Kept on the ticket so reports need not read the history. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** How many times a check found it not fixed. */
    reopenCount: smallint('reopen_count').notNull().default(0),
    /** Network incidents and planned work: the network element (feeder, transformer…) or place. */
    elementCode: text('element_code'),
    elementName: text('element_name'),
    /** Network incidents: highest severity among the grouped alarms. */
    severity: alarmSeverity('severity'),
    customersAffected: integer('customers_affected'),
    /** Customer tickets: the network incident causing the problem; they are closed together with it. */
    incidentId: uuid('incident_id').references((): AnyPgColumn => tickets.id),
    /** Network incidents: NOC confirmed it has seen the incident. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id),
    /** Planned work: the agreed window; the time limit is its end. */
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    outage: boolean('outage').notNull().default(false),
    /** How far the time-limit warnings have gone: 0 none, 1 staff reminded, 2 late, 3 badly late. */
    escalationLevel: smallint('escalation_level').notNull().default(0),
    /** When the waiting ticket was last offered to its team (null: not offered since it last had someone). */
    offeredAt: timestamp('offered_at', { withTimezone: true }),
    /** How many times it has been offered since then: 1 the first time, then one more per reminder. */
    offerRound: smallint('offer_round').notNull().default(0),
    /** New customers: premises, supply, the survey report and the installation (see NewCustomerDetails). */
    details: jsonb('details').$type<NewCustomerDetails>(),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index('tickets_type_status_idx').on(t.type, t.status),
    index('tickets_incident_idx').on(t.incidentId),
    index('tickets_element_idx').on(t.elementCode),
    uniqueIndex('tickets_source_external_ref_uq')
      .on(t.source, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index('tickets_status_idx').on(t.status),
    index('tickets_team_status_idx').on(t.teamId, t.status),
    index('tickets_assignee_status_idx').on(t.assigneeId, t.status),
    // Reports read tickets closed, or fixed, within a period.
    index('tickets_closed_at_idx').on(t.closedAt),
    index('tickets_resolved_at_idx').on(t.resolvedAt),
    index('tickets_created_at_idx').on(t.createdAt)
  ]
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    objectKey: text('object_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    status: attachmentStatus('status').notNull().default('pending'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt()
  },
  (t) => [index('attachments_ticket_idx').on(t.ticketId)]
);

/**
 * What office staff see under the bell in the web app: the same alerts they get by SMS (a ticket waiting to be
 * assigned, a new incident, a late ticket, a help request), in English, with a link to open it.
 */
export const userNotifications = pgTable(
  'user_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    link: text('link'),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true })
  },
  (t) => [index('user_notifications_user_idx').on(t.userId, t.createdAt)]
);

export const integrationSystem = pgEnum('integration_system', INTEGRATION_SYSTEMS);
export const integrationDirection = pgEnum('integration_direction', ['in', 'out']);

/**
 * Every request another system sent to /intake and every SMS, push or webhook sent out, for the Connected systems
 * screen. Kept INTEGRATION_LOG_DAYS days (RetentionService).
 */
export const integrationCalls = pgTable(
  'integration_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    system: integrationSystem('system').notNull(),
    direction: integrationDirection('direction').notNull(),
    /** "POST /intake/nms/alarms", "SMS", "Webhook connection_installed"… */
    operation: text('operation').notNull(),
    statusCode: integer('status_code'),
    ok: boolean('ok').notNull(),
    durationMs: integer('duration_ms').notNull(),
    error: text('error'),
    createdAt: createdAt()
  },
  (t) => [
    index('integration_calls_system_idx').on(t.system, t.createdAt),
    index('integration_calls_created_idx').on(t.createdAt)
  ]
);

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: notificationChannel('channel').notNull(),
    recipient: text('recipient').notNull(),
    body: text('body').notNull(),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    status: notificationStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Push only: title, data for the app, and the phone number to text instead if the push cannot be delivered. */
    payload: jsonb('payload').$type<PushPayload>(),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true })
  },
  (t) => [index('notification_outbox_status_idx').on(t.status, t.createdAt)]
);

export interface PushPayload {
  title: string;
  data: Record<string, string>;
  fallbackPhone: string | null;
}

/** Phones with the EDM Field app, registered after sign-in so jobs can be announced by push notification. */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Expo push token, e.g. ExponentPushToken[xxxx]. A phone moves to whoever signed in on it last. */
    token: text('token').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    platform: text('platform').notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index('push_devices_user_idx').on(t.userId)]
);

/** Alarms received from the network management system (NMS); grouped by cause into network incident tickets. */
export const alarms = pgTable(
  'alarms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The NMS's own alarm id. */
    alarmId: text('alarm_id').notNull().unique(),
    elementCode: text('element_code').notNull(),
    elementName: text('element_name'),
    elementType: text('element_type'),
    parentElementCode: text('parent_element_code'),
    correlationId: text('correlation_id'),
    alarmType: text('alarm_type').notNull(),
    severity: alarmSeverity('severity').notNull(),
    location: point('location'),
    customersAffected: integer('customers_affected'),
    details: text('details'),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    /** The incident it belongs to; null for warnings, which do not open incidents. */
    ticketId: uuid('ticket_id').references(() => tickets.id),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => [
    index('alarms_ticket_idx').on(t.ticketId),
    index('alarms_element_idx').on(t.elementCode),
    index('alarms_correlation_idx').on(t.correlationId)
  ]
);

export interface NewCustomerDetails {
  premises?: string;
  supply?: string;
  requestedLoadKw?: number;
  contractNo?: string;
  surveyTicketId?: string;
  survey?: {
    result: string;
    distanceToNetworkM?: number;
    nearestElement?: string;
    worksNeeded?: string;
    estimatedMaterials: { itemId: string; quantity: number }[];
  };
  installation?: {
    meterNumber: string;
    sealNumber?: string;
    confirmedBy: 'sms_code' | 'signed_form' | 'meter_photo';
    confirmedAt: string;
  };
  activatedAt?: string;
}

// ---- Stock: a ledger. Balances are the sum of movements in minus out; nothing is overwritten. ----

export const stockItems = pgTable('stock_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  unit: stockUnit('unit').notNull(),
  lowLevel: doublePrecision('low_level').notNull().default(0),
  watchLevel: doublePrecision('watch_level').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt()
});

/** A depot (one per area) or a van (each vehicle carries its own small stock). */
export const stockLocations = pgTable('stock_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: locationKind('kind').notNull(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  areaId: uuid('area_id').references(() => areas.id),
  teamId: uuid('team_id').references(() => teams.id),
  createdAt: createdAt()
});

export const vehicles = pgTable('vehicles', {
  id: uuid('id').primaryKey().defaultRandom(),
  plate: text('plate').notNull().unique(),
  label: text('label'),
  teamId: uuid('team_id')
    .notNull()
    .references(() => teams.id),
  /** The van's own stock. */
  locationId: uuid('location_id')
    .notNull()
    .unique()
    .references(() => stockLocations.id),
  /** Who drives it now; one van per person. */
  assignedUserId: uuid('assigned_user_id')
    .unique()
    .references(() => users.id),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt()
});

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: movementKind('kind').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id),
    quantity: doublePrecision('quantity').notNull(),
    /** Null when stock arrives from outside (receive) or a count goes up (adjust). */
    fromLocationId: uuid('from_location_id').references(() => stockLocations.id),
    /** Null when stock is used on a job (consume) or a count goes down (adjust). */
    toLocationId: uuid('to_location_id').references(() => stockLocations.id),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorLabel: text('actor_label'),
    /** Delivery note or document number; unique per source for receipts from EDM's stock system. */
    reference: text('reference'),
    note: text('note'),
    createdAt: createdAt()
  },
  (t) => [
    index('stock_movements_item_idx').on(t.itemId),
    index('stock_movements_from_idx').on(t.fromLocationId),
    index('stock_movements_to_idx').on(t.toLocationId),
    index('stock_movements_ticket_idx').on(t.ticketId),
    index('stock_movements_created_idx').on(t.createdAt)
  ]
);

/** Material set aside in a depot for a ticket (planned work, a connection); released when it closes. */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => stockLocations.id),
    quantity: doublePrecision('quantity').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: createdAt()
  },
  (t) => [index('stock_reservations_ticket_idx').on(t.ticketId)]
);

/** Material the staff member says was used on a job; becomes a "consume" movement when the ticket closes. */
export const ticketMaterials = pgTable(
  'ticket_materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id),
    quantity: doublePrecision('quantity').notNull(),
    fromLocationId: uuid('from_location_id').references(() => stockLocations.id),
    recordedBy: uuid('recorded_by').references(() => users.id),
    movementId: uuid('movement_id').references(() => stockMovements.id),
    createdAt: createdAt()
  },
  (t) => [index('ticket_materials_ticket_idx').on(t.ticketId)]
);

/** A one-time code sent to a new customer at handover; they read it to the staff member to confirm. */
export const handoverCodes = pgTable('handover_codes', {
  ticketId: uuid('ticket_id')
    .primaryKey()
    .references(() => tickets.id),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  usedAt: timestamp('used_at', { withTimezone: true })
});

// ---- Help requests from field staff to the back office (BO) ----

export const helpRequests = pgTable(
  'help_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: helpKind('kind').notNull(),
    message: text('message').notNull(),
    status: helpStatus('status').notNull().default('new'),
    ticketId: uuid('ticket_id').references(() => tickets.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    teamId: uuid('team_id').references(() => teams.id),
    handledBy: uuid('handled_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    solvedAt: timestamp('solved_at', { withTimezone: true })
  },
  (t) => [index('help_requests_status_idx').on(t.status, t.createdAt)]
);

export const helpMessages = pgTable(
  'help_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => helpRequests.id),
    authorUserId: uuid('author_user_id').references(() => users.id),
    fromField: boolean('from_field').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt()
  },
  (t) => [index('help_messages_request_idx').on(t.requestId)]
);
