import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { AdminUser, CreateUser, Role, TeamView, UpdateUser, UserListQuery } from '../contract';
import { and, arrayContains, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/auth-user';
import { AuthService } from '../auth/auth.service';
import { hashPassword, temporaryPassword } from '../auth/passwords';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { areas, teams, users } from '../db/schema';

/** Roles whose holders belong to a team. */
const TEAM_ROLES: readonly Role[] = ['field_staff', 'team_manager'];

const columns = {
  id: users.id,
  username: users.username,
  fullName: users.fullName,
  email: users.email,
  phone: users.phone,
  roles: users.roles,
  teamId: users.teamId,
  teamName: teams.name,
  areaName: areas.name,
  status: users.status,
  onDuty: users.onDuty,
  lastSeenAt: users.lastSeenAt,
  createdAt: users.createdAt
};
type Row = Awaited<ReturnType<AdminUsersService['rows']>>[number];

function toView(r: Row): AdminUser {
  return {
    id: r.id,
    username: r.username,
    fullName: r.fullName,
    email: r.email,
    phone: r.phone,
    roles: r.roles,
    teamId: r.teamId,
    teamName: r.teamName,
    areaName: r.areaName,
    status: r.status,
    onDuty: r.onDuty,
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString()
  };
}

/** Account management for admins: accounts, roles, teams and passwords all live in the users table. */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService
  ) {}

  async list(q: UserListQuery): Promise<AdminUser[]> {
    const search = q.search ? `%${q.search.replace(/[%_\\]/g, '\\$&')}%` : undefined;
    const rows = await this.rows(
      and(
        search
          ? or(ilike(users.fullName, search), ilike(users.username, search), ilike(users.phone, search))
          : undefined,
        q.role ? arrayContains(users.roles, [q.role]) : undefined,
        q.status ? eq(users.status, q.status) : undefined
      )
    );
    return rows.map(toView);
  }

  async teams(): Promise<TeamView[]> {
    return this.db
      .select({ id: teams.id, code: teams.code, name: teams.name, areaName: areas.name })
      .from(teams)
      .innerJoin(areas, eq(areas.id, teams.areaId))
      .orderBy(asc(teams.name));
  }

  /** Creates the account with a temporary password, given to the person once; they choose their own at first sign-in. */
  async create(input: CreateUser): Promise<{ user: AdminUser; temporaryPassword: string }> {
    const teamId = input.teamId ?? null;
    await this.checkTeam(input.roles, teamId);
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${input.username.toLowerCase()}`);
    if (taken) throw new AppError(HttpStatus.CONFLICT, 'USERNAME_TAKEN', 'This username is already used');

    const password = temporaryPassword();
    const [row] = await this.db
      .insert(users)
      .values({
        username: input.username,
        fullName: input.fullName,
        email: input.email ?? null,
        phone: input.phone ?? null,
        roles: input.roles,
        teamId,
        passwordHash: await hashPassword(password),
        mustChangePassword: true
      })
      .returning({ id: users.id });
    return { user: await this.get(row!.id), temporaryPassword: password };
  }

  async update(id: string, input: UpdateUser, actor: AuthUser): Promise<AdminUser> {
    const row = await this.getRow(id);
    if (row.status === 'cancelled') {
      throw new AppError(HttpStatus.CONFLICT, 'ACCOUNT_CANCELLED', 'A cancelled account cannot be changed');
    }
    const roles = input.roles ?? (row.roles as Role[]);
    const teamId = input.teamId === undefined ? row.teamId : input.teamId;
    if (id === actor.userId && !roles.includes('admin')) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CANNOT_CHANGE_SELF',
        'You cannot remove your own admin role'
      );
    }
    await this.checkTeam(roles, teamId);

    // Roles are read on every request, so the change applies at once without signing the person out.
    const fullName = input.fullName ?? row.fullName;
    const email = input.email === undefined ? row.email : input.email;
    await this.db
      .update(users)
      .set({
        fullName,
        email,
        phone: input.phone === undefined ? row.phone : input.phone,
        roles,
        teamId,
        onDuty: roles.includes('field_staff') ? undefined : false,
        updatedAt: new Date()
      })
      .where(eq(users.id, id));
    return this.get(id);
  }

  async resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    const row = await this.getRow(id);
    if (row.status === 'cancelled') {
      throw new AppError(HttpStatus.CONFLICT, 'ACCOUNT_CANCELLED', 'A cancelled account cannot be changed');
    }
    const password = temporaryPassword();
    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        failedSignIns: 0,
        lockedUntil: null,
        updatedAt: new Date()
      })
      .where(eq(users.id, id));
    await this.auth.endSessions(id);
    return { temporaryPassword: password };
  }

  /** Stops the person signing in, ends their sessions and takes them off duty. Can be undone with unblock. */
  async block(id: string, actor: AuthUser): Promise<AdminUser> {
    const row = await this.getRow(id);
    this.notSelf(id, actor);
    if (row.status !== 'active') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'INVALID_ACCOUNT_STATUS',
        `The account is already ${row.status}`
      );
    }
    await this.setStatus(id, 'blocked');
    await this.auth.endSessions(id);
    return this.get(id);
  }

  async unblock(id: string): Promise<AdminUser> {
    const row = await this.getRow(id);
    if (row.status !== 'blocked') {
      throw new AppError(
        HttpStatus.CONFLICT,
        'INVALID_ACCOUNT_STATUS',
        `Only blocked accounts can be unblocked`
      );
    }
    await this.setStatus(id, 'active');
    return this.get(id);
  }

  /** For people who left: the account is disabled for good, but kept so ticket history still shows the name. */
  async cancel(id: string, actor: AuthUser): Promise<AdminUser> {
    const row = await this.getRow(id);
    this.notSelf(id, actor);
    if (row.status === 'cancelled') {
      throw new AppError(HttpStatus.CONFLICT, 'INVALID_ACCOUNT_STATUS', 'The account is already cancelled');
    }
    await this.setStatus(id, 'cancelled');
    await this.auth.endSessions(id);
    return this.get(id);
  }

  private async setStatus(id: string, status: 'active' | 'blocked' | 'cancelled'): Promise<void> {
    await this.db
      .update(users)
      .set({ status, ...(status === 'active' ? {} : { onDuty: false }), updatedAt: new Date() })
      .where(eq(users.id, id));
  }

  private notSelf(id: string, actor: AuthUser): void {
    if (id === actor.userId) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'CANNOT_CHANGE_SELF',
        'You cannot block or cancel your own account'
      );
    }
  }

  private async checkTeam(roles: readonly Role[], teamId: string | null): Promise<void> {
    if (!teamId) {
      if (roles.some((r) => TEAM_ROLES.includes(r))) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'TEAM_REQUIRED',
          'Field staff and team managers need a team'
        );
      }
      return;
    }
    const [team] = await this.db.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId));
    if (!team) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TEAM_NOT_FOUND', 'Team not found');
  }

  private rows(where?: ReturnType<typeof and>) {
    return this.db
      .select(columns)
      .from(users)
      .leftJoin(teams, eq(teams.id, users.teamId))
      .leftJoin(areas, eq(areas.id, teams.areaId))
      .where(where)
      .orderBy(asc(users.fullName));
  }

  private async getRow(id: string): Promise<Row> {
    const [row] = await this.rows(eq(users.id, id));
    if (!row) throw notFound('User');
    return row;
  }

  private async get(id: string): Promise<AdminUser> {
    return toView(await this.getRow(id));
  }
}
