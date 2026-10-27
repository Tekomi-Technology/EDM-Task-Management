import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  nextStatus,
  OPEN_JOB_STATUSES,
  OUTAGE_PROBLEM_TYPES,
  REASON_REQUIRED_ACTIONS,
  type InstallationReport,
  type MaterialLine,
  type SurveyReport,
  type TicketAction,
  type TicketSource,
  type TicketStatus,
  type TicketType
} from '../contract';
import { and, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { actorLabel, SYSTEM_ACTOR, type AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { DB, type Db, type Tx } from '../db/db.module';
import { ticketEvents } from '../db/partitioned';
import {
  attachments,
  customers,
  handoverCodes,
  stockItems,
  ticketCounters,
  tickets,
  type NewCustomerDetails
} from '../db/schema';
import { inbox, push, sms, toOffice } from '../notifications/messages';
import { NotificationsService, type OutgoingSms } from '../notifications/notifications.service';
import { StockService } from '../stock/stock.service';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';

export interface NewTicket {
  type: TicketType;
  source: TicketSource;
  externalRef: string | null;
  problemType: string | null;
  priority: number;
  slaMinutes: number;
  title: string;
  description: string;
  customerId: string | null;
  customerPhone: string | null;
  location: { lng: number; lat: number } | null;
  /** Put the ticket in this team instead of routing it by location (planned work). */
  teamId?: string;
  /** Planned work is assigned by the team manager, not automatically. Default true. */
  autoAssign?: boolean;
  elementCode?: string | null;
  elementName?: string | null;
  severity?: 'critical' | 'major' | 'minor' | null;
  customersAffected?: number | null;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  outage?: boolean;
  /** New customers: premises, supply, survey link. */
  details?: NewCustomerDetails | null;
  /** False when the person taking the call says it is not the open incident nearby (default true). */
  linkIncident?: boolean;
  /** SMS telling the customer the request was received (default: the complaint text). */
  receivedSms?: (code: string) => string;
}

export interface ActionInput {
  assigneeId?: string;
  note?: string;
  /** Required for decline, hold and cancel. */
  reason?: string;
  /** When the app did this while offline; kept in the history next to when it reached the server. */
  occurredAt?: Date;
  attachmentIds?: string[];
  /** Materials used (resolve). */
  materials?: MaterialLine[];
  /** Survey report (resolve of a new customer survey). */
  survey?: SurveyReport;
  /** Installation and the customer's confirmation (resolve of a new connection). */
  installation?: InstallationReport;
}

export interface CreatedTicket {
  id: string;
  code: string;
  status: TicketStatus;
  incidentId: string | null;
}

const hashCode = (ticketId: string, code: string) =>
  createHash('sha256').update(`${ticketId}:${code}`).digest('hex');

/** Thrown inside the create transaction when the same external reference was already received. */
export class DuplicateExternalRef extends Error {}

/** Write side of tickets: creating tickets and moving them through the state machine. */
@Injectable()
export class TicketsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
    private readonly stock: StockService
  ) {}

  /**
   * Creates a ticket, routes it to the area and team covering its location (or the given team), and notifies the
   * customer. A no-power complaint near an open network incident is linked to it instead of sending someone.
   */
  async create(input: NewTicket, actor: AuthUser): Promise<CreatedTicket> {
    const { ticket, outboxIds } = await this.db.transaction((tx) => this.createInTx(tx, input, actor));
    await this.notifications.dispatch(outboxIds);
    return ticket;
  }

  /**
   * Same as create(), inside the caller's transaction (alarm grouping needs the lookup and the creation to be one
   * step). The caller dispatches the returned outbox ids after commit.
   */
  async createInTx(
    tx: Tx,
    input: NewTicket,
    actor: AuthUser
  ): Promise<{ ticket: CreatedTicket; outboxIds: string[] }> {
    const outboxIds: string[] = [];
    {
      const code = await this.nextCode(tx);
      const route = input.teamId
        ? await this.teamRoute(tx, input.teamId)
        : input.location
          ? await this.route(tx, input.location)
          : null;
      const incident =
        input.type === 'customer_complaint' &&
        input.linkIncident !== false &&
        input.location &&
        OUTAGE_PROBLEM_TYPES.includes(input.problemType ?? '')
          ? await this.nearbyIncident(tx, input.location)
          : null;
      const [ticket] = await tx
        .insert(tickets)
        .values({
          code,
          type: input.type,
          source: input.source,
          externalRef: input.externalRef,
          problemType: input.problemType,
          priority: input.priority,
          title: input.title,
          description: input.description,
          customerId: input.customerId,
          location: input.location,
          areaId: route?.areaId ?? null,
          teamId: route?.teamId ?? null,
          dueAt: input.scheduledEnd ?? new Date(Date.now() + input.slaMinutes * 60_000),
          elementCode: input.elementCode ?? null,
          elementName: input.elementName ?? null,
          severity: input.severity ?? null,
          customersAffected: input.customersAffected ?? null,
          scheduledStart: input.scheduledStart ?? null,
          scheduledEnd: input.scheduledEnd ?? null,
          outage: input.outage ?? false,
          incidentId: incident?.id ?? null,
          details: input.details ?? null
        })
        .onConflictDoNothing()
        .returning({ id: tickets.id, code: tickets.code, status: tickets.status });
      if (!ticket) throw new DuplicateExternalRef();

      await this.addEvent(tx, ticket.id, 'created', actor, {
        source: input.source,
        externalRef: input.externalRef,
        teamId: route?.teamId ?? null,
        routed: !!route?.teamId
      });
      const messages: OutgoingSms[] = [];
      let status: TicketStatus = ticket.status;

      if (incident) {
        // The crew on the incident fixes this too: nobody else is sent, and the customer is told it is known.
        await this.addEvent(tx, ticket.id, 'linked', SYSTEM_ACTOR, {
          incidentId: incident.id,
          incidentCode: incident.code,
          auto: true
        });
        messages.push({
          recipient: input.customerPhone,
          body: sms.customerKnownOutage(code),
          ticketId: ticket.id
        });
      } else {
        messages.push({
          recipient: input.customerPhone,
          body: (input.receivedSms ?? sms.customerReceived)(code),
          ticketId: ticket.id
        });
        if (route?.teamId) {
          const auto =
            input.autoAssign === false
              ? null
              : await this.autoAssign(
                  tx,
                  { id: ticket.id, code, title: input.title, location: input.location },
                  route.teamId,
                  'new',
                  messages
                );
          if (auto) status = auto;
          else {
            messages.push(
              ...toOffice(
                await this.users.teamManagers(route.teamId, tx),
                sms.managerNewTicket(code, input.title),
                inbox.newTicket(code, input.title),
                ticket.id
              )
            );
          }
        }
      }
      if (input.type === 'network_incident') {
        messages.push(
          ...toOffice(
            await this.users.withRole('noc', tx),
            sms.nocNewIncident(code, input.title),
            inbox.newIncident(code, input.title),
            ticket.id
          )
        );
      }
      outboxIds.push(...(await this.notifications.record(tx, messages)));
      return { ticket: { ...ticket, status, incidentId: incident?.id ?? null }, outboxIds };
    }
  }

  /**
   * Where a ticket at this point would go now, without creating it: area and team, an open incident nearby
   * (for outages), and who automatic assignment would pick if the ticket is not joined to that incident. For the
   * New ticket screen.
   */
  async whereTo(
    location: { lng: number; lat: number } | null,
    opts: { outage: boolean }
  ): Promise<{
    route: { areaId: string; teamId: string | null } | null;
    incident: { id: string; code: string } | null;
    assignee: { id: string; fullName: string; distanceM: number | null } | null;
  }> {
    return this.db.transaction(async (tx) => {
      const route = location ? await this.route(tx, location) : null;
      const incident = opts.outage && location ? await this.nearbyIncident(tx, location) : null;
      const staff =
        route?.teamId && this.env.AUTO_ASSIGN
          ? await this.users.pickAutoAssignee(tx, route.teamId, [], location)
          : undefined;
      return {
        route,
        incident,
        assignee: staff ? { id: staff.id, fullName: staff.fullName, distanceM: staff.distanceM } : null
      };
    });
  }

  /** Records messages in the caller's transaction (used by the NMS intake for alarm updates). */
  recordMessages(tx: Tx, messages: OutgoingSms[]): Promise<string[]> {
    return this.notifications.record(tx, messages);
  }

  dispatch(outboxIds: string[]): Promise<void> {
    return this.notifications.dispatch(outboxIds);
  }

  /** Adds a history entry from outside the state machine (alarm raised/cleared on an incident). */
  event(
    tx: Tx,
    ticketId: string,
    type: string,
    actor: AuthUser,
    data: Record<string, unknown>
  ): Promise<void> {
    return this.addEvent(tx, ticketId, type, actor, data);
  }

  /** Applies one state-machine action. The row is locked so concurrent requests cannot both succeed. */
  async act(
    ticketId: string,
    action: TicketAction,
    actor: AuthUser,
    input: ActionInput = {}
  ): Promise<TicketStatus> {
    if (REASON_REQUIRED_ACTIONS.includes(action) && !input.reason?.trim()) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'REASON_REQUIRED',
        `Please give a reason to ${action}`
      );
    }
    // Checked in its own transaction first, so a wrong code still counts towards the attempt limit.
    if (action === 'resolve' && input.installation?.handoverCode) {
      await this.checkHandoverCode(ticketId, input.installation.handoverCode);
    }
    const outboxIds: string[] = [];
    let closeSurveyAfter = false;
    const status = await this.db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
      if (!ticket) throw notFound('Ticket');

      // The Sales system only closes or reopens the connections it asked for (activated, or not).
      if (
        (action === 'close' || action === 'reopen') &&
        actor.roles.includes('integration_sales') &&
        ticket.type !== 'new_connection'
      ) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'FORBIDDEN_ROLE',
          'The Sales system only activates new connections'
        );
      }

      // A team manager may only assign or cancel their own team's tickets.
      const isManagerOnly = actor.roles.includes('team_manager') && !actor.roles.includes('admin');
      if (
        (action === 'assign' || (action === 'cancel' && !this.canCancelAnyTeam(actor))) &&
        isManagerOnly &&
        (!ticket.teamId || ticket.teamId !== actor.teamId)
      ) {
        throw new AppError(HttpStatus.FORBIDDEN, 'NOT_IN_TEAM', 'This ticket belongs to another team');
      }

      // Network work is checked by NOC (the network management team), not by the Call Center.
      if (
        (action === 'close' || action === 'reopen') &&
        actor.roles.includes('integration_call_center') &&
        (ticket.type === 'network_incident' || ticket.type === 'planned_work')
      ) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'NOC_CHECKS_NETWORK',
          'NOC checks and closes network tickets'
        );
      }

      let to = nextStatus(
        ticket.status,
        action,
        { userId: actor.userId, roles: actor.roles },
        ticket.assigneeId
      );
      const changes: Partial<typeof tickets.$inferInsert> = { status: to, updatedAt: new Date() };
      const data: Record<string, unknown> = { from: ticket.status, to };
      if (input.note) data.note = input.note;
      if (input.reason) data.reason = input.reason.trim();
      if (input.occurredAt) data.occurredAt = input.occurredAt.toISOString();
      const messages: OutgoingSms[] = [];
      let autoAssignAfter = false;
      let unlinkAfter = false;
      let consumeAfter = false;

      switch (action) {
        case 'assign': {
          const staff = await this.users.findById(input.assigneeId ?? '', tx);
          this.users.assertTeamMember(staff, ticket.teamId);
          changes.assigneeId = staff.id;
          Object.assign(data, { assigneeId: staff.id, assigneeName: staff.fullName });
          await this.users.markAssigned(tx, staff.id);
          messages.push({
            recipient: staff.phone,
            body: sms.staffAssigned(ticket.code, ticket.title),
            ticketId,
            staff: { userId: staff.id, title: push.newJob }
          });
          if (ticket.assigneeId && ticket.assigneeId !== staff.id) {
            const previous = await this.users.findById(ticket.assigneeId, tx);
            messages.push({
              recipient: previous?.phone ?? null,
              body: sms.staffUnassigned(ticket.code),
              ticketId,
              staff: { userId: ticket.assigneeId, title: push.jobMoved }
            });
          }
          break;
        }
        case 'decline':
          changes.assigneeId = null;
          autoAssignAfter = true;
          break;
        case 'start':
          messages.push({
            recipient: await this.customerPhone(tx, ticket.customerId),
            body: sms.customerWorking(ticket.code),
            ticketId
          });
          break;
        case 'resolve': {
          changes.resolvedAt = input.occurredAt ?? new Date();
          data.attachmentIds = await this.confirmUploads(tx, ticketId, input.attachmentIds ?? []);
          await this.stock.recordMaterials(tx, ticket, actor.userId!, input.materials ?? []);
          if (input.materials?.length) data.materials = input.materials;
          if (ticket.type === 'new_customer_survey') {
            if (!input.survey) {
              throw new AppError(
                HttpStatus.UNPROCESSABLE_ENTITY,
                'SURVEY_REPORT_REQUIRED',
                'Fill in the survey report'
              );
            }
            changes.details = { ...ticket.details, survey: { ...input.survey } };
            data.survey = input.survey.result;
            // Nobody checks a survey with the customer: the report goes to Sales and the ticket closes.
            closeSurveyAfter = true;
          }
          if (ticket.type === 'new_connection') {
            const inst = input.installation;
            if (!inst) {
              throw new AppError(
                HttpStatus.UNPROCESSABLE_ENTITY,
                'INSTALLATION_REQUIRED',
                'Give the meter number and the customer’s confirmation'
              );
            }
            if (
              !inst.handoverCode &&
              !(input.attachmentIds ?? []).includes(inst.signedFormAttachmentId ?? '')
            ) {
              throw new AppError(
                HttpStatus.UNPROCESSABLE_ENTITY,
                'HANDOVER_NOT_CONFIRMED',
                'Attach the photo of the signed handover form with the job'
              );
            }
            if (inst.handoverCode) {
              await tx
                .update(handoverCodes)
                .set({ usedAt: new Date() })
                .where(eq(handoverCodes.ticketId, ticketId));
            }
            const installation = {
              meterNumber: inst.meterNumber,
              sealNumber: inst.sealNumber,
              confirmedBy: inst.handoverCode ? ('sms_code' as const) : ('signed_form' as const),
              confirmedAt: (input.occurredAt ?? new Date()).toISOString()
            };
            changes.details = { ...ticket.details, installation };
            data.installation = installation;
            if (ticket.customerId) {
              const [other] = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(and(eq(customers.meterNumber, inst.meterNumber), ne(customers.id, ticket.customerId)));
              if (other) {
                throw new AppError(
                  HttpStatus.CONFLICT,
                  'METER_IN_USE',
                  `Meter ${inst.meterNumber} is already recorded for another customer: check the number`
                );
              }
              await tx
                .update(customers)
                .set({ meterNumber: inst.meterNumber })
                .where(eq(customers.id, ticket.customerId));
            }
            outboxIds.push(
              ...(await this.notifications.recordWebhook(tx, 'connection_installed', ticket, {
                meterNumber: installation.meterNumber,
                sealNumber: installation.sealNumber ?? null,
                confirmedBy: installation.confirmedBy,
                installedAt: installation.confirmedAt
              }))
            );
          }
          break;
        }
        case 'close': {
          changes.closedAt = new Date();
          const activated = ticket.type === 'new_connection';
          if (activated) changes.details = { ...ticket.details, activatedAt: new Date().toISOString() };
          messages.push({
            recipient: await this.customerPhone(tx, ticket.customerId),
            body: activated ? sms.customerConnected(ticket.code) : sms.customerClosed(ticket.code),
            ticketId
          });
          if (ticket.type === 'network_incident') await this.closeLinked(tx, ticket, actor, messages);
          consumeAfter = true;
          break;
        }
        case 'reopen':
          changes.reopenCount = ticket.reopenCount + 1;
          autoAssignAfter = true;
          break;
        case 'cancel':
          changes.closedAt = new Date();
          if (ticket.type === 'network_incident') unlinkAfter = true;
          // Nothing recorded on a cancelled job leaves stock; what was set aside is free again.
          await this.stock.releaseReservations(tx, ticketId);
          if (ticket.source === 'sales') {
            outboxIds.push(
              ...(await this.notifications.recordWebhook(tx, 'request_cancelled', ticket, {
                reason: input.reason ?? null
              }))
            );
          }
          if (ticket.assigneeId && OPEN_JOB_STATUSES.includes(ticket.status)) {
            const staff = await this.users.findById(ticket.assigneeId, tx);
            messages.push({
              recipient: staff?.phone ?? null,
              body: sms.staffCancelled(ticket.code),
              ticketId,
              staff: { userId: ticket.assigneeId, title: push.jobCancelled }
            });
          }
          break;
      }

      await tx.update(tickets).set(changes).where(eq(tickets.id, ticketId));
      await this.addEvent(tx, ticketId, action, actor, data);
      // After the "close" entry, so a stock shortfall shows up after it in the history.
      if (consumeAfter) await this.consume(tx, ticketId, actor);

      if (unlinkAfter) await this.unlinkAll(tx, ticket, messages);

      if (closeSurveyAfter) {
        to = 'closed';
        await tx
          .update(tickets)
          .set({ status: 'closed', closedAt: new Date() })
          .where(eq(tickets.id, ticketId));
        await this.addEvent(tx, ticketId, 'close', SYSTEM_ACTOR, {
          from: 'resolved',
          to: 'closed',
          note: 'Survey report sent to Sales'
        });
        await this.consume(tx, ticketId, actor);
        const survey = input.survey!;
        outboxIds.push(
          ...(await this.notifications.recordWebhook(tx, 'survey_completed', ticket, {
            result: survey.result,
            distanceToNetworkM: survey.distanceToNetworkM ?? null,
            nearestElement: survey.nearestElement ?? null,
            worksNeeded: survey.worksNeeded ?? null,
            estimatedMaterials: await this.materialNames(tx, survey.estimatedMaterials),
            surveyedBy: actor.fullName,
            note: input.note ?? null
          }))
        );
        messages.push({
          recipient: await this.customerPhone(tx, ticket.customerId),
          body: sms.customerSurveyDone(ticket.code),
          ticketId
        });
      }

      if (autoAssignAfter && ticket.teamId) {
        // Whoever declined this ticket before is not asked again.
        const decliners = await this.decliners(tx, ticketId);
        const auto = await this.autoAssign(tx, ticket, ticket.teamId, to, messages, decliners);
        if (auto) to = auto;
        else {
          const [body, title] =
            action === 'decline'
              ? [
                  sms.managerDeclined(ticket.code, actor.fullName),
                  inbox.declined(ticket.code, actor.fullName)
                ]
              : [sms.managerReopened(ticket.code), inbox.reopened(ticket.code)];
          messages.push(...toOffice(await this.users.teamManagers(ticket.teamId, tx), body, title, ticketId));
        }
      }

      outboxIds.push(...(await this.notifications.record(tx, messages)));
      return to;
    });
    await this.notifications.dispatch(outboxIds);
    return status;
  }

  /**
   * Gives the ticket to the least busy field staff member of the team who is on duty, recording it as done by the
   * system. Returns the new status, or null when auto-assignment is off or nobody is available.
   */
  private async autoAssign(
    tx: Tx,
    ticket: { id: string; code: string; title: string; location: { lat: number; lng: number } | null },
    teamId: string,
    current: TicketStatus,
    messages: OutgoingSms[],
    excludeIds: string[] = []
  ): Promise<TicketStatus | null> {
    if (!this.env.AUTO_ASSIGN) return null;
    const staff = await this.users.pickAutoAssignee(tx, teamId, excludeIds, ticket.location);
    if (!staff) return null;
    const to = nextStatus(current, 'assign', SYSTEM_ACTOR, null);
    await tx
      .update(tickets)
      .set({ status: to, assigneeId: staff.id, updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
    await this.users.markAssigned(tx, staff.id);
    await this.addEvent(tx, ticket.id, 'assign', SYSTEM_ACTOR, {
      from: current,
      to,
      assigneeId: staff.id,
      assigneeName: staff.fullName,
      auto: true,
      distanceM: staff.distanceM
    });
    messages.push({
      recipient: staff.phone,
      body: sms.staffAssigned(ticket.code, ticket.title),
      ticketId: ticket.id,
      staff: { userId: staff.id, title: push.newJob }
    });
    return to;
  }

  /**
   * Closes the customer tickets linked to a network incident when NOC closes it: the cause is fixed, so the
   * Call Center does not need to call each customer back. Each customer gets an SMS.
   */
  private async closeLinked(
    tx: Tx,
    incident: { id: string; code: string },
    actor: AuthUser,
    messages: OutgoingSms[]
  ): Promise<void> {
    const linked = await tx
      .select({ id: tickets.id, code: tickets.code, status: tickets.status, customerId: tickets.customerId })
      .from(tickets)
      .where(and(eq(tickets.incidentId, incident.id), notInArray(tickets.status, ['closed', 'cancelled'])))
      .for('update');
    for (const t of linked) {
      await tx
        .update(tickets)
        .set({ status: 'closed', closedAt: new Date(), updatedAt: new Date() })
        .where(eq(tickets.id, t.id));
      await this.addEvent(tx, t.id, 'closed_with_incident', actor, {
        from: t.status,
        to: 'closed',
        incidentId: incident.id,
        incidentCode: incident.code
      });
      messages.push({
        recipient: await this.customerPhone(tx, t.customerId),
        body: sms.customerPowerBack(t.code),
        ticketId: t.id
      });
    }
  }

  /** A cancelled incident (false alarm) frees its linked customer tickets, which then get someone of their own. */
  private async unlinkAll(
    tx: Tx,
    incident: { id: string; code: string },
    messages: OutgoingSms[]
  ): Promise<void> {
    const linked = await tx
      .select()
      .from(tickets)
      .where(and(eq(tickets.incidentId, incident.id), notInArray(tickets.status, ['closed', 'cancelled'])))
      .for('update');
    for (const t of linked) {
      await tx.update(tickets).set({ incidentId: null, updatedAt: new Date() }).where(eq(tickets.id, t.id));
      await this.addEvent(tx, t.id, 'unlinked', SYSTEM_ACTOR, {
        incidentId: incident.id,
        incidentCode: incident.code
      });
      if (t.teamId && (t.status === 'new' || t.status === 'reopened')) {
        const auto = await this.autoAssign(tx, t, t.teamId, t.status, messages);
        if (!auto) {
          messages.push(
            ...toOffice(
              await this.users.teamManagers(t.teamId, tx),
              sms.managerNewTicket(t.code, t.title),
              inbox.newTicket(t.code, t.title),
              t.id
            )
          );
        }
      }
    }
  }

  /** An open network incident close to this point, for linking no-power complaints to it. */
  private async nearbyIncident(
    tx: Tx,
    p: { lng: number; lat: number }
  ): Promise<{ id: string; code: string } | null> {
    const result = await tx.execute<{ id: string; code: string }>(sql`
      select t.id, t.code from tickets t
      where t.type = 'network_incident'
        and t.status not in ('resolved', 'closed', 'cancelled')
        and t.location is not null
        and ST_DWithin(t.location::geography, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography, ${this.env.INCIDENT_LINK_RADIUS_M})
      order by ST_Distance(t.location::geography, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography)
      limit 1`);
    return result.rows[0] ?? null;
  }

  /**
   * Moves a ticket to another team (tickets outside every area, or sent to the wrong team). Only while nobody is
   * working on it; it is then assigned like a new ticket.
   */
  async setTeam(ticketId: string, teamId: string, actor: AuthUser): Promise<void> {
    const outboxIds: string[] = [];
    await this.db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
      if (!ticket) throw notFound('Ticket');
      if (!['new', 'reopened'].includes(ticket.status)) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'Only tickets nobody is working on can move to another team'
        );
      }
      const route = await this.teamRoute(tx, teamId);
      await tx
        .update(tickets)
        .set({ teamId, areaId: ticket.areaId ?? route.areaId, updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
      await this.addEvent(tx, ticketId, 'team_changed', actor, {
        from: ticket.teamId,
        to: teamId,
        teamName: route.teamName
      });
      const messages: OutgoingSms[] = [];
      if (!ticket.incidentId) {
        const auto = await this.autoAssign(tx, ticket, teamId, ticket.status, messages);
        if (!auto) {
          messages.push(
            ...toOffice(
              await this.users.teamManagers(teamId, tx),
              sms.managerNewTicket(ticket.code, ticket.title),
              inbox.newTicket(ticket.code, ticket.title),
              ticketId
            )
          );
        }
      }
      outboxIds.push(...(await this.notifications.record(tx, messages)));
    });
    await this.notifications.dispatch(outboxIds);
  }

  /** NOC confirms it has seen a network incident (shown to everyone on the incident). */
  async acknowledge(ticketId: string, actor: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
      if (!ticket) throw notFound('Ticket');
      if (ticket.type !== 'network_incident') {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'NOT_AN_INCIDENT',
          'Only network incidents are acknowledged'
        );
      }
      if (ticket.acknowledgedAt) return;
      await tx
        .update(tickets)
        .set({ acknowledgedAt: new Date(), acknowledgedBy: actor.userId, updatedAt: new Date() })
        .where(eq(tickets.id, ticketId));
      await this.addEvent(tx, ticketId, 'acknowledge', actor, {});
    });
  }

  /** Links or unlinks customer tickets to a network incident by hand. */
  async link(incidentId: string, ticketIds: string[], actor: AuthUser, linked: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [incident] = await tx.select().from(tickets).where(eq(tickets.id, incidentId));
      if (!incident || incident.type !== 'network_incident') throw notFound('Incident');
      if (linked && ['closed', 'cancelled'].includes(incident.status)) {
        throw new AppError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', 'The incident is already finished');
      }
      const rows = await tx.select().from(tickets).where(inArray(tickets.id, ticketIds)).for('update');
      if (rows.length !== ticketIds.length) throw notFound('Ticket');
      for (const t of rows) {
        if (t.type !== 'customer_complaint' || ['closed', 'cancelled'].includes(t.status)) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'CANNOT_LINK',
            `${t.code} is not an open customer ticket`
          );
        }
        if (linked === (t.incidentId === incidentId)) continue;
        await tx
          .update(tickets)
          .set({ incidentId: linked ? incidentId : null, updatedAt: new Date() })
          .where(eq(tickets.id, t.id));
        await this.addEvent(tx, t.id, linked ? 'linked' : 'unlinked', actor, {
          incidentId,
          incidentCode: incident.code
        });
      }
    });
  }

  /** "We know, a crew is working on it": an SMS to every customer whose ticket is linked to the incident. */
  async notifyLinkedCustomers(incidentId: string, actor: AuthUser, message?: string): Promise<number> {
    const outboxIds: string[] = [];
    const count = await this.db.transaction(async (tx) => {
      const [incident] = await tx.select().from(tickets).where(eq(tickets.id, incidentId));
      if (!incident || incident.type !== 'network_incident') throw notFound('Incident');
      const linked = await tx
        .select({ id: tickets.id, code: tickets.code, customerId: tickets.customerId })
        .from(tickets)
        .where(and(eq(tickets.incidentId, incidentId), notInArray(tickets.status, ['closed', 'cancelled'])));
      const messages: OutgoingSms[] = [];
      for (const t of linked) {
        messages.push({
          recipient: await this.customerPhone(tx, t.customerId),
          body: message ? `EDM: ${message}` : sms.customerOutageUpdate(t.code),
          ticketId: t.id
        });
      }
      const ids = await this.notifications.record(tx, messages);
      outboxIds.push(...ids);
      await this.addEvent(tx, incidentId, 'customers_notified', actor, {
        count: ids.length,
        message: message ?? null
      });
      return ids.length;
    });
    await this.notifications.dispatch(outboxIds);
    return count;
  }

  /** Deducts the materials recorded on a closed ticket; a van going below zero is noted in the history. */
  private async consume(tx: Tx, ticketId: string, actor: AuthUser): Promise<void> {
    const short = await this.stock.postConsumption(tx, ticketId, actor);
    if (short.length) {
      await this.addEvent(tx, ticketId, 'stock_short', SYSTEM_ACTOR, {
        items: await this.materialNames(
          tx,
          short.map((x) => ({ itemId: x.itemId, quantity: x.short }))
        )
      });
    }
  }

  private async materialNames(tx: Tx, lines: MaterialLine[]) {
    if (lines.length === 0) return [];
    const rows = await tx
      .select()
      .from(stockItems)
      .where(
        inArray(
          stockItems.id,
          lines.map((l) => l.itemId)
        )
      );
    return lines.map((l) => {
      const item = rows.find((r) => r.id === l.itemId);
      return {
        code: item?.code ?? null,
        name: item?.name ?? null,
        unit: item?.unit ?? null,
        quantity: l.quantity
      };
    });
  }

  /**
   * Sends the new customer a 4-digit code by SMS; they read it to the staff member to confirm the handover.
   * Only while the connection is being installed, at most once a minute.
   */
  async sendHandoverCode(ticketId: string, actor: AuthUser): Promise<{ sentAt: string }> {
    const outboxIds: string[] = [];
    const sentAt = await this.db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).for('update');
      if (!ticket) throw notFound('Ticket');
      if (ticket.type !== 'new_connection' || ticket.status !== 'in_progress') {
        throw new AppError(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'A code is sent while installing a new connection'
        );
      }
      if (ticket.assigneeId !== actor.userId) {
        throw new AppError(
          HttpStatus.FORBIDDEN,
          'NOT_ASSIGNEE',
          'Only the assigned staff member can send the code'
        );
      }
      const phone = await this.customerPhone(tx, ticket.customerId);
      if (!phone) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'NO_CUSTOMER_PHONE',
          'The customer has no phone number: use the signed handover form'
        );
      }
      const [previous] = await tx.select().from(handoverCodes).where(eq(handoverCodes.ticketId, ticketId));
      if (previous && !previous.usedAt && Date.now() - previous.sentAt.getTime() < 60_000) {
        throw new AppError(
          HttpStatus.TOO_MANY_REQUESTS,
          'TOO_SOON',
          'Wait a minute before sending a new code'
        );
      }
      const code = String(randomInt(0, 10_000)).padStart(4, '0');
      const now = new Date();
      await tx
        .insert(handoverCodes)
        .values({ ticketId, codeHash: hashCode(ticketId, code), sentAt: now })
        .onConflictDoUpdate({
          target: handoverCodes.ticketId,
          set: { codeHash: hashCode(ticketId, code), sentAt: now, attempts: 0, usedAt: null }
        });
      await this.addEvent(tx, ticketId, 'handover_code_sent', actor, {});
      outboxIds.push(
        ...(await this.notifications.record(tx, [
          { recipient: phone, body: sms.customerHandoverCode(code), ticketId }
        ]))
      );
      return now.toISOString();
    });
    await this.notifications.dispatch(outboxIds);
    return { sentAt };
  }

  /** Checks the code the customer read out; five wrong tries lock it (a new code must be sent). */
  private async checkHandoverCode(ticketId: string, code: string): Promise<void> {
    await this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(handoverCodes)
          .where(eq(handoverCodes.ticketId, ticketId))
          .for('update');
        if (!row || row.usedAt) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'HANDOVER_CODE_MISSING',
            'Send the customer a code first'
          );
        }
        if (row.attempts >= 5) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'HANDOVER_CODE_LOCKED',
            'Too many wrong codes: send a new one'
          );
        }
        if (Date.now() - row.sentAt.getTime() > 24 * 3600_000) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'HANDOVER_CODE_EXPIRED',
            'The code has expired: send a new one'
          );
        }
        if (row.codeHash !== hashCode(ticketId, code)) {
          await tx
            .update(handoverCodes)
            .set({ attempts: row.attempts + 1 })
            .where(eq(handoverCodes.ticketId, ticketId));
          return 'wrong';
        }
        return 'ok';
      })
      .then((r) => {
        if (r === 'wrong') {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'HANDOVER_CODE_WRONG',
            'That is not the code the customer received'
          );
        }
      });
  }

  /** People who declined this ticket, from its history. */
  private async decliners(tx: Tx, ticketId: string): Promise<string[]> {
    const rows = await tx
      .select({ userId: ticketEvents.actorUserId })
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, ticketId), eq(ticketEvents.type, 'decline')));
    return [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
  }

  /** NOC, admins and the Call Center may cancel any ticket; team managers only their own team's. */
  private canCancelAnyTeam(actor: AuthUser): boolean {
    return actor.roles.some((r) => r === 'noc' || r === 'admin' || r === 'integration_call_center');
  }

  /** A note from the office in the ticket history; optionally sent to the assigned staff member too. */
  async addNote(ticketId: string, actor: AuthUser, text: string, notifyAssignee: boolean): Promise<void> {
    const outboxIds: string[] = [];
    await this.db.transaction(async (tx) => {
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
      if (!ticket) throw notFound('Ticket');
      const notify = notifyAssignee && !!ticket.assigneeId && OPEN_JOB_STATUSES.includes(ticket.status);
      await this.addEvent(tx, ticketId, 'note', actor, { note: text, notified: notify });
      if (notify) {
        const staff = await this.users.findById(ticket.assigneeId!, tx);
        outboxIds.push(
          ...(await this.notifications.record(tx, [
            {
              recipient: staff?.phone ?? null,
              body: sms.staffNote(ticket.code, actor.fullName, text),
              ticketId,
              staff: { userId: ticket.assigneeId!, title: push.note }
            }
          ]))
        );
      }
    });
    await this.notifications.dispatch(outboxIds);
  }

  /** Reserves an attachment row and returns an upload URL; only the assigned staff member may add photos. */
  async createUpload(
    ticketId: string,
    actor: AuthUser,
    file: { fileName: string; contentType: string; size: number }
  ): Promise<{ attachmentId: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string> }> {
    const [ticket] = await this.db
      .select({ assigneeId: tickets.assigneeId, status: tickets.status })
      .from(tickets)
      .where(eq(tickets.id, ticketId));
    if (!ticket) throw notFound('Ticket');
    if (!actor.userId || ticket.assigneeId !== actor.userId) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'NOT_ASSIGNEE',
        'Only the assigned staff member can add photos'
      );
    }
    if (!['accepted', 'in_progress'].includes(ticket.status)) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Photos can only be added while working on the job'
      );
    }
    const extension = file.contentType.split('/')[1];
    const objectKey = `tickets/${ticketId}/${randomUUID()}.${extension}`;
    const [row] = await this.db
      .insert(attachments)
      .values({
        ticketId,
        objectKey,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.size,
        uploadedBy: actor.userId
      })
      .returning({ id: attachments.id });
    return {
      attachmentId: row.id,
      uploadUrl: await this.storage.presignUpload(objectKey, file.contentType),
      method: 'PUT',
      headers: { 'Content-Type': file.contentType }
    };
  }

  private async confirmUploads(tx: Tx, ticketId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .select()
      .from(attachments)
      .where(and(eq(attachments.ticketId, ticketId), inArray(attachments.id, ids)));
    if (rows.length !== new Set(ids).size) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ATTACHMENT_NOT_FOUND',
        'A photo does not belong to this ticket'
      );
    }
    for (const row of rows) {
      if (row.status === 'uploaded') continue;
      if ((await this.storage.objectSize(row.objectKey)) === null) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'ATTACHMENT_NOT_UPLOADED',
          `Photo ${row.fileName} was not uploaded`
        );
      }
      await tx.update(attachments).set({ status: 'uploaded' }).where(eq(attachments.id, row.id));
    }
    return rows.map((r) => r.id);
  }

  private async customerPhone(tx: Tx, customerId: string | null): Promise<string | null> {
    if (!customerId) return null;
    const result = await tx.execute<{ phone: string | null }>(
      sql`select phone from customers where id = ${customerId}`
    );
    return result.rows[0]?.phone ?? null;
  }

  private async addEvent(
    tx: Tx,
    ticketId: string,
    type: string,
    actor: AuthUser,
    data: Record<string, unknown>
  ): Promise<void> {
    await tx.insert(ticketEvents).values({
      ticketId,
      type,
      actorUserId: actor.userId,
      actorLabel: actorLabel(actor),
      data
    });
  }

  /** Next code in the TK-YY-NNNNN series; the counter row lock serialises concurrent creations. */
  private async nextCode(tx: Tx): Promise<string> {
    const year = new Date().getUTCFullYear();
    const [row] = await tx
      .insert(ticketCounters)
      .values({ year, lastValue: 1 })
      .onConflictDoUpdate({
        target: ticketCounters.year,
        set: { lastValue: sql`${ticketCounters.lastValue} + 1` }
      })
      .returning({ value: ticketCounters.lastValue });
    return `TK-${String(year % 100).padStart(2, '0')}-${String(row.value).padStart(5, '0')}`;
  }

  private async teamRoute(
    tx: Tx,
    teamId: string
  ): Promise<{ areaId: string; teamId: string; teamName: string }> {
    const result = await tx.execute<{ area_id: string; name: string }>(
      sql`select area_id, name from teams where id = ${teamId}`
    );
    const row = result.rows[0];
    if (!row) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TEAM_NOT_FOUND', 'Team not found');
    return { areaId: row.area_id, teamId, teamName: row.name };
  }

  /** Area containing the point, and the first team working in that area. */
  private async route(
    tx: Tx,
    p: { lng: number; lat: number }
  ): Promise<{ areaId: string; teamId: string | null } | null> {
    const result = await tx.execute<{ area_id: string; team_id: string | null }>(sql`
      select a.id as area_id,
        (select t.id from teams t where t.area_id = a.id order by t.code limit 1) as team_id
      from areas a
      where ST_Contains(a.boundary, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326))
      order by a.code
      limit 1`);
    const row = result.rows[0];
    return row ? { areaId: row.area_id, teamId: row.team_id } : null;
  }
}
