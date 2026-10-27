import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { HelpReply, HelpRequestInput, HelpRequestView, HelpStatus } from '../contract';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { helpMessages, helpRequests, teams, tickets, users } from '../db/schema';
import { inbox, push, sms, toOffice } from '../notifications/messages';
import { NotificationsService } from '../notifications/notifications.service';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService } from '../users/users.service';

const requester = alias(users, 'requester');
const handler = alias(users, 'handler');
const author = alias(users, 'author');
const SEE_ALL = ['admin', 'technical_manager', 'noc', 'bo_support', 'network_team'];

const KIND_LABEL: Record<string, string> = {
  second_person: 'second person',
  truck: 'truck',
  material: 'material',
  switch_off: 'line switched off',
  advice: 'advice',
  other: 'help'
};

/** Field staff ask the back office (BO) for help from the app; BO and team managers answer from the web. */
@Injectable()
export class HelpService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
    private readonly tickets: TicketsService
  ) {}

  async create(input: HelpRequestInput, actor: AuthUser): Promise<HelpRequestView> {
    const outboxIds: string[] = [];
    const id = await this.db.transaction(async (tx) => {
      if (input.ticketId) {
        const [t] = await tx
          .select({ assigneeId: tickets.assigneeId })
          .from(tickets)
          .where(eq(tickets.id, input.ticketId));
        if (!t || t.assigneeId !== actor.userId) {
          throw new AppError(HttpStatus.FORBIDDEN, 'NOT_ASSIGNEE', 'Ask for help on your own jobs');
        }
      }
      const [row] = await tx
        .insert(helpRequests)
        .values({
          kind: input.kind,
          message: input.message,
          ticketId: input.ticketId ?? null,
          requestedBy: actor.userId!,
          teamId: actor.teamId
        })
        .returning({ id: helpRequests.id });
      await tx
        .insert(helpMessages)
        .values({ requestId: row!.id, authorUserId: actor.userId, fromField: true, body: input.message });
      if (input.ticketId) {
        await this.tickets.event(tx, input.ticketId, 'help_requested', actor, {
          kind: input.kind,
          message: input.message
        });
      }
      const people = [
        ...(await this.users.withRole('bo_support', tx)),
        ...(actor.teamId ? await this.users.teamManagers(actor.teamId, tx) : [])
      ];
      const kind = KIND_LABEL[input.kind] ?? input.kind;
      outboxIds.push(
        ...(await this.notifications.record(
          tx,
          toOffice(
            [...new Map(people.map((p) => [p.id, p])).values()],
            sms.boNewHelp(actor.fullName, kind),
            inbox.help(actor.fullName, kind),
            input.ticketId ?? null,
            '/help'
          )
        ))
      );
      return row!.id;
    });
    await this.notifications.dispatch(outboxIds);
    return this.get(id, actor);
  }

  private scope(user: AuthUser) {
    if (user.roles.some((r) => SEE_ALL.includes(r))) return undefined;
    if (user.roles.includes('team_manager'))
      return user.teamId ? eq(helpRequests.teamId, user.teamId) : sql`false`;
    if (user.roles.includes('field_staff') && user.userId) return eq(helpRequests.requestedBy, user.userId);
    return sql`false`;
  }

  async list(user: AuthUser, status?: HelpStatus, areaId?: string): Promise<HelpRequestView[]> {
    const rows = await this.base()
      .where(
        and(
          this.scope(user),
          status ? eq(helpRequests.status, status) : undefined,
          areaId ? sql`${helpRequests.teamId} in (select id from teams where area_id = ${areaId})` : undefined
        )
      )
      .orderBy(
        sql`case ${helpRequests.status} when 'new' then 0 when 'in_progress' then 1 else 2 end`,
        desc(helpRequests.updatedAt)
      )
      .limit(200);
    return this.withMessages(rows);
  }

  async get(id: string, user: AuthUser): Promise<HelpRequestView> {
    const rows = await this.base().where(and(eq(helpRequests.id, id), this.scope(user)));
    if (!rows.length) throw notFound('Help request');
    return (await this.withMessages(rows))[0]!;
  }

  /**
   * Adds a message. From the office it marks the request as being handled (or solved) and is sent to the
   * staff member by push or SMS; from the staff member it just joins the conversation.
   */
  async reply(id: string, input: HelpReply, actor: AuthUser): Promise<HelpRequestView> {
    const view = await this.get(id, actor);
    const fromField = view.requestedBy.id === actor.userId;
    const outboxIds: string[] = [];
    await this.db.transaction(async (tx) => {
      await tx
        .insert(helpMessages)
        .values({ requestId: id, authorUserId: actor.userId, fromField, body: input.body });
      const status: HelpStatus =
        input.status ?? (fromField ? view.status : view.status === 'new' ? 'in_progress' : view.status);
      await tx
        .update(helpRequests)
        .set({
          status,
          updatedAt: new Date(),
          solvedAt: status === 'solved' ? new Date() : null,
          ...(fromField ? {} : { handledBy: actor.userId })
        })
        .where(eq(helpRequests.id, id));
      if (!fromField) {
        outboxIds.push(
          ...(await this.notifications.record(tx, [
            {
              recipient: view.requestedBy.phone,
              body: sms.staffHelpReply(input.body),
              ticketId: view.ticket?.id ?? null,
              staff: { userId: view.requestedBy.id, title: push.helpReply }
            }
          ]))
        );
      }
    });
    await this.notifications.dispatch(outboxIds);
    return this.get(id, actor);
  }

  private base() {
    return this.db
      .select({
        id: helpRequests.id,
        kind: helpRequests.kind,
        message: helpRequests.message,
        status: helpRequests.status,
        ticketId: tickets.id,
        ticketCode: tickets.code,
        ticketTitle: tickets.title,
        requesterId: requester.id,
        requesterName: requester.fullName,
        requesterPhone: requester.phone,
        teamName: teams.name,
        handledBy: handler.fullName,
        createdAt: helpRequests.createdAt,
        updatedAt: helpRequests.updatedAt
      })
      .from(helpRequests)
      .innerJoin(requester, eq(requester.id, helpRequests.requestedBy))
      .leftJoin(handler, eq(handler.id, helpRequests.handledBy))
      .leftJoin(teams, eq(teams.id, helpRequests.teamId))
      .leftJoin(tickets, eq(tickets.id, helpRequests.ticketId));
  }

  private async withMessages(rows: Awaited<ReturnType<HelpService['base']>>): Promise<HelpRequestView[]> {
    const ids = rows.map((r) => r.id);
    const messages = ids.length
      ? await this.db
          .select({
            id: helpMessages.id,
            requestId: helpMessages.requestId,
            authorName: author.fullName,
            fromField: helpMessages.fromField,
            body: helpMessages.body,
            createdAt: helpMessages.createdAt
          })
          .from(helpMessages)
          .leftJoin(author, eq(author.id, helpMessages.authorUserId))
          .where(inArray(helpMessages.requestId, ids))
          .orderBy(asc(helpMessages.createdAt))
      : [];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      status: r.status,
      ticket: r.ticketId ? { id: r.ticketId, code: r.ticketCode!, title: r.ticketTitle! } : null,
      requestedBy: { id: r.requesterId, fullName: r.requesterName, phone: r.requesterPhone },
      teamName: r.teamName,
      handledBy: r.handledBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      messages: messages
        .filter((m) => m.requestId === r.id)
        .map((m) => ({
          id: m.id,
          authorName: m.authorName ?? 'System',
          fromField: m.fromField,
          body: m.body,
          createdAt: m.createdAt.toISOString()
        }))
    }));
  }
}
