import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  NEW_CUSTOMER_SLA_MINUTES,
  type ActivationResult,
  type ConnectionRequest,
  type NewCustomerCard,
  type NewCustomerStage,
  type OfficeConnection,
  type OfficeSurvey,
  type SurveyRequest,
  type WaitingSurvey
} from '../contract';
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { areas, customers, stockItems, teams, tickets, users } from '../db/schema';
import { StockService } from '../stock/stock.service';
import { TicketsQuery } from '../tickets/tickets.query';
import { sms } from '../notifications/messages';
import { assertMayChooseTeam, DuplicateExternalRef, TicketsService } from '../tickets/tickets.service';

export interface SalesRequestView {
  externalRef: string;
  kind: 'survey' | 'connection';
  ticketId: string;
  code: string;
  status: string;
  assigneeName: string | null;
  survey: unknown;
  installation: unknown;
  activatedAt: string | null;
  updatedAt: string;
}

const PREMISES_LABEL: Record<string, string> = {
  home: 'home',
  shop: 'shop',
  school: 'school',
  business: 'business',
  farm: 'farm',
  other: 'premises'
};

const assignee = alias(users, 'assignee');

/**
 * Requests from the Sales system: technical surveys before a sale, and connections after the contract is
 * signed. Results go back by webhook (see NotificationsService.recordWebhook) and can be read here at any time.
 */
@Injectable()
export class SalesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tickets: TicketsService,
    private readonly query: TicketsQuery,
    private readonly stock: StockService
  ) {}

  async receiveSurvey(
    input: SurveyRequest,
    actor: AuthUser
  ): Promise<SalesRequestView & { created: boolean }> {
    const existing = await this.find(input.externalRef);
    if (existing) return { ...existing, created: false };
    let created = true;
    try {
      await this.createSurvey(input, actor, input.externalRef);
    } catch (err) {
      if (!(err instanceof DuplicateExternalRef)) throw err;
      created = false;
    }
    return { ...(await this.find(input.externalRef))!, created };
  }

  /** A survey typed in by the office (New ticket screen), without the Sales system. */
  async officeSurvey(input: OfficeSurvey, actor: AuthUser): Promise<{ id: string; code: string }> {
    assertMayChooseTeam(input.teamId, actor);
    return this.createSurvey(input, actor, null);
  }

  /**
   * The contract is signed: build the connection. When it follows a survey, the customer, place and the material
   * estimate come from it, and the estimate is set aside in the depot where available.
   */
  async receiveConnection(
    input: ConnectionRequest,
    actor: AuthUser
  ): Promise<SalesRequestView & { created: boolean }> {
    const existing = await this.find(input.externalRef);
    if (existing) return { ...existing, created: false };

    const [survey] = input.surveyRef
      ? await this.db
          .select()
          .from(tickets)
          .where(
            and(
              eq(tickets.source, 'sales'),
              eq(tickets.externalRef, input.surveyRef),
              eq(tickets.type, 'new_customer_survey')
            )
          )
      : [];
    if (input.surveyRef && !survey) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'SURVEY_NOT_FOUND', `No survey ${input.surveyRef}`);
    }
    let created = true;
    try {
      await this.createConnection(input, survey, actor, input.externalRef);
    } catch (err) {
      if (!(err instanceof DuplicateExternalRef)) throw err;
      created = false;
    }
    return { ...(await this.find(input.externalRef))!, created };
  }

  /**
   * A connection typed in by the office, without the Sales system. Once built, the Call Center checks it with the
   * customer and the office closes it.
   */
  async officeConnection(input: OfficeConnection, actor: AuthUser): Promise<{ id: string; code: string }> {
    assertMayChooseTeam(input.teamId, actor);
    const [survey] = input.surveyTicketId
      ? await this.db
          .select()
          .from(tickets)
          .where(and(eq(tickets.id, input.surveyTicketId), eq(tickets.type, 'new_customer_survey')))
      : [];
    if (input.surveyTicketId && !survey) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'SURVEY_NOT_FOUND', 'No such survey');
    }
    if (input.customerId && !survey) {
      const [known] = await this.db
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.id, input.customerId));
      if (!known) throw notFound('Customer');
    }
    return this.createConnection(input, survey, actor, null);
  }

  private async createSurvey(
    input: OfficeSurvey,
    actor: AuthUser,
    externalRef: string | null
  ): Promise<{ id: string; code: string }> {
    const [customer] = await this.db
      .insert(customers)
      .values({
        fullName: input.customer.fullName,
        phone: input.customer.phone ?? null,
        address: input.customer.address,
        location: input.customer.location ?? null
      })
      .returning({ id: customers.id });
    return this.tickets.create(
      {
        type: 'new_customer_survey',
        source: externalRef ? 'sales' : 'office',
        externalRef,
        problemType: null,
        priority: 3,
        slaMinutes: NEW_CUSTOMER_SLA_MINUTES.survey,
        title: `Survey for new ${PREMISES_LABEL[input.premises]}`,
        description: input.notes ?? `Technical survey for a ${input.supply.replace('_', '-')} connection.`,
        customerId: customer!.id,
        customerPhone: input.customer.phone ?? null,
        receivedSms: sms.customerSurveyReceived,
        location: input.customer.location ?? null,
        details: { premises: input.premises, supply: input.supply, requestedLoadKw: input.requestedLoadKw },
        teamId: input.teamId,
        teamReason: input.teamId ? input.teamReason : undefined
      },
      actor
    );
  }

  private async createConnection(
    input: {
      contractNo: string;
      supply?: OfficeConnection['supply'];
      premises?: OfficeConnection['premises'];
      notes?: string;
      customerId?: string;
      customer?: OfficeConnection['customer'];
      teamId?: string;
      teamReason?: string;
    },
    survey: typeof tickets.$inferSelect | undefined,
    actor: AuthUser,
    externalRef: string | null
  ): Promise<{ id: string; code: string }> {
    if (survey?.details?.survey?.result === 'not_feasible') {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NOT_FEASIBLE',
        'The survey found this connection not feasible'
      );
    }

    // The supply of the contract, else the one surveyed.
    const supply = input.supply ?? survey?.details?.supply ?? 'single_phase';

    // The customer: the one surveyed (now with a contract), the one chosen, the one with this contract, or a new one.
    let customerId = survey?.customerId ?? input.customerId ?? null;
    const [byContract] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.contractNo, input.contractNo));
    if (byContract && customerId && byContract.id !== customerId) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'CONTRACT_TAKEN',
        `Contract ${input.contractNo} belongs to another customer`
      );
    }
    if (customerId) {
      await this.db
        .update(customers)
        .set({ contractNo: input.contractNo })
        .where(eq(customers.id, customerId));
    } else if (byContract) {
      customerId = byContract.id;
    } else {
      const c = input.customer!;
      [{ id: customerId }] = await this.db
        .insert(customers)
        .values({
          contractNo: input.contractNo,
          fullName: c.fullName,
          phone: c.phone ?? null,
          address: c.address,
          location: c.location ?? null
        })
        .returning({ id: customers.id });
    }
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, customerId!));

    const ticket = await this.tickets.create(
      {
        type: 'new_connection',
        source: externalRef ? 'sales' : 'office',
        externalRef,
        problemType: null,
        priority: 3,
        slaMinutes: NEW_CUSTOMER_SLA_MINUTES.connection,
        title: `New connection, contract ${input.contractNo}`,
        description: input.notes ?? `New ${supply.replace('_', '-')} connection for ${customer!.fullName}.`,
        customerId: customer!.id,
        customerPhone: customer!.phone,
        receivedSms: sms.customerConnectionReceived,
        location: customer!.location ?? survey?.location ?? null,
        teamId: input.teamId,
        teamReason: input.teamId ? input.teamReason : undefined,
        details: {
          premises: input.premises ?? survey?.details?.premises,
          supply,
          contractNo: input.contractNo,
          surveyTicketId: survey?.id
        }
      },
      actor
    );
    const estimate = survey?.details?.survey?.estimatedMaterials ?? [];
    if (estimate.length) {
      await this.db.transaction(async (tx) => {
        const [t] = await tx.select().from(tickets).where(eq(tickets.id, ticket.id));
        const missing = await this.stock.reserve(tx, t!, estimate, true);
        await this.tickets.event(tx, ticket.id, 'reserved', actor, { lines: estimate.length, missing });
      });
    }
    return ticket;
  }

  /**
   * Finished surveys a connection can follow (not found infeasible, no connection yet), newest first, with what the
   * connection would take from them: the customer, the result, who would go and whether the depot has the material.
   */
  async waitingSurveys(user: AuthUser): Promise<WaitingSurvey[]> {
    const scope = this.query.listScope(user);
    if (scope === null) return [];
    const followed = new Set(
      (
        await this.db
          .select({ surveyId: sql<string | null>`${tickets.details}->>'surveyTicketId'` })
          .from(tickets)
          .where(and(eq(tickets.type, 'new_connection'), notInArray(tickets.status, ['cancelled'])))
      ).map((r) => r.surveyId)
    );
    const rows = await this.db
      .select({
        id: tickets.id,
        code: tickets.code,
        details: tickets.details,
        location: tickets.location,
        closedAt: tickets.closedAt,
        customerName: customers.fullName,
        customerPhone: customers.phone,
        customerAddress: customers.address,
        surveyedBy: assignee.fullName
      })
      .from(tickets)
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .where(
        and(
          scope,
          eq(tickets.type, 'new_customer_survey'),
          eq(tickets.status, 'closed'),
          sql`coalesce(${tickets.details}->'survey'->>'result', '') <> 'not_feasible'`
        )
      )
      .orderBy(desc(tickets.closedAt))
      .limit(50);

    const out: WaitingSurvey[] = [];
    for (const r of rows.filter((x) => !followed.has(x.id))) {
      const d = r.details ?? {};
      const where = await this.tickets.whereTo(r.location, { outage: false });
      const teamId = where.route?.teamId ?? null;
      const [team] = teamId
        ? await this.db.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.id, teamId))
        : [];
      const estimate = d.survey?.estimatedMaterials ?? [];
      const items = estimate.length
        ? await this.db
            .select()
            .from(stockItems)
            .where(
              inArray(
                stockItems.id,
                estimate.map((l) => l.itemId)
              )
            )
        : [];
      const stock = await this.stock.freeInDepot(
        { areaId: where.route?.areaId ?? null, teamId },
        estimate.map((l) => l.itemId)
      );
      out.push({
        ticketId: r.id,
        code: r.code,
        customer: r.customerName
          ? { fullName: r.customerName, phone: r.customerPhone, address: r.customerAddress }
          : null,
        premises: (d.premises ?? null) as WaitingSurvey['premises'],
        supply: (d.supply ?? null) as WaitingSurvey['supply'],
        requestedLoadKw: d.requestedLoadKw ?? null,
        result: (d.survey?.result ?? 'feasible') as WaitingSurvey['result'],
        distanceToNetworkM: d.survey?.distanceToNetworkM ?? null,
        nearestElement: d.survey?.nearestElement ?? null,
        worksNeeded: d.survey?.worksNeeded ?? null,
        surveyedBy: r.surveyedBy,
        surveyedAt: r.closedAt?.toISOString() ?? null,
        team: team ?? null,
        teamStaff: where.teamStaff,
        depot: stock.depot,
        materials: estimate.map((l) => {
          const item = items.find((i) => i.id === l.itemId);
          return {
            itemId: l.itemId,
            code: item?.code ?? '',
            name: item?.name ?? '',
            unit: item?.unit ?? 'pcs',
            needed: l.quantity,
            free: stock.depot ? (stock.free.get(l.itemId) ?? 0) : null
          };
        })
      });
    }
    return out;
  }

  async status(externalRef: string): Promise<SalesRequestView> {
    const view = await this.find(externalRef);
    if (!view) throw notFound('Request');
    return view;
  }

  /** The Sales (commercial) system activated the service, or could not: closes or reopens the connection. */
  async activation(externalRef: string, input: ActivationResult, actor: AuthUser): Promise<SalesRequestView> {
    const view = await this.find(externalRef);
    if (!view || view.kind !== 'connection') throw notFound('Connection');
    await this.tickets.act(view.ticketId, input.activated ? 'close' : 'reopen', actor, { note: input.note });
    return (await this.find(externalRef))!;
  }

  private async find(externalRef: string): Promise<SalesRequestView | null> {
    const [row] = await this.db
      .select({
        ticketId: tickets.id,
        code: tickets.code,
        type: tickets.type,
        status: tickets.status,
        details: tickets.details,
        assigneeName: assignee.fullName,
        updatedAt: tickets.updatedAt
      })
      .from(tickets)
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .where(and(eq(tickets.source, 'sales'), eq(tickets.externalRef, externalRef)));
    if (!row) return null;
    return {
      externalRef,
      kind: row.type === 'new_customer_survey' ? 'survey' : 'connection',
      ticketId: row.ticketId,
      code: row.code,
      status: row.status,
      assigneeName: row.assigneeName,
      survey: row.details?.survey ?? null,
      installation: row.details?.installation ?? null,
      activatedAt: row.details?.activatedAt ?? null,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  /**
   * The New customers board: surveys and connections in five stages. A finished survey is shown until a
   * connection follows it; connections stay under "Connected" for 30 days after activation.
   */
  async board(user: AuthUser, areaId?: string): Promise<NewCustomerCard[]> {
    const scope = this.query.listScope(user, areaId);
    if (scope === null) return [];
    const rows = await this.db
      .select({
        id: tickets.id,
        code: tickets.code,
        type: tickets.type,
        status: tickets.status,
        title: tickets.title,
        teamId: tickets.teamId,
        areaName: areas.name,
        customerName: customers.fullName,
        contractNo: customers.contractNo,
        details: tickets.details,
        assigneeId: assignee.id,
        assigneeName: assignee.fullName,
        dueAt: tickets.dueAt,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt
      })
      .from(tickets)
      .leftJoin(areas, eq(areas.id, tickets.areaId))
      .leftJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .where(
        and(
          scope,
          inArray(tickets.type, ['new_customer_survey', 'new_connection']),
          notInArray(tickets.status, ['cancelled']),
          or(notInArray(tickets.status, ['closed']), sql`${tickets.closedAt} > now() - interval '30 days'`)
        )
      )
      .orderBy(desc(tickets.updatedAt))
      .limit(500);
    const followed = new Set(rows.map((r) => r.details?.surveyTicketId).filter(Boolean));

    const cards: NewCustomerCard[] = [];
    for (const r of rows) {
      const base = {
        ticketId: r.id,
        code: r.code,
        place: r.areaName,
        premises: (r.details?.premises ?? null) as NewCustomerCard['premises'],
        supply: (r.details?.supply ?? null) as NewCustomerCard['supply'],
        assignee: r.assigneeId ? { id: r.assigneeId, fullName: r.assigneeName! } : null
      };
      if (r.type === 'new_customer_survey') {
        if (followed.has(r.id)) continue;
        const done = r.status === 'closed';
        const result = r.details?.survey?.result;
        cards.push({
          ...base,
          stage: done ? 'survey_done' : 'survey_requested',
          title: r.customerName ?? r.title,
          badge: done
            ? result === 'feasible'
              ? 'Feasible'
              : result === 'feasible_with_works'
                ? 'Works needed'
                : 'Not feasible'
            : r.assigneeId
              ? null
              : 'Not assigned',
          badgeTone: done
            ? result === 'feasible'
              ? 'good'
              : result === 'not_feasible'
                ? 'bad'
                : 'warn'
            : r.assigneeId
              ? null
              : 'warn',
          date: (done ? r.updatedAt : (r.dueAt ?? r.createdAt)).toISOString()
        });
        continue;
      }
      const stage: NewCustomerStage = ['in_progress', 'on_hold'].includes(r.status)
        ? 'being_connected'
        : ['resolved', 'closed'].includes(r.status)
          ? 'connected'
          : 'contract_signed';
      cards.push({
        ...base,
        stage,
        title: `Contract ${r.details?.contractNo ?? r.contractNo ?? ''}`.trim(),
        badge:
          stage === 'connected'
            ? r.status === 'closed'
              ? 'Active'
              : 'Waiting for activation'
            : stage === 'contract_signed' && !r.teamId
              ? 'Needs a team'
              : stage === 'contract_signed' && !r.assigneeId
                ? 'Not assigned'
                : null,
        badgeTone:
          stage === 'connected' ? (r.status === 'closed' ? 'good' : 'warn') : r.assigneeId ? null : 'warn',
        date: r.updatedAt.toISOString()
      });
    }
    return cards;
  }
}
