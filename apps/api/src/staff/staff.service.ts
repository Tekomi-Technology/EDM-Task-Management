import { Inject, Injectable } from '@nestjs/common';
import type { LiveMap, StaffLive, StaffPerformance, StaffState } from '@edm/shared';
import { and, arrayContains, asc, eq, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { DB, type Db } from '../db/db.module';
import { teams, users } from '../db/schema';
import { LocationService } from '../location/location.service';
import { TicketsQuery } from '../tickets/tickets.query';

const SEE_ALL = ['admin', 'technical_manager', 'noc', 'bo_support', 'network_team'];
const OUTER_USER_ID = sql.raw('"users"."id"');
const TODAY = sql.raw(`(date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo')`);

/** Field staff right now (live map) and over a period (Field staff screen). */
@Injectable()
export class StaffService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly locations: LocationService,
    private readonly tickets: TicketsQuery
  ) {}

  /** Field staff the caller may see: everyone for NOC and managers above teams, own team for team managers. */
  private teamFilter(user: AuthUser, teamId?: string, areaId?: string) {
    if (!user.roles.some((r) => SEE_ALL.includes(r))) {
      return user.teamId ? eq(users.teamId, user.teamId) : sql`false`;
    }
    return and(
      teamId ? eq(users.teamId, teamId) : undefined,
      areaId ? sql`${users.teamId} in (select id from teams where area_id = ${areaId})` : undefined
    );
  }

  async live(user: AuthUser, teamId?: string, areaId?: string): Promise<StaffLive[]> {
    const rows = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        teamId: users.teamId,
        teamName: teams.name,
        onDuty: users.onDuty,
        openJobs: sql<number>`(select count(*)::int from tickets t where t.assignee_id = ${OUTER_USER_ID}
          and t.status in ('assigned', 'accepted', 'in_progress', 'on_hold'))`,
        doneToday: sql<number>`(select count(*)::int from ticket_events e where e.actor_user_id = ${OUTER_USER_ID}
          and e.type = 'resolve' and e.created_at >= ${TODAY})`,
        // The job they are on: being fixed first, then paused, then on the way.
        currentJob: sql<{ id: string; code: string; title: string; status: string } | null>`(
          select json_build_object('id', t.id, 'code', t.code, 'title', t.title, 'status', t.status)
          from tickets t where t.assignee_id = ${OUTER_USER_ID} and t.status in ('in_progress', 'on_hold', 'accepted')
          order by case t.status when 'in_progress' then 0 when 'on_hold' then 1 else 2 end, t.updated_at desc
          limit 1)`
      })
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .where(
        and(
          eq(users.status, 'active'),
          arrayContains(users.roles, ['field_staff']),
          this.teamFilter(user, teamId, areaId)
        )
      )
      .orderBy(asc(users.fullName));
    const positions = await this.locations.latest(rows.map((r) => r.id));
    return rows.map((r) => {
      const known = positions.get(r.id);
      const state: StaffState = !r.onDuty
        ? 'off_duty'
        : !known?.fresh
          ? 'offline'
          : r.currentJob
            ? 'on_job'
            : 'free';
      return {
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        teamId: r.teamId,
        teamName: r.teamName,
        openJobs: r.openJobs,
        doneToday: r.doneToday,
        currentJob: r.currentJob as StaffLive['currentJob'],
        state,
        location: known ? { lat: known.lat, lng: known.lng, accuracy: known.accuracy, at: known.at } : null
      };
    });
  }

  /** Everything the live map shows: staff, open tickets and the team areas. */
  async liveMap(user: AuthUser, areaId?: string): Promise<LiveMap> {
    const [staff, overview, areaRows] = await Promise.all([
      this.live(user, undefined, areaId),
      this.tickets.overview(user, areaId),
      this.db.execute<{ id: string; name: string; geojson: string }>(
        sql`select id, name, ST_AsGeoJSON(boundary) as geojson from areas
            where ${areaId ?? null}::uuid is null or id = ${areaId ?? null}::uuid order by name`
      )
    ]);
    return {
      staff,
      tickets: overview.map,
      areas: areaRows.rows.map((a) => ({
        id: a.id,
        name: a.name,
        boundary: (JSON.parse(a.geojson) as { coordinates: [number, number][][][] }).coordinates
      })),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * How each field staff member worked over the last `days` days, from the ticket history. Times use when things
   * really happened on the phone (offline actions carry their own time); a phone clock behind the server's can make
   * a step look earlier than the one before it, so each duration counts as at least zero.
   */
  async performance(
    user: AuthUser,
    days: number,
    teamId?: string,
    areaId?: string
  ): Promise<StaffPerformance[]> {
    const staff = await this.live(user, teamId, areaId);
    if (staff.length === 0) return [];
    const ids = staff.map((s) => s.id);
    const result = await this.db.execute<{
      user_id: string;
      assigned: number;
      done: number;
      on_time: number | null;
      to_arrive: number | null;
      to_fix: number | null;
      checked: number;
      first_time: number;
      reopened: number;
      declined: number;
    }>(sql`
      with ev as (
        select e.id, e.ticket_id, e.type, e.actor_user_id, e.data, e.created_at,
               coalesce((e.data->>'occurredAt')::timestamptz, e.created_at) as at
        from ticket_events e
        where e.created_at >= now() - make_interval(days => ${days})
      ),
      assigned as (
        select (data->>'assigneeId')::uuid as user_id, count(*)::int as n from ev where type = 'assign' group by 1
      ),
      done as (
        select ev.actor_user_id as user_id, count(*)::int as n,
               avg(case when t.due_at is null then null when ev.at <= t.due_at then 1.0 else 0.0 end) as on_time
        from ev join tickets t on t.id = ev.ticket_id
        where ev.type = 'resolve' group by 1
      ),
      arrive as (
        select s.actor_user_id as user_id, avg(greatest(0, extract(epoch from (s.at - a.at)) / 60)) as mins
        from ev s
        join lateral (
          select coalesce((x.data->>'occurredAt')::timestamptz, x.created_at) as at from ticket_events x
          where x.ticket_id = s.ticket_id and x.type = 'assign'
            and x.data->>'assigneeId' = s.actor_user_id::text and x.created_at <= s.created_at
          order by x.created_at desc limit 1
        ) a on true
        where s.type = 'start' group by 1
      ),
      fix as (
        select r.actor_user_id as user_id, avg(greatest(0, extract(epoch from (r.at - st.at)) / 60)) as mins
        from ev r
        join lateral (
          select coalesce((x.data->>'occurredAt')::timestamptz, x.created_at) as at from ticket_events x
          where x.ticket_id = r.ticket_id and x.type = 'start'
            and x.actor_user_id = r.actor_user_id and x.created_at <= r.created_at
          order by x.created_at desc limit 1
        ) st on true
        where r.type = 'resolve' group by 1
      ),
      outcome as (
        select r.actor_user_id as user_id, r.ticket_id, t.status,
               exists (select 1 from ticket_events o where o.ticket_id = r.ticket_id and o.type = 'reopen'
                       and o.created_at > r.created_at) as reopened
        from ev r join tickets t on t.id = r.ticket_id where r.type = 'resolve'
      ),
      checked as (
        select user_id,
               count(distinct ticket_id) filter (where status = 'closed' or reopened)::int as checked,
               count(distinct ticket_id) filter (where status = 'closed' and not reopened)::int as first_time,
               count(distinct ticket_id) filter (where reopened)::int as reopened
        from outcome group by 1
      ),
      declined as (
        select actor_user_id as user_id, count(*)::int as n from ev where type = 'decline' group by 1
      )
      select u.id as user_id,
             coalesce(assigned.n, 0) as assigned, coalesce(done.n, 0) as done, done.on_time,
             arrive.mins as to_arrive, fix.mins as to_fix,
             coalesce(checked.checked, 0) as checked, coalesce(checked.first_time, 0) as first_time,
             coalesce(checked.reopened, 0) as reopened, coalesce(declined.n, 0) as declined
      from unnest(${sql.raw(`array[${ids.map((id) => `'${id}'`).join(',')}]`)}::uuid[]) as u(id)
      left join assigned on assigned.user_id = u.id
      left join done on done.user_id = u.id
      left join arrive on arrive.user_id = u.id
      left join fix on fix.user_id = u.id
      left join checked on checked.user_id = u.id
      left join declined on declined.user_id = u.id`);
    const byId = new Map(result.rows.map((r) => [r.user_id, r]));
    const round = (v: number | string | null) => (v === null ? null : Math.round(Number(v)));
    return staff.map((s) => {
      const m = byId.get(s.id);
      return {
        ...s,
        jobsAssigned: m?.assigned ?? 0,
        jobsDone: m?.done ?? 0,
        onTimeRate: m?.on_time === null || m?.on_time === undefined ? null : Number(m.on_time),
        avgToArriveMin: round(m?.to_arrive ?? null),
        avgFixMin: round(m?.to_fix ?? null),
        firstTimeFixRate: m && m.checked > 0 ? m.first_time / m.checked : null,
        reopened: m?.reopened ?? 0,
        declined: m?.declined ?? 0
      };
    });
  }
}
