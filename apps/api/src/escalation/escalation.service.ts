import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TIME_LIMITS_ACTOR } from '../auth/auth-user';
import { ENV, type Env } from '../config/env';
import { DB, type Db, type Tx } from '../db/db.module';
import { inbox, push, sms, toOffice } from '../notifications/messages';
import type { OutgoingSms } from '../notifications/notifications.service';
import { TicketsService } from '../tickets/tickets.service';
import { UsersService, type OfficeRecipient } from '../users/users.service';

type Candidate = {
  id: string;
  code: string;
  title: string;
  team_id: string | null;
  assignee_id: string | null;
  escalation_level: number;
  target: number;
  minutes_left: number;
  hours_open: number;
};

/**
 * Watches time limits. For a ticket that is not fixed yet, measured from when it opened (or its planned start):
 *  1. a quarter of the time is left → the staff member holding it is reminded;
 *  2. the time limit has passed → the staff member, the team manager and NOC are told;
 *  3. one and a half times the limit has passed → technical managers are told.
 * Each level is sent once; the level is stored on the ticket in the same transaction, so several API instances
 * can run this at the same time.
 */
@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly tickets: TicketsService,
    private readonly users: UsersService
  ) {}

  onModuleInit(): void {
    if (!this.env.RUN_WORKERS) return;
    this.timer = setInterval(() => {
      this.run().catch((err: Error) => this.logger.warn(`Time-limit check failed: ${err.message}`));
    }, this.env.ESCALATION_CHECK_SECONDS * 1000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One check of all open tickets. Returns how many tickets moved to a higher level. */
  async run(): Promise<number> {
    const outboxIds: string[] = [];
    const moved = await this.db.transaction(async (tx) => {
      const start = sql`coalesce(t.scheduled_start, t.created_at)`;
      const target = sql`case
          when now() >= ${start} + 1.5 * (t.due_at - ${start}) then 3
          when now() >= t.due_at then 2
          when now() >= t.due_at - 0.25 * (t.due_at - ${start}) then 1
          else 0 end`;
      const { rows } = await tx.execute<Candidate>(sql`
        select t.id, t.code, t.title, t.team_id, t.assignee_id, t.escalation_level, ${target} as target,
               ceil(extract(epoch from (t.due_at - now())) / 60)::int as minutes_left,
               floor(extract(epoch from (now() - ${start})) / 3600)::int as hours_open
        from tickets t
        where t.status in ('new', 'assigned', 'accepted', 'in_progress', 'on_hold', 'reopened')
          and t.due_at is not null
          and t.due_at > ${start}
          and t.incident_id is null
          and t.escalation_level < ${target}
        order by t.due_at
        limit 200
        for update skip locked`);
      for (const t of rows) {
        await tx.execute(sql`update tickets set escalation_level = ${t.target} where id = ${t.id}`);
        for (let level = t.escalation_level + 1; level <= t.target; level++) {
          // Someone already late does not also get the "time is running out" reminder.
          if (level === 1 && t.target > 1) continue;
          outboxIds.push(...(await this.escalate(tx, t, level)));
        }
      }
      return rows.length;
    });
    await this.tickets.dispatch(outboxIds);
    return moved;
  }

  private async escalate(tx: Tx, t: Candidate, level: number): Promise<string[]> {
    const messages: OutgoingSms[] = [];
    const told: string[] = [];
    const staff = t.assignee_id ? await this.users.findById(t.assignee_id, tx) : undefined;
    const toStaff = (body: string, title: string) => {
      if (!staff) return;
      messages.push({ recipient: staff.phone, body, ticketId: t.id, staff: { userId: staff.id, title } });
      told.push(staff.fullName);
    };
    const toPeople = (people: OfficeRecipient[], body: string, title: string, who: string) => {
      messages.push(...toOffice(people, body, title, t.id));
      if (people.length) told.push(who);
    };

    if (level === 1) {
      toStaff(sms.staffDueSoon(t.code, Math.max(t.minutes_left, 1)), push.dueSoon);
    } else if (level === 2) {
      toStaff(sms.late(t.code, t.title), push.late);
      const late = [sms.late(t.code, t.title), inbox.late(t.code, t.title)] as const;
      if (t.team_id) toPeople(await this.users.teamManagers(t.team_id, tx), ...late, 'team manager');
      toPeople(await this.users.withRole('noc', tx), ...late, 'NOC');
    } else {
      toPeople(
        await this.users.withRole('technical_manager', tx),
        sms.badlyLate(t.code, t.title, t.hours_open),
        inbox.badlyLate(t.code, t.title, t.hours_open),
        'technical managers'
      );
    }
    await this.tickets.event(tx, t.id, 'escalate', TIME_LIMITS_ACTOR, { level, notified: told });
    return this.tickets.recordMessages(tx, messages);
  }
}
