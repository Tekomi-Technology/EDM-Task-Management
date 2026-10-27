import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  NETWORK_REPORT_TYPES,
  PROBLEM_TYPES,
  type CallCenterCheckResult,
  type CallCenterComplaint,
  type NetworkReport,
  type Reason,
  type TicketStatus
} from '../contract';
import { and, desc, eq } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { ticketEvents } from '../db/partitioned';
import { customers, tickets, users } from '../db/schema';
import { DuplicateExternalRef, TicketsService } from '../tickets/tickets.service';

export interface IntakeTicketView {
  externalRef: string;
  ticketId: string;
  code: string;
  status: TicketStatus;
  assigneeName: string | null;
  /** What the field staff wrote when reporting the job done; the Call Center reads it before calling back. */
  resolutionNote: string | null;
  updatedAt: string;
}

/** Handles requests from the Call Center system (an external system, integrated only through this API). */
@Injectable()
export class CallCenterService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tickets: TicketsService
  ) {}

  /** Creates a ticket for a customer complaint. Sending the same externalRef again returns the existing ticket. */
  async receiveComplaint(
    input: CallCenterComplaint,
    actor: AuthUser
  ): Promise<IntakeTicketView & { created: boolean }> {
    const existing = await this.findByRef(input.externalRef);
    if (existing) return { ...existing, created: false };

    const [customer] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.contractNo, input.contractNo));
    if (!customer) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CUSTOMER_NOT_FOUND',
        `No customer with contract ${input.contractNo}`
      );
    }
    const problem = PROBLEM_TYPES[input.problemType];
    let created = true;
    try {
      await this.tickets.create(
        {
          type: 'customer_complaint',
          source: 'call_center',
          externalRef: input.externalRef,
          problemType: input.problemType,
          priority: problem.priority,
          slaMinutes: problem.slaMinutes,
          title: problem.label,
          description: input.description,
          customerId: customer.id,
          customerPhone: input.callerPhone ?? customer.phone,
          location: customer.location
        },
        actor
      );
    } catch (err) {
      if (!(err instanceof DuplicateExternalRef)) throw err;
      // Another request with the same reference won the race; return that ticket.
      created = false;
    }
    const view = await this.findByRef(input.externalRef);
    return { ...view!, created };
  }

  async status(externalRef: string): Promise<IntakeTicketView> {
    const view = await this.findByRef(externalRef);
    if (!view) throw notFound('Ticket');
    return view;
  }

  /** Result of the Call Center calling the customer back: fixed closes the ticket, not fixed reopens it. */
  async checkResult(
    externalRef: string,
    input: CallCenterCheckResult,
    actor: AuthUser
  ): Promise<IntakeTicketView> {
    const view = await this.findByRef(externalRef);
    if (!view) throw notFound('Ticket');
    await this.tickets.act(view.ticketId, input.result === 'fixed' ? 'close' : 'reopen', actor, {
      note: input.note
    });
    return (await this.findByRef(externalRef))!;
  }

  /**
   * A member of the public reports a problem with the network (800 145 145). It becomes a network ticket for the
   * team covering the place; NOC checks and closes it.
   */
  async receiveNetworkReport(
    input: NetworkReport,
    actor: AuthUser
  ): Promise<IntakeTicketView & { created: boolean }> {
    const existing = await this.findByRef(input.externalRef);
    if (existing) return { ...existing, created: false };
    const kind = NETWORK_REPORT_TYPES[input.reportType];
    let created = true;
    try {
      await this.tickets.create(
        {
          type: 'network_incident',
          source: 'call_center',
          externalRef: input.externalRef,
          problemType: input.reportType,
          priority: kind.priority,
          slaMinutes: kind.slaMinutes,
          title: kind.label,
          description: `${input.description}\nPlace: ${input.address}`,
          customerId: null,
          customerPhone: input.callerPhone ?? null,
          location: input.location ?? null,
          elementName: input.address
        },
        actor
      );
    } catch (err) {
      if (!(err instanceof DuplicateExternalRef)) throw err;
      created = false;
    }
    return { ...(await this.findByRef(input.externalRef))!, created };
  }

  /** The customer withdrew the request, or it was a duplicate. */
  async cancel(externalRef: string, input: Reason, actor: AuthUser): Promise<IntakeTicketView> {
    const view = await this.findByRef(externalRef);
    if (!view) throw notFound('Ticket');
    await this.tickets.act(view.ticketId, 'cancel', actor, { reason: input.reason });
    return (await this.findByRef(externalRef))!;
  }

  private async findByRef(externalRef: string): Promise<IntakeTicketView | null> {
    const [row] = await this.db
      .select({
        ticketId: tickets.id,
        code: tickets.code,
        status: tickets.status,
        assigneeName: users.fullName,
        updatedAt: tickets.updatedAt
      })
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeId))
      .where(and(eq(tickets.source, 'call_center'), eq(tickets.externalRef, externalRef)));
    if (!row) return null;
    const [resolved] = await this.db
      .select({ data: ticketEvents.data })
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, row.ticketId), eq(ticketEvents.type, 'resolve')))
      .orderBy(desc(ticketEvents.createdAt))
      .limit(1);
    return {
      externalRef,
      ticketId: row.ticketId,
      code: row.code,
      status: row.status,
      assigneeName: row.assigneeName,
      resolutionNote: (resolved?.data.note as string | undefined) ?? null,
      updatedAt: row.updatedAt.toISOString()
    };
  }
}
