import { Inject, Injectable } from '@nestjs/common';
import {
  ON_TIME_TARGET_PCT,
  type Report,
  type ReportQuery,
  type StockUnit,
  type TicketType
} from '../contract';
import IORedis from 'ioredis';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { DB, type Db } from '../db/db.module';
import { tickets } from '../db/schema';
import { REDIS } from '../redis/redis.module';
import { TicketsQuery } from '../tickets/tickets.query';

/** Reports are read often and change slowly; a minute-old figure is fine. */
const CACHE_SECONDS = 60;
const TZ = 'Africa/Maputo';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const pct = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 100);
const round = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));
const days = (minutes: unknown): number | null =>
  minutes === null || minutes === undefined ? null : Math.round((Number(minutes) / 1440) * 10) / 10;

/** Reports & KPIs (W15) and the ticket export, over a period of whole days in Maputo time. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: IORedis,
    private readonly query: TicketsQuery
  ) {}

  /**
   * Start and end (exclusive) of the period, and of the period of the same length just before it: midnight in
   * Maputo. The ::timestamp matters: a date "at time zone" is first taken as midnight UTC, two hours off.
   */
  private bounds(q: ReportQuery) {
    const from = sql`(${q.from}::date::timestamp at time zone ${TZ})`;
    const to = sql`((${q.to}::date + 1)::timestamp at time zone ${TZ})`;
    const before = sql`((${q.from}::date - (${q.to}::date - ${q.from}::date + 1))::timestamp at time zone ${TZ})`;
    return { from, to, before };
  }

  /** Which tickets the caller may count, narrowed by the screen's filters; null when none. */
  private where(user: AuthUser, q: Pick<ReportQuery, 'areaId' | 'teamId'>): SQL | null {
    const scope = this.query.scope(user);
    if (scope === null) return null;
    return (
      and(
        scope,
        q.areaId ? eq(tickets.areaId, q.areaId) : undefined,
        q.teamId ? eq(tickets.teamId, q.teamId) : undefined
      ) ?? sql`true`
    );
  }

  async report(user: AuthUser, q: ReportQuery): Promise<Report> {
    const where = this.where(user, q);
    if (where === null) return this.empty(q);
    const key = `report:v1:${this.scopeKey(user)}:${q.from}:${q.to}:${q.areaId ?? ''}:${q.teamId ?? ''}`;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) return JSON.parse(cached) as Report;
    const report = await this.build(where, q);
    await this.redis.set(key, JSON.stringify(report), 'EX', CACHE_SECONDS).catch(() => undefined);
    return report;
  }

  private scopeKey(user: AuthUser): string {
    return this.query.scope(user) === undefined ? 'all' : `team:${user.teamId ?? 'none'}`;
  }

  private empty(q: ReportQuery): Report {
    return {
      from: q.from,
      to: q.to,
      closed: 0,
      closedBefore: 0,
      onTimePct: null,
      onTimeTarget: ON_TIME_TARGET_PCT,
      mttrMinutes: null,
      firstTimePct: null,
      received: 0,
      stillOpen: 0,
      perDay: [],
      byType: [],
      byTeam: [],
      byStaff: [],
      incidents: { count: 0, avgRestoreMinutes: null, customersAffected: 0, alarms: 0 },
      newCustomers: {
        surveysDone: 0,
        avgSurveyDays: null,
        connectionsDone: 0,
        avgConnectionDays: null,
        waitingActivation: 0
      },
      materials: []
    };
  }

  private async build(where: SQL, q: ReportQuery): Promise<Report> {
    const { from, to, before } = this.bounds(q);
    const closedIn = sql`(tickets.status = 'closed' and tickets.closed_at >= ${from} and tickets.closed_at < ${to})`;
    const fixedIn = sql`(tickets.resolved_at >= ${from} and tickets.resolved_at < ${to})`;
    const fixMinutes = sql`greatest(0, extract(epoch from (tickets.resolved_at - tickets.created_at)) / 60)`;
    const onTime = sql`case when tickets.resolved_at <= tickets.due_at then 1.0 else 0.0 end`;

    const [figures, perDay, byType, byTeam, byStaff, incidents, alarms, newCustomers, materials] =
      await Promise.all([
        this.db.execute<Record<string, unknown>>(sql`
          select
            count(*) filter (where ${closedIn})::int as closed,
            count(*) filter (where tickets.status = 'closed' and tickets.closed_at >= ${before}
                             and tickets.closed_at < ${from})::int as closed_before,
            avg(${onTime}) filter (where ${fixedIn} and tickets.due_at is not null) as on_time,
            avg(${fixMinutes}) filter (where ${fixedIn} and tickets.type <> 'planned_work') as mttr,
            avg(case when tickets.reopen_count = 0 then 1.0 else 0.0 end) filter (where ${closedIn}) as first_time,
            count(*) filter (where tickets.created_at >= ${from} and tickets.created_at < ${to})::int as received,
            count(*) filter (where tickets.status not in ('closed', 'cancelled'))::int as still_open
          from tickets where ${where}`),
        this.db.execute<{ day: string; closed: number }>(sql`
          with c as (
            select (tickets.closed_at at time zone ${TZ})::date as day, count(*)::int as n
            from tickets where ${where} and ${closedIn} group by 1
          )
          select to_char(d, 'YYYY-MM-DD') as day, coalesce(c.n, 0)::int as closed
          from generate_series(${q.from}::date, ${q.to}::date, interval '1 day') d
          left join c on c.day = d::date
          order by d`),
        this.db.execute<{ type: TicketType; closed: number }>(sql`
          select tickets.type, count(*)::int as closed from tickets
          where ${where} and ${closedIn} group by 1 order by 2 desc`),
        this.db.execute<Record<string, unknown>>(sql`
          select teams.id as team_id, teams.name as team_name,
                 count(*) filter (where ${closedIn})::int as closed,
                 avg(${onTime}) filter (where ${fixedIn} and tickets.due_at is not null) as on_time,
                 avg(${fixMinutes}) filter (where ${fixedIn} and tickets.type <> 'planned_work') as fix,
                 avg(case when tickets.reopen_count > 0 then 1.0 else 0.0 end) filter (where ${closedIn}) as reopened
          from tickets join teams on teams.id = tickets.team_id
          where ${where} and (${closedIn} or ${fixedIn})
          group by teams.id, teams.name order by teams.name`),
        this.db.execute<Record<string, unknown>>(sql`
          select users.id as user_id, users.full_name, teams.name as team_name,
                 count(*) filter (where ${fixedIn})::int as fixed,
                 avg(${onTime}) filter (where ${fixedIn} and tickets.due_at is not null) as on_time,
                 avg(${fixMinutes}) filter (where ${fixedIn} and tickets.type <> 'planned_work') as fix,
                 avg(case when tickets.reopen_count = 0 then 1.0 else 0.0 end) filter (where ${closedIn}) as first_time
          from tickets
          join users on users.id = tickets.assignee_id
          left join teams on teams.id = users.team_id
          where ${where} and (${closedIn} or ${fixedIn})
          group by users.id, users.full_name, teams.name
          order by fixed desc, users.full_name
          limit 50`),
        this.db.execute<Record<string, unknown>>(sql`
          select count(*)::int as count,
                 avg(${fixMinutes}) filter (where tickets.resolved_at is not null) as restore,
                 coalesce(sum(tickets.customers_affected), 0)::int as customers
          from tickets
          where ${where} and tickets.type = 'network_incident'
            and tickets.created_at >= ${from} and tickets.created_at < ${to}`),
        this.db.execute<{ n: number }>(sql`
          select count(*)::int as n from alarms join tickets on tickets.id = alarms.ticket_id
          where ${where} and alarms.raised_at >= ${from} and alarms.raised_at < ${to}`),
        this.db.execute<Record<string, unknown>>(sql`
          select
            count(*) filter (where tickets.type = 'new_customer_survey' and ${fixedIn})::int as surveys,
            avg(${fixMinutes}) filter (where tickets.type = 'new_customer_survey' and ${fixedIn}) as survey_minutes,
            count(*) filter (where tickets.type = 'new_connection' and ${fixedIn})::int as connections,
            avg(${fixMinutes}) filter (where tickets.type = 'new_connection' and ${fixedIn}) as connection_minutes,
            count(*) filter (where tickets.type = 'new_connection' and tickets.status = 'resolved')::int as waiting
          from tickets
          where ${where} and tickets.type in ('new_customer_survey', 'new_connection')`),
        this.db.execute<Record<string, unknown>>(sql`
          select stock_items.id as item_id, stock_items.code, stock_items.name, stock_items.unit,
                 sum(stock_movements.quantity)::float8 as quantity,
                 count(distinct stock_movements.ticket_id)::int as tickets
          from stock_movements
          join stock_items on stock_items.id = stock_movements.item_id
          join tickets on tickets.id = stock_movements.ticket_id
          where ${where} and stock_movements.kind = 'consume'
            and stock_movements.created_at >= ${from} and stock_movements.created_at < ${to}
          group by stock_items.id, stock_items.code, stock_items.name, stock_items.unit
          order by count(distinct stock_movements.ticket_id) desc, stock_items.name`)
      ]);

    const f = figures.rows[0]!;
    const inc = incidents.rows[0]!;
    const nc = newCustomers.rows[0]!;
    return {
      from: q.from,
      to: q.to,
      closed: Number(f.closed),
      closedBefore: Number(f.closed_before),
      onTimePct: pct(f.on_time),
      onTimeTarget: ON_TIME_TARGET_PCT,
      mttrMinutes: round(f.mttr),
      firstTimePct: pct(f.first_time),
      received: Number(f.received),
      stillOpen: Number(f.still_open),
      perDay: perDay.rows.map((r) => ({ day: r.day, closed: Number(r.closed) })),
      byType: byType.rows.map((r) => ({ type: r.type, closed: Number(r.closed) })),
      byTeam: byTeam.rows.map((r) => ({
        teamId: r.team_id as string,
        teamName: r.team_name as string,
        closed: Number(r.closed),
        onTimePct: pct(r.on_time),
        avgFixMinutes: round(r.fix),
        reopenedPct: pct(r.reopened)
      })),
      byStaff: byStaff.rows.map((r) => ({
        userId: r.user_id as string,
        fullName: r.full_name as string,
        teamName: (r.team_name as string | null) ?? null,
        fixed: Number(r.fixed),
        onTimePct: pct(r.on_time),
        avgFixMinutes: round(r.fix),
        firstTimePct: pct(r.first_time)
      })),
      incidents: {
        count: Number(inc.count),
        avgRestoreMinutes: round(inc.restore),
        customersAffected: Number(inc.customers),
        alarms: Number(alarms.rows[0]?.n ?? 0)
      },
      newCustomers: {
        surveysDone: Number(nc.surveys),
        avgSurveyDays: days(nc.survey_minutes),
        connectionsDone: Number(nc.connections),
        avgConnectionDays: days(nc.connection_minutes),
        waitingActivation: Number(nc.waiting)
      },
      materials: materials.rows.map((r) => ({
        itemId: r.item_id as string,
        code: r.code as string,
        name: r.name as string,
        unit: r.unit as StockUnit,
        quantity: num(r.quantity) ?? 0,
        tickets: Number(r.tickets)
      }))
    };
  }

  /**
   * Every ticket received, fixed or closed in the period, one row each, for a spreadsheet. Excel opens the file
   * directly: UTF-8 with a byte order mark, comma separated, times in Maputo time.
   */
  async ticketsCsv(user: AuthUser, q: ReportQuery): Promise<string> {
    const header = [
      'Code',
      'Type',
      'Source',
      'Status',
      'Priority',
      'Area',
      'Team',
      'Assigned to',
      'Title',
      'Created',
      'Time limit',
      'Fixed',
      'Closed',
      'Minutes to fix',
      'On time',
      'Times reopened',
      'Customers affected',
      'Materials used'
    ];
    const where = this.where(user, q);
    const lines = [header];
    if (where !== null) {
      const { from, to } = this.bounds(q);
      const local = (col: SQL) => sql`to_char(${col} at time zone ${TZ}, 'YYYY-MM-DD HH24:MI')`;
      const rows = await this.db.execute<Record<string, string | number | null>>(sql`
        select tickets.code, tickets.type, tickets.source, tickets.status, tickets.priority,
               areas.name as area, teams.name as team, users.full_name as assignee, tickets.title,
               ${local(sql`tickets.created_at`)} as created, ${local(sql`tickets.due_at`)} as due,
               ${local(sql`tickets.resolved_at`)} as resolved, ${local(sql`tickets.closed_at`)} as closed,
               round(greatest(0, extract(epoch from (tickets.resolved_at - tickets.created_at)) / 60)) as minutes,
               case when tickets.resolved_at is null or tickets.due_at is null then null
                    when tickets.resolved_at <= tickets.due_at then 'yes' else 'no' end as on_time,
               tickets.reopen_count, tickets.customers_affected,
               (select string_agg(stock_items.code || ' x' || ticket_materials.quantity, '; ' order by stock_items.code)
                  from ticket_materials join stock_items on stock_items.id = ticket_materials.item_id
                  where ticket_materials.ticket_id = tickets.id) as materials
        from tickets
        left join areas on areas.id = tickets.area_id
        left join teams on teams.id = tickets.team_id
        left join users on users.id = tickets.assignee_id
        where ${where} and (
          (tickets.created_at >= ${from} and tickets.created_at < ${to})
          or (tickets.resolved_at >= ${from} and tickets.resolved_at < ${to})
          or (tickets.closed_at >= ${from} and tickets.closed_at < ${to})
        )
        order by tickets.created_at
        limit 100000`);
      for (const r of rows.rows) {
        lines.push(
          [
            r.code,
            r.type,
            r.source,
            r.status,
            r.priority,
            r.area,
            r.team,
            r.assignee,
            r.title,
            r.created,
            r.due,
            r.resolved,
            r.closed,
            r.minutes,
            r.on_time,
            r.reopen_count,
            r.customers_affected,
            r.materials
          ].map((v) => (v === null || v === undefined ? '' : String(v)))
        );
      }
    }
    return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

/** Quotes a cell when needed, and defuses text a spreadsheet would run as a formula. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
