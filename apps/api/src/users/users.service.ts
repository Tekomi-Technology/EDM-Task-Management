import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { OPEN_JOB_STATUSES, type Role, type StaffMember, type StaffSuggestion } from '../contract';
import { and, arrayContains, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, type Db, type Tx } from '../db/db.module';
import { ticketEvents } from '../db/partitioned';
import { teams, tickets, users } from '../db/schema';
import { LocationService } from '../location/location.service';

export interface UserRow {
  id: string;
  fullName: string;
  teamId: string | null;
  phone: string | null;
  roles: string[];
  status: 'active' | 'blocked' | 'cancelled';
  onDuty: boolean;
}

/** Someone in the office to alert: in the web app always, by SMS when they have a phone. */
export interface OfficeRecipient {
  id: string;
  phone: string | null;
}

const columns = {
  id: users.id,
  fullName: users.fullName,
  teamId: users.teamId,
  phone: users.phone,
  roles: users.roles,
  status: users.status,
  onDuty: users.onDuty
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The outer row's user id, written out with its table: in single-table queries Drizzle leaves columns
 * unqualified, and inside these sub-queries a bare "id" would mean the ticket's or event's own id.
 */
const OUTER_USER_ID = sql.raw('"users"."id"');

const doneToday = (userId: unknown) => sql<number>`(
  select count(*)::int from ${ticketEvents}
  where ${ticketEvents.actorUserId} = ${userId} and ${ticketEvents.type} = 'resolve'
  and ${ticketEvents.createdAt} >= (date_trunc('day', now() at time zone 'Africa/Maputo') at time zone 'Africa/Maputo')
)`;

/** Number of jobs a staff member is still holding (assigned, accepted, being fixed or paused). */
const openJobs = sql<number>`(
  select count(*)::int from ${tickets}
  where ${tickets.assigneeId} = ${OUTER_USER_ID}
  and ${inArray(tickets.status, [...OPEN_JOB_STATUSES])}
)`;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly locations: LocationService
  ) {}

  /**
   * Finds the user row for a Keycloak account, linking a pre-created row by username or creating one.
   * Read on every request (one indexed lookup) so team and account changes apply at once; written only when
   * roles change. Blocked or cancelled accounts are refused even while an older token is still valid.
   */
  async ensureFromToken(t: {
    sub: string;
    username: string;
    fullName: string;
    roles: Role[];
  }): Promise<UserRow> {
    const key = [...t.roles].sort().join(',');
    let [row] = await this.db.select(columns).from(users).where(eq(users.keycloakSub, t.sub));
    if (!row) {
      [row] = await this.db
        .update(users)
        .set({ keycloakSub: t.sub, updatedAt: new Date() })
        .where(and(eq(users.username, t.username), isNull(users.keycloakSub)))
        .returning(columns);
    }
    if (!row) {
      [row] = await this.db
        .insert(users)
        .values({ keycloakSub: t.sub, username: t.username, fullName: t.fullName, roles: t.roles })
        .onConflictDoNothing()
        .returning(columns);
      if (!row) [row] = await this.db.select(columns).from(users).where(eq(users.keycloakSub, t.sub));
    }
    // Remember when people last used the system, without writing on every request.
    void this.db
      .update(users)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(users.id, row.id),
          sql`(${users.lastSeenAt} is null or ${users.lastSeenAt} < now() - interval '1 hour')`
        )
      )
      .catch(() => undefined);
    if (row.status !== 'active') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_DISABLED',
        'This account has been blocked or cancelled'
      );
    }
    if ([...row.roles].sort().join(',') !== key) {
      [row] = await this.db
        .update(users)
        .set({ roles: t.roles, updatedAt: new Date() })
        .where(eq(users.id, row.id))
        .returning(columns);
    }
    return row;
  }

  async findById(id: string, db: Db | Tx = this.db): Promise<UserRow | undefined> {
    const [row] = await db.select(columns).from(users).where(eq(users.id, id));
    return row;
  }

  /** Field staff of a team with how many unfinished jobs each one has. */
  async teamStaff(teamId: string): Promise<StaffMember[]> {
    return this.db
      .select({ id: users.id, fullName: users.fullName, phone: users.phone, onDuty: users.onDuty, openJobs })
      .from(users)
      .where(
        and(eq(users.teamId, teamId), eq(users.status, 'active'), arrayContains(users.roles, ['field_staff']))
      )
      .orderBy(users.fullName);
  }

  /**
   * Field staff who can take a ticket of this team, best choice first: the same order automatic assignment uses
   * (on duty, fewest unfinished jobs, longest since last assignment).
   */
  async suggestions(
    teamId: string,
    near: { lat: number; lng: number } | null = null
  ): Promise<StaffSuggestion[]> {
    const rows = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        phone: users.phone,
        onDuty: users.onDuty,
        openJobs,
        doneToday: doneToday(OUTER_USER_ID),
        lastAssignedAt: users.lastAssignedAt
      })
      .from(users)
      .where(
        and(eq(users.teamId, teamId), eq(users.status, 'active'), arrayContains(users.roles, ['field_staff']))
      );
    const positions = await this.locations.latest(rows.map((r) => r.id));
    const distances = near
      ? await this.distances(
          this.db,
          rows.map((r) => r.id),
          near
        )
      : new Map<string, number>();
    return rows
      .map(({ lastAssignedAt, ...r }) => ({
        ...r,
        lastAssignedAt,
        distanceM: distances.get(r.id) ?? null,
        locationAt: positions.get(r.id)?.at ?? null
      }))
      .sort(
        (a, b) =>
          Number(b.onDuty) - Number(a.onDuty) ||
          a.openJobs - b.openJobs ||
          (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
          (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) ||
          a.fullName.localeCompare(b.fullName)
      )
      .map((r, i) => ({
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        onDuty: r.onDuty,
        openJobs: r.openJobs,
        doneToday: r.doneToday,
        distanceM: r.distanceM,
        locationAt: r.locationAt,
        bestMatch: i === 0 && r.onDuty
      }));
  }

  /** Jobs a staff member reported done today (Mozambique time). */
  async doneToday(userId: string): Promise<number> {
    const result = await this.db.execute<{ n: number }>(sql`select ${doneToday(sql`${userId}::uuid`)} as n`);
    return result.rows[0]?.n ?? 0;
  }

  async teamName(teamId: string | null): Promise<string | null> {
    if (!teamId) return null;
    const [row] = await this.db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId));
    return row?.name ?? null;
  }

  async setDuty(userId: string, onDuty: boolean): Promise<void> {
    await this.db.update(users).set({ onDuty, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  /**
   * Who should get a job automatically: active field staff of the team who are on duty, fewest unfinished jobs
   * first, then whoever has waited longest since their last assignment.
   */
  async pickAutoAssignee(
    tx: Tx,
    teamId: string,
    excludeIds: string[],
    near: { lat: number; lng: number } | null = null
  ): Promise<(UserRow & { distanceM: number | null }) | undefined> {
    const rows = await tx
      .select({ ...columns, openJobs, lastAssignedAt: users.lastAssignedAt })
      .from(users)
      .where(
        and(
          eq(users.teamId, teamId),
          eq(users.status, 'active'),
          eq(users.onDuty, true),
          arrayContains(users.roles, ['field_staff']),
          excludeIds.length ? notInArray(users.id, excludeIds) : undefined
        )
      );
    if (rows.length === 0) return undefined;
    const distances = near
      ? await this.distances(
          tx,
          rows.map((r) => r.id),
          near
        )
      : new Map<string, number>();
    const ranked = rows
      .map((r) => ({ ...r, distanceM: distances.get(r.id) ?? null }))
      .sort(
        (a, b) =>
          a.openJobs - b.openJobs ||
          (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
          (a.lastAssignedAt?.getTime() ?? 0) - (b.lastAssignedAt?.getTime() ?? 0) ||
          a.fullName.localeCompare(b.fullName)
      );
    const best = ranked[0]!;
    return {
      id: best.id,
      fullName: best.fullName,
      teamId: best.teamId,
      phone: best.phone,
      roles: best.roles,
      status: best.status,
      onDuty: best.onDuty,
      distanceM: best.distanceM
    };
  }

  /**
   * Metres from each person's last known position (if recent) to a point, measured by PostGIS on the globe.
   * Positions come from Redis via LocationService.
   */
  async distances(
    db: Db | Tx,
    userIds: string[],
    near: { lat: number; lng: number }
  ): Promise<Map<string, number>> {
    const positions = await this.locations.latest(userIds);
    // Ids come from the database and positions are parsed numbers, but check anyway before building SQL.
    const known = userIds.filter((id) => UUID.test(id) && positions.get(id)?.fresh);
    if (known.length === 0) return new Map();
    const result = await db.execute<{ id: string; m: number }>(sql`
      select p.id, ST_Distance(
        ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${near.lng}, ${near.lat}), 4326)::geography
      ) as m
      from unnest(
        ${sql.raw(`array[${known.map((id) => `'${id}'`).join(',')}]`)}::uuid[],
        ${sql.raw(`array[${known.map((id) => positions.get(id)!.lat).join(',')}]`)}::float8[],
        ${sql.raw(`array[${known.map((id) => positions.get(id)!.lng).join(',')}]`)}::float8[]
      ) as p(id, lat, lng)`);
    return new Map(result.rows.map((r) => [r.id, Math.round(Number(r.m))]));
  }

  /** Active people with a role (e.g. NOC, technical managers), to alert by SMS and in the web app. */
  withRole(role: Role, db: Db | Tx = this.db): Promise<OfficeRecipient[]> {
    return db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(and(arrayContains(users.roles, [role]), eq(users.status, 'active')));
  }

  async markAssigned(tx: Tx, userId: string): Promise<void> {
    await tx.update(users).set({ lastAssignedAt: new Date() }).where(eq(users.id, userId));
  }

  /** The managers of a team, to alert by SMS and in the web app. */
  teamManagers(teamId: string, db: Db | Tx = this.db): Promise<OfficeRecipient[]> {
    return db
      .select({ id: users.id, phone: users.phone })
      .from(users)
      .where(
        and(
          eq(users.teamId, teamId),
          arrayContains(users.roles, ['team_manager']),
          eq(users.status, 'active')
        )
      );
  }

  assertTeamMember(user: UserRow | undefined, teamId: string | null): asserts user is UserRow {
    if (
      !user ||
      !teamId ||
      user.teamId !== teamId ||
      user.status !== 'active' ||
      !user.roles.includes('field_staff')
    ) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ASSIGNEE_NOT_IN_TEAM',
        'This person is not active field staff in the ticket’s team'
      );
    }
  }
}
