import { Inject, Injectable } from '@nestjs/common';
import {
  allowedActions,
  mayCheck,
  OPEN_JOB_STATUSES,
  type IncidentSummary,
  type Lookups,
  type MapTicket,
  type NetworkInfo,
  type NewCustomerInfo,
  type SurveyResult,
  type PlannedWorkItem,
  type Overview,
  type ProblemType,
  type TicketCounts,
  type TicketDetail,
  type TicketListQuery,
  type TicketMessage,
  type TicketSummary,
  type TicketView
} from '../contract';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../auth/auth-user';
import { notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { ticketEvents } from '../db/partitioned';
import {
  alarms,
  areas,
  attachments,
  customers,
  handoverCodes,
  helpRequests,
  notificationOutbox,
  stockItems,
  teams,
  tickets,
  users,
  type NewCustomerDetails
} from '../db/schema';
import { StockService } from '../stock/stock.service';
import { StorageService } from '../storage/storage.service';

/** Roles that may see every ticket in the region. */
const SEE_ALL_ROLES = ['admin', 'technical_manager', 'noc', 'bo_support', 'network_team'] as const;

/** Days are counted in Mozambique time (UTC+2), wherever the server runs. */
const startOfToday = sql`(date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo')`;

const assignee = alias(users, 'assignee');
const actor = alias(users, 'actor');

const summaryColumns = {
  id: tickets.id,
  code: tickets.code,
  type: tickets.type,
  source: tickets.source,
  problemType: tickets.problemType,
  status: tickets.status,
  priority: tickets.priority,
  title: tickets.title,
  areaName: areas.name,
  teamId: tickets.teamId,
  teamName: teams.name,
  assigneeId: assignee.id,
  assigneeName: assignee.fullName,
  customerName: customers.fullName,
  address: customers.address,
  dueAt: tickets.dueAt,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt
};

type SummaryRow = {
  [K in keyof typeof summaryColumns]: unknown;
} & {
  id: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toSummary(r: SummaryRow): TicketSummary {
  return {
    id: r.id,
    code: r.code as string,
    type: r.type as TicketSummary['type'],
    source: r.source as TicketSummary['source'],
    problemType: (r.problemType as ProblemType | null) ?? null,
    status: r.status as TicketSummary['status'],
    priority: r.priority as number,
    title: r.title as string,
    areaName: (r.areaName as string | null) ?? null,
    teamId: (r.teamId as string | null) ?? null,
    teamName: (r.teamName as string | null) ?? null,
    assignee: r.assigneeId ? { id: r.assigneeId, fullName: r.assigneeName ?? '' } : null,
    customerName: (r.customerName as string | null) ?? null,
    address: (r.address as string | null) ?? null,
    dueAt: r.dueAt ? r.dueAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString()
  };
}

const ACTIVE = inArray(tickets.status, [
  'new',
  'assigned',
  'accepted',
  'in_progress',
  'on_hold',
  'resolved',
  'reopened'
]);
const NOT_FIXED = inArray(tickets.status, [
  'new',
  'assigned',
  'accepted',
  'in_progress',
  'on_hold',
  'reopened'
]);
/** Waiting for someone; tickets linked to a network incident are handled by the incident's crew. */
const UNASSIGNED = and(inArray(tickets.status, ['new', 'reopened']), isNull(tickets.incidentId))!;
const LATE_OR_NEARLY = and(
  NOT_FIXED,
  isNull(tickets.incidentId),
  sql`${tickets.dueAt} < now() + interval '30 minutes'`
)!;
const LATE = and(NOT_FIXED, isNull(tickets.incidentId), sql`${tickets.dueAt} < now()`)!;
const WAITING_CHECK = eq(tickets.status, 'resolved');
const CLOSED_TODAY = and(eq(tickets.status, 'closed'), sql`${tickets.closedAt} >= ${startOfToday}`)!;

const VIEW_FILTER: Record<TicketView, SQL | undefined> = {
  active: ACTIVE,
  unassigned: UNASSIGNED,
  late: LATE_OR_NEARLY,
  waiting_check: WAITING_CHECK,
  closed_today: CLOSED_TODAY,
  closed: inArray(tickets.status, ['closed', 'cancelled']),
  all: undefined
};

/** Read side of tickets: lists and detail, limited to what the caller may see. */
@Injectable()
export class TicketsQuery {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly stock: StockService
  ) {}

  /** Condition limiting tickets to the caller's scope; `null` means the caller sees nothing. */
  /**
   * Tickets for a list or summary: those the caller may see, in one area when the region picker at the top of the
   * web app is set. (Opening a ticket by its id ignores the picker.)
   */
  listScope(user: AuthUser, areaId?: string): SQL | undefined | null {
    const scope = this.scope(user);
    if (scope === null || !areaId) return scope;
    return and(scope, eq(tickets.areaId, areaId));
  }

  scope(user: AuthUser): SQL | undefined | null {
    if (user.roles.some((r) => (SEE_ALL_ROLES as readonly string[]).includes(r))) return undefined;
    if (user.roles.includes('team_manager')) return user.teamId ? eq(tickets.teamId, user.teamId) : null;
    if (user.roles.includes('field_staff')) return user.userId ? eq(tickets.assigneeId, user.userId) : null;
    return null;
  }

  private base() {
    return this.db
      .select(summaryColumns)
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(customers, eq(customers.id, tickets.customerId));
  }

  async list(user: AuthUser, q: TicketListQuery): Promise<{ items: TicketSummary[]; total: number }> {
    const scope = this.scope(user);
    if (scope === null) return { items: [], total: 0 };
    const search = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : undefined;
    const where = and(
      scope,
      VIEW_FILTER[q.view],
      q.status ? eq(tickets.status, q.status) : undefined,
      q.type ? eq(tickets.type, q.type) : undefined,
      q.source ? eq(tickets.source, q.source) : undefined,
      q.areaId ? eq(tickets.areaId, q.areaId) : undefined,
      q.teamId ? eq(tickets.teamId, q.teamId) : undefined,
      search
        ? or(
            ilike(tickets.code, search),
            ilike(tickets.externalRef, search),
            ilike(tickets.title, search),
            ilike(customers.fullName, search),
            ilike(customers.contractNo, search),
            ilike(customers.phone, search),
            ilike(customers.address, search)
          )
        : undefined
    );
    // Open work: most urgent first. Finished work: most recent first.
    const order =
      q.view === 'closed' || q.view === 'closed_today'
        ? [desc(tickets.closedAt)]
        : q.view === 'all'
          ? [desc(tickets.createdAt)]
          : [sql`${tickets.dueAt} asc nulls last`, asc(tickets.priority)];
    const [rows, [{ total }]] = await Promise.all([
      this.base()
        .where(where)
        .orderBy(...order)
        .limit(q.limit)
        .offset(q.offset),
      this.db
        .select({ total: count() })
        .from(tickets)
        .leftJoin(customers, eq(customers.id, tickets.customerId))
        .where(where)
    ]);
    return { items: rows.map((r) => toSummary(r as SummaryRow)), total };
  }

  /** How many tickets are in each tab, for the tab labels and the menu. */
  async counts(user: AuthUser, areaId?: string): Promise<TicketCounts> {
    const scope = this.listScope(user, areaId);
    if (scope === null)
      return { active: 0, unassigned: 0, late: 0, waiting_check: 0, closed_today: 0, incidents: 0, help: 0 };
    const filtered = (cond: SQL) => sql<number>`count(*) filter (where ${cond})::int`;
    const [row] = await this.db
      .select({
        active: filtered(ACTIVE),
        unassigned: filtered(UNASSIGNED),
        late: filtered(LATE_OR_NEARLY),
        waiting_check: filtered(WAITING_CHECK),
        closed_today: filtered(CLOSED_TODAY),
        incidents: filtered(and(eq(tickets.type, 'network_incident'), ACTIVE)!)
      })
      .from(tickets)
      .where(scope);
    // Help requests still open: everyone in the office sees all, team managers their team's.
    const seesAll = user.roles.some((r) => (SEE_ALL_ROLES as readonly string[]).includes(r));
    const [{ help }] = await this.db
      .select({ help: sql<number>`count(*)::int` })
      .from(helpRequests)
      .where(
        and(
          sql`${helpRequests.status} <> 'solved'`,
          seesAll ? undefined : user.teamId ? eq(helpRequests.teamId, user.teamId) : sql`false`
        )
      );
    return { ...row!, help };
  }

  async overview(user: AuthUser, areaId?: string): Promise<Overview> {
    const scope = this.listScope(user, areaId);
    const empty: Overview = {
      open: 0,
      newToday: 0,
      beingFixed: 0,
      staffOnDuty: 0,
      waitingCheck: 0,
      waitingCallCenter: 0,
      late: 0,
      attention: [],
      unassigned: [],
      map: []
    };
    if (scope === null) return empty;
    const filtered = (cond: SQL) => sql<number>`count(*) filter (where ${cond})::int`;
    const teamScope =
      user.roles.includes('team_manager') &&
      !user.roles.some((r) => (SEE_ALL_ROLES as readonly string[]).includes(r));

    const [[figures], [{ onDuty }], attention, unassigned, mapRows] = await Promise.all([
      this.db
        .select({
          open: filtered(ACTIVE),
          newToday: filtered(sql`${tickets.createdAt} >= ${startOfToday}`),
          beingFixed: filtered(inArray(tickets.status, ['in_progress', 'on_hold'])),
          waitingCheck: filtered(WAITING_CHECK),
          waitingCallCenter: filtered(and(WAITING_CHECK, eq(tickets.source, 'call_center'))!),
          late: filtered(LATE)
        })
        .from(tickets)
        .where(scope),
      this.db
        .select({ onDuty: count() })
        .from(users)
        .where(
          and(
            eq(users.onDuty, true),
            eq(users.status, 'active'),
            arrayContains(users.roles, ['field_staff']),
            teamScope && user.teamId ? eq(users.teamId, user.teamId) : undefined,
            areaId ? sql`${users.teamId} in (select id from teams where area_id = ${areaId})` : undefined
          )
        ),
      this.base()
        .where(and(scope, NOT_FIXED, isNull(tickets.incidentId)))
        .orderBy(sql`${tickets.dueAt} asc nulls last`, asc(tickets.priority))
        .limit(7),
      this.base()
        .where(and(scope, UNASSIGNED))
        .orderBy(sql`${tickets.dueAt} asc nulls last`)
        .limit(3),
      this.db
        .select({
          id: tickets.id,
          code: tickets.code,
          title: tickets.title,
          type: tickets.type,
          status: tickets.status,
          location: tickets.location,
          late: sql<boolean>`coalesce(${LATE}, false)`
        })
        .from(tickets)
        .where(and(scope, ACTIVE, isNotNull(tickets.location)))
        .limit(500)
    ]);

    return {
      ...figures,
      staffOnDuty: onDuty,
      attention: attention.map((r) => toSummary(r as SummaryRow)),
      unassigned: unassigned.map((r) => toSummary(r as SummaryRow)),
      map: mapRows.map((r): MapTicket => ({
        id: r.id,
        type: r.type,
        code: r.code,
        title: r.title,
        status: r.status,
        lat: r.location!.lat,
        lng: r.location!.lng,
        late: r.late
      }))
    };
  }

  async lookups(): Promise<Lookups> {
    const [areaRows, teamRows] = await Promise.all([
      this.db.select({ id: areas.id, name: areas.name }).from(areas).orderBy(asc(areas.name)),
      this.db
        .select({ id: teams.id, name: teams.name, areaId: teams.areaId, areaName: areas.name })
        .from(teams)
        .innerJoin(areas, eq(areas.id, teams.areaId))
        .orderBy(asc(teams.name))
    ]);
    return { areas: areaRows, teams: teamRows };
  }

  /** Network incidents for the Network incidents screen: open ones, or those finished in the last week. */
  async incidents(user: AuthUser, view: 'open' | 'recent', areaId?: string): Promise<IncidentSummary[]> {
    const scope = this.listScope(user, areaId);
    if (scope === null) return [];
    const finished = inArray(tickets.status, ['closed', 'cancelled']);
    const rows = await this.db
      .select({
        ...summaryColumns,
        severity: tickets.severity,
        elementCode: tickets.elementCode,
        customersAffected: tickets.customersAffected,
        acknowledgedAt: tickets.acknowledgedAt,
        alarmCount: sql<number>`(select count(*)::int from ${alarms} where ${alarms.ticketId} = ${tickets.id})`,
        activeAlarms: sql<number>`(select count(*)::int from ${alarms} where ${alarms.ticketId} = ${tickets.id} and ${alarms.clearedAt} is null)`,
        lastAlarmAt: sql<Date | null>`(select max(${alarms.raisedAt}) from ${alarms} where ${alarms.ticketId} = ${tickets.id})`,
        linkedTickets: sql<number>`(select count(*)::int from tickets l where l.incident_id = ${tickets.id})`
      })
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .where(
        and(
          scope,
          eq(tickets.type, 'network_incident'),
          view === 'open'
            ? sql`not ${finished}`
            : and(finished, sql`${tickets.updatedAt} > now() - interval '7 days'`)
        )
      )
      .orderBy(asc(tickets.priority), desc(tickets.createdAt))
      .limit(200);
    return rows.map((r) => ({
      ...toSummary(r as SummaryRow),
      severity: r.severity,
      elementCode: r.elementCode,
      alarmCount: r.alarmCount,
      activeAlarms: r.activeAlarms,
      customersAffected: r.customersAffected,
      linkedTickets: r.linkedTickets,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      lastAlarmAt: r.lastAlarmAt ? new Date(r.lastAlarmAt).toISOString() : null
    }));
  }

  /** Planned work starting between two dates (inclusive, Mozambique days), soonest first. */
  async plannedWork(user: AuthUser, from: string, to: string, areaId?: string): Promise<PlannedWorkItem[]> {
    const scope = this.listScope(user, areaId);
    if (scope === null) return [];
    const rows = await this.db
      .select({
        ...summaryColumns,
        kind: tickets.problemType,
        element: tickets.elementName,
        scheduledStart: tickets.scheduledStart,
        scheduledEnd: tickets.scheduledEnd,
        outage: tickets.outage,
        customersAffected: tickets.customersAffected
      })
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .where(
        and(
          scope,
          eq(tickets.type, 'planned_work'),
          ne(tickets.status, 'cancelled'),
          // Midnight in Maputo (without ::timestamp, a date is taken as midnight UTC).
          sql`${tickets.scheduledStart} >= (${from}::date::timestamp at time zone 'Africa/Maputo')`,
          sql`${tickets.scheduledStart} < ((${to}::date + 1)::timestamp at time zone 'Africa/Maputo')`
        )
      )
      .orderBy(asc(tickets.scheduledStart))
      .limit(500);
    return rows.map((r) => ({
      ...toSummary(r as SummaryRow),
      planned: {
        kind: (r.kind ?? 'maintenance') as 'maintenance' | 'network_change',
        element: r.element,
        scheduledStart: r.scheduledStart!.toISOString(),
        scheduledEnd: r.scheduledEnd!.toISOString(),
        outage: r.outage,
        customersAffected: r.customersAffected
      }
    }));
  }

  /** Upcoming planned power cuts, for the Call Center to answer callers. */
  async plannedOutages(): Promise<
    {
      code: string;
      title: string;
      element: string | null;
      areaName: string | null;
      scheduledStart: string;
      scheduledEnd: string;
      customersAffected: number | null;
    }[]
  > {
    const rows = await this.db
      .select({
        code: tickets.code,
        title: tickets.title,
        element: tickets.elementName,
        areaName: areas.name,
        scheduledStart: tickets.scheduledStart,
        scheduledEnd: tickets.scheduledEnd,
        customersAffected: tickets.customersAffected
      })
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .where(
        and(
          eq(tickets.type, 'planned_work'),
          eq(tickets.outage, true),
          notInArray(tickets.status, ['cancelled', 'closed']),
          sql`${tickets.scheduledEnd} >= now()`
        )
      )
      .orderBy(asc(tickets.scheduledStart));
    return rows.map((r) => ({
      ...r,
      scheduledStart: r.scheduledStart!.toISOString(),
      scheduledEnd: r.scheduledEnd!.toISOString()
    }));
  }

  /** SMS and push notifications sent about a ticket, with who they went to in words. */
  async messages(id: string, user: AuthUser): Promise<TicketMessage[]> {
    const scope = this.scope(user);
    if (scope === null) throw notFound('Ticket');
    const [ticket] = await this.db
      .select({ customerPhone: customers.phone })
      .from(tickets)
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .where(and(eq(tickets.id, id), scope));
    if (!ticket) throw notFound('Ticket');
    const [rows, people] = await Promise.all([
      this.db
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.ticketId, id))
        .orderBy(asc(notificationOutbox.createdAt)),
      this.db
        .select({ phone: users.phone, fullName: users.fullName, roles: users.roles })
        .from(users)
        .where(isNotNull(users.phone))
    ]);
    const label = (channel: string, recipient: string): string => {
      if (channel === 'push') return 'EDM Field app';
      if (recipient === ticket.customerPhone) return 'Customer';
      const person = people.find((p) => p.phone === recipient);
      if (!person) return recipient;
      const role = person.roles.includes('team_manager')
        ? 'team manager'
        : person.roles.includes('field_staff')
          ? 'field staff'
          : 'staff';
      return `${person.fullName} (${role})`;
    };
    return rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      to: label(r.channel, r.recipient),
      body: r.body,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null
    }));
  }

  /** Jobs the field staff member still has to do. */
  async myJobs(user: AuthUser): Promise<TicketSummary[]> {
    if (!user.userId) return [];
    const rows = await this.base()
      .where(and(eq(tickets.assigneeId, user.userId), inArray(tickets.status, [...OPEN_JOB_STATUSES])))
      .orderBy(asc(tickets.priority), asc(tickets.dueAt));
    return rows.map((r) => toSummary(r as SummaryRow));
  }

  async detail(id: string, user: AuthUser): Promise<TicketDetail> {
    const scope = this.scope(user);
    if (scope === null) throw notFound('Ticket');
    const [row] = await this.db
      .select({
        ...summaryColumns,
        description: tickets.description,
        externalRef: tickets.externalRef,
        location: tickets.location,
        customerId: customers.id,
        contractNo: customers.contractNo,
        meterNumber: customers.meterNumber,
        customerName: customers.fullName,
        customerPhone: customers.phone,
        customerAddress: customers.address,
        problemKind: tickets.problemType,
        elementCode: tickets.elementCode,
        elementName: tickets.elementName,
        severity: tickets.severity,
        customersAffected: tickets.customersAffected,
        incidentId: tickets.incidentId,
        acknowledgedAt: tickets.acknowledgedAt,
        acknowledgedBy: tickets.acknowledgedBy,
        scheduledStart: tickets.scheduledStart,
        scheduledEnd: tickets.scheduledEnd,
        outage: tickets.outage,
        escalationLevel: tickets.escalationLevel,
        details: tickets.details
      })
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .leftJoin(teams, eq(teams.id, tickets.teamId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .where(and(eq(tickets.id, id), scope));
    if (!row) throw notFound('Ticket');
    const [network, incident] = await Promise.all([
      row.type === 'network_incident' ? this.networkInfo(row) : Promise.resolve(null),
      row.incidentId
        ? this.db
            .select({ id: tickets.id, code: tickets.code, title: tickets.title, status: tickets.status })
            .from(tickets)
            .where(eq(tickets.id, row.incidentId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null)
    ]);

    const [events, files, stock, newCustomer] = await Promise.all([
      this.db
        .select({
          id: ticketEvents.id,
          type: ticketEvents.type,
          actorName: actor.fullName,
          actorLabel: ticketEvents.actorLabel,
          data: ticketEvents.data,
          createdAt: ticketEvents.createdAt
        })
        .from(ticketEvents)
        .leftJoin(actor, eq(actor.id, ticketEvents.actorUserId))
        .where(eq(ticketEvents.ticketId, id))
        .orderBy(asc(ticketEvents.createdAt)),
      this.db
        .select()
        .from(attachments)
        .where(eq(attachments.ticketId, id))
        .orderBy(asc(attachments.createdAt)),
      this.stock.ticketStock(id),
      row.type === 'new_customer_survey' || row.type === 'new_connection'
        ? this.newCustomerInfo(id, row.type, row.details, row.contractNo)
        : Promise.resolve(null)
    ]);

    const summary = toSummary(row as SummaryRow);
    let actions = allowedActions(
      summary.status,
      { userId: user.userId, roles: user.roles },
      summary.assignee?.id ?? null
    );
    if (!mayCheck(summary.type, user.roles)) actions = actions.filter((a) => a !== 'close' && a !== 'reopen');
    const isManagerOnly = user.roles.includes('team_manager') && !user.roles.includes('admin');
    if (isManagerOnly && summary.teamId !== user.teamId) {
      actions = actions.filter(
        (a) =>
          a !== 'assign' && a !== 'cancel' && (summary.type !== 'other' || (a !== 'close' && a !== 'reopen'))
      );
    }

    return {
      ...summary,
      description: row.description,
      externalRef: row.externalRef,
      location: row.location ? { lat: row.location.lat, lng: row.location.lng } : null,
      customer: row.customerId
        ? {
            id: row.customerId,
            contractNo: row.contractNo,
            meterNumber: row.meterNumber,
            fullName: row.customerName!,
            phone: row.customerPhone,
            address: row.customerAddress!
          }
        : null,
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actorName: e.actorName ?? e.actorLabel,
        data: e.data,
        createdAt: e.createdAt.toISOString()
      })),
      attachments: await Promise.all(
        files.map(async (f) => ({
          id: f.id,
          fileName: f.fileName,
          contentType: f.contentType,
          url: f.status === 'uploaded' ? await this.storage.presignDownload(f.objectKey) : null,
          createdAt: f.createdAt.toISOString()
        }))
      ),
      allowedActions: actions,
      network,
      planned:
        row.type === 'planned_work' && row.scheduledStart && row.scheduledEnd
          ? {
              kind: (row.problemKind ?? 'maintenance') as 'maintenance' | 'network_change',
              element: row.elementName ?? row.elementCode,
              scheduledStart: row.scheduledStart.toISOString(),
              scheduledEnd: row.scheduledEnd.toISOString(),
              outage: row.outage,
              customersAffected: row.customersAffected
            }
          : null,
      incident,
      escalationLevel: row.escalationLevel,
      materials: stock.materials,
      reservations: stock.reservations,
      newCustomer
    };
  }

  /** Survey and connection details for new customers, with item names for the material estimate. */
  private async newCustomerInfo(
    ticketId: string,
    type: 'new_customer_survey' | 'new_connection',
    details: NewCustomerDetails | null,
    contractNo: string | null
  ): Promise<NewCustomerInfo> {
    const d = details ?? {};
    const itemIds = d.survey?.estimatedMaterials.map((m) => m.itemId) ?? [];
    const [items, survey, code] = await Promise.all([
      itemIds.length
        ? this.db.select().from(stockItems).where(inArray(stockItems.id, itemIds))
        : Promise.resolve([]),
      d.surveyTicketId
        ? this.db
            .select({ id: tickets.id, code: tickets.code })
            .from(tickets)
            .where(eq(tickets.id, d.surveyTicketId))
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      this.db
        .select({ sentAt: handoverCodes.sentAt, usedAt: handoverCodes.usedAt })
        .from(handoverCodes)
        .where(eq(handoverCodes.ticketId, ticketId))
        .then((r) => r[0] ?? null)
    ]);
    return {
      kind: type === 'new_customer_survey' ? 'survey' : 'connection',
      premises: (d.premises ?? null) as NewCustomerInfo['premises'],
      supply: (d.supply ?? null) as NewCustomerInfo['supply'],
      requestedLoadKw: d.requestedLoadKw ?? null,
      contractNo: d.contractNo ?? contractNo,
      surveyTicket: survey,
      survey: d.survey
        ? {
            result: d.survey.result as SurveyResult,
            distanceToNetworkM: d.survey.distanceToNetworkM ?? null,
            nearestElement: d.survey.nearestElement ?? null,
            worksNeeded: d.survey.worksNeeded ?? null,
            estimatedMaterials: d.survey.estimatedMaterials.map((m) => {
              const item = items.find((i) => i.id === m.itemId);
              return {
                itemId: m.itemId,
                code: item?.code ?? '?',
                name: item?.name ?? 'Unknown item',
                unit: item?.unit ?? 'pcs',
                quantity: m.quantity
              };
            })
          }
        : null,
      installation: d.installation
        ? {
            meterNumber: d.installation.meterNumber,
            sealNumber: d.installation.sealNumber ?? null,
            confirmedBy: d.installation.confirmedBy,
            confirmedAt: d.installation.confirmedAt
          }
        : null,
      activatedAt: d.activatedAt ?? null,
      handoverCodeSentAt: code && !code.usedAt ? code.sentAt.toISOString() : null
    };
  }

  /** Alarms and linked customer tickets of a network incident. */
  private async networkInfo(row: {
    id: string;
    elementCode: string | null;
    elementName: string | null;
    severity: NetworkInfo['severity'];
    customersAffected: number | null;
    acknowledgedAt: Date | null;
    acknowledgedBy: string | null;
  }): Promise<NetworkInfo> {
    const [alarmRows, linked, ackBy] = await Promise.all([
      this.db.select().from(alarms).where(eq(alarms.ticketId, row.id)).orderBy(asc(alarms.raisedAt)),
      this.base().where(eq(tickets.incidentId, row.id)).orderBy(asc(tickets.createdAt)),
      row.acknowledgedBy
        ? this.db
            .select({ name: users.fullName })
            .from(users)
            .where(eq(users.id, row.acknowledgedBy))
            .then((r) => r[0]?.name ?? null)
        : Promise.resolve(null)
    ]);
    return {
      elementCode: row.elementCode,
      elementName: row.elementName,
      severity: row.severity,
      customersAffected: row.customersAffected,
      alarms: alarmRows.map((a) => ({
        id: a.id,
        alarmId: a.alarmId,
        elementCode: a.elementCode,
        elementName: a.elementName,
        alarmType: a.alarmType,
        severity: a.severity,
        raisedAt: a.raisedAt.toISOString(),
        clearedAt: a.clearedAt?.toISOString() ?? null
      })),
      activeAlarms: alarmRows.filter((a) => !a.clearedAt).length,
      linkedTickets: linked.map((r) => toSummary(r as SummaryRow)),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      acknowledgedBy: ackBy
    };
  }
}
