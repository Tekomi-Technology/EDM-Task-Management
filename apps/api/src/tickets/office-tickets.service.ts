import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  NETWORK_REPORT_TYPES,
  OUTAGE_PROBLEM_TYPES,
  PROBLEM_TYPES,
  type CreatedTicketView,
  type CustomerMatch,
  type OfficeTicket,
  type TicketPreview,
  type TicketPreviewInput
} from '../contract';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { areas, customers, teams, tickets, users } from '../db/schema';
import { sms } from '../notifications/messages';
import { normalizePhone } from '../notifications/phone';
import { TicketsService } from './tickets.service';

/** "Something else" has no set priority; the person taking the call picks one, and the time limit follows it. */
const SLA_BY_PRIORITY: Record<number, number> = { 1: 120, 2: 240, 3: 1440 };
/** Shown in the SMS preview where the ticket code will be. */
const CODE_PLACEHOLDER = 'TK-…';

/** The New ticket screen (W05): EDM staff who take a call themselves enter the ticket. */
@Injectable()
export class OfficeTicketsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tickets: TicketsService
  ) {}

  /** Customers by phone, contract or meter number, and by name. */
  async lookup(q: string): Promise<CustomerMatch[]> {
    const phone = normalizePhone(q);
    const rows = await this.db
      .select()
      .from(customers)
      .where(
        or(
          eq(customers.contractNo, q),
          phone ? eq(customers.phone, phone) : undefined,
          eq(customers.meterNumber, q.replace(/\s/g, '')),
          sql`${customers.fullName} ilike ${`%${q.replace(/[%_\\]/g, '\\$&')}%`}`
        )
      )
      .orderBy(customers.fullName)
      .limit(5);
    if (rows.length === 0) return [];

    const open = await this.db
      .select({
        customerId: tickets.customerId,
        id: tickets.id,
        code: tickets.code,
        title: tickets.title,
        status: tickets.status
      })
      .from(tickets)
      .where(
        and(
          inArray(
            tickets.customerId,
            rows.map((r) => r.id)
          ),
          notInArray(tickets.status, ['closed', 'cancelled'])
        )
      );
    return Promise.all(
      rows.map(async (c): Promise<CustomerMatch> => {
        const place = await this.place(c.location);
        return {
          id: c.id,
          fullName: c.fullName,
          contractNo: c.contractNo,
          meterNumber: c.meterNumber,
          phone: c.phone,
          address: c.address,
          location: c.location,
          areaName: place.areaName,
          teamName: place.teamName,
          openTickets: open
            .filter((t) => t.customerId === c.id)
            .map(({ id, code, title, status }) => ({ id, code, title, status }))
        };
      })
    );
  }

  async preview(input: TicketPreviewInput): Promise<TicketPreview> {
    const what = await this.what(input);
    const where = await this.tickets.whereTo(what.location, { outage: what.outage });
    const team = where.route?.teamId
      ? (
          await this.db
            .select({ id: teams.id, name: teams.name })
            .from(teams)
            .where(eq(teams.id, where.route.teamId))
        )[0]
      : undefined;
    const areaName = where.route
      ? ((await this.db.select({ name: areas.name }).from(areas).where(eq(areas.id, where.route.areaId)))[0]
          ?.name ?? null)
      : null;

    let incident: TicketPreview['incident'] = null;
    if (where.incident) {
      const [row] = await this.db
        .select({
          title: tickets.title,
          elementName: tickets.elementName,
          linked: sql<number>`(select count(*)::int from tickets l where l.incident_id = ${tickets.id})`
        })
        .from(tickets)
        .where(eq(tickets.id, where.incident.id));
      incident = {
        id: where.incident.id,
        code: where.incident.code,
        title: row!.title,
        elementName: row!.elementName,
        linkedCustomers: Number(row!.linked)
      };
    }
    // Who automatic assignment would pick, if the caller's problem is not part of the incident.
    let assignee: TicketPreview['assignee'] = null;
    const pick = where.assignee;
    if (pick) {
      const [row] = await this.db
        .select({
          openJobs: sql<number>`(select count(*)::int from tickets o where o.assignee_id = ${users.id}
            and o.status in ('assigned', 'accepted', 'in_progress', 'on_hold'))`
        })
        .from(users)
        .where(eq(users.id, pick.id));
      assignee = { ...pick, openJobs: Number(row?.openJobs ?? 0) };
    }
    return {
      team: team ?? null,
      areaName,
      assignee,
      priority: what.priority,
      slaMinutes: what.slaMinutes,
      dueAt: new Date(Date.now() + what.slaMinutes * 60_000).toISOString(),
      incident,
      sms: {
        newJob: sms.customerReceived(CODE_PLACEHOLDER),
        knownOutage: incident ? sms.customerKnownOutage(CODE_PLACEHOLDER) : null
      }
    };
  }

  async create(input: OfficeTicket, actor: AuthUser): Promise<CreatedTicketView> {
    const what = await this.what(input);
    const created =
      input.caller === 'customer'
        ? await this.tickets.create(
            {
              type: 'customer_complaint',
              source: 'office',
              externalRef: null,
              problemType: input.problemType,
              priority: what.priority,
              slaMinutes: what.slaMinutes,
              title: what.title,
              description: input.description,
              customerId: input.customerId,
              customerPhone: (input.callerPhone && normalizePhone(input.callerPhone)) || what.customerPhone,
              location: what.location,
              linkIncident: input.joinIncident
            },
            actor
          )
        : await this.tickets.create(
            {
              type: 'network_incident',
              source: 'office',
              externalRef: null,
              problemType: input.reportType,
              priority: what.priority,
              slaMinutes: what.slaMinutes,
              title: what.title,
              description: [
                input.description,
                `Place: ${input.address}`,
                input.callerName || input.callerPhone
                  ? `Reported by: ${[input.callerName, input.callerPhone].filter(Boolean).join(', ')}`
                  : null
              ]
                .filter(Boolean)
                .join('\n'),
              customerId: null,
              customerPhone: (input.callerPhone && normalizePhone(input.callerPhone)) || null,
              location: what.location,
              elementName: input.address
            },
            actor
          );
    const [row] = await this.db
      .select({ status: tickets.status, assigneeName: users.fullName })
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeId))
      .where(eq(tickets.id, created.id));
    const incident = created.incidentId
      ? (
          await this.db
            .select({ id: tickets.id, code: tickets.code })
            .from(tickets)
            .where(eq(tickets.id, created.incidentId))
        )[0]
      : undefined;
    return {
      id: created.id,
      code: created.code,
      status: row!.status,
      assigneeName: row!.assigneeName ?? null,
      incident: incident ?? null
    };
  }

  /** Priority, time limit, title and place of what the caller reports. */
  private async what(input: TicketPreviewInput | OfficeTicket) {
    if (input.caller === 'customer') {
      const [customer] = await this.db.select().from(customers).where(eq(customers.id, input.customerId));
      if (!customer) throw notFound('Customer');
      const problem = PROBLEM_TYPES[input.problemType];
      const chosen = input.problemType === 'other' ? input.priority : undefined;
      return {
        priority: chosen ?? problem.priority,
        slaMinutes: chosen ? SLA_BY_PRIORITY[chosen]! : problem.slaMinutes,
        title: problem.label,
        location: customer.location,
        customerPhone: customer.phone,
        outage: OUTAGE_PROBLEM_TYPES.includes(input.problemType)
      };
    }
    const kind = NETWORK_REPORT_TYPES[input.reportType];
    if (!kind)
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'UNKNOWN_REPORT_TYPE', 'Unknown report type');
    return {
      priority: kind.priority,
      slaMinutes: kind.slaMinutes,
      title: kind.label,
      location: input.location ?? null,
      customerPhone: null,
      outage: false
    };
  }

  /** Area and team covering a point, for showing them next to a customer found by the lookup. */
  private async place(location: { lat: number; lng: number } | null) {
    if (!location) return { areaName: null, teamName: null };
    const result = await this.db.execute<{ area: string; team: string | null }>(sql`
      select a.name as area,
        (select t.name from teams t where t.area_id = a.id order by t.code limit 1) as team
      from areas a
      where ST_Contains(a.boundary, ST_SetSRID(ST_MakePoint(${location.lng}, ${location.lat}), 4326))
      order by a.code limit 1`);
    const row = result.rows[0];
    return { areaName: row?.area ?? null, teamName: row?.team ?? null };
  }
}
