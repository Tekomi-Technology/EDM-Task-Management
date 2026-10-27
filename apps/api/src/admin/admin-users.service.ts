import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminUser, CreateUser, Role, TeamView, UpdateUser, UserListQuery } from '@edm/shared';
import { and, arrayContains, asc, eq, ilike, or } from 'drizzle-orm';
import { randomInt } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { areas, teams, users } from '../db/schema';
import { IdentityAdmin } from './identity-admin';

/** Roles whose holders belong to a team. */
const TEAM_ROLES: readonly Role[] = ['field_staff', 'team_manager'];

const columns = {
  id: users.id,
  keycloakSub: users.keycloakSub,
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

/** "Ana Maria Cossa" → first "Ana Maria", last "Cossa", as Keycloak keeps them apart. */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return parts.length > 1
    ? { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
    : { firstName: parts[0], lastName: parts[0] };
}

/** 12 characters with upper and lower case letters and digits; avoids look-alike characters. */
export function temporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: 9 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Account management for admins. Keycloak holds sign-in and roles; the users table mirrors them. */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly identity: IdentityAdmin
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

  /** Creates the Keycloak account and the user row; returns a temporary password to give to the person once. */
  async create(input: CreateUser): Promise<{ user: AdminUser; temporaryPassword: string }> {
    const teamId = input.teamId ?? null;
    await this.checkTeam(input.roles, teamId);
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.username));
    if (taken) throw new AppError(HttpStatus.CONFLICT, 'USERNAME_TAKEN', 'This username is already used');

    const password = temporaryPassword();
    const keycloakId = await this.identity.createUser({
      username: input.username,
      ...splitName(input.fullName),
      email: input.email ?? null
    });
    try {
      await this.identity.setRoles(keycloakId, input.roles);
      await this.identity.setPassword(keycloakId, password, true);
      const [row] = await this.db
        .insert(users)
        .values({
          keycloakSub: keycloakId,
          username: input.username,
          fullName: input.fullName,
          email: input.email ?? null,
          phone: input.phone ?? null,
          roles: input.roles,
          teamId
        })
        .returning({ id: users.id });
      return { user: await this.get(row.id), temporaryPassword: password };
    } catch (err) {
      // Do not leave a half-made account that can sign in without a matching row.
      await this.identity.deleteUser(keycloakId).catch((e: Error) => {
        this.logger.error(
          `Could not remove Keycloak account ${keycloakId} after a failed create: ${e.message}`
        );
      });
      throw err;
    }
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

    const keycloakId = await this.keycloakId(row);
    const fullName = input.fullName ?? row.fullName;
    const email = input.email === undefined ? row.email : input.email;
    if (fullName !== row.fullName || email !== row.email) {
      await this.identity.updateProfile(keycloakId, { ...splitName(fullName), email });
    }
    const rolesChanged = [...roles].sort().join(',') !== [...row.roles].sort().join(',');
    if (rolesChanged) {
      await this.identity.setRoles(keycloakId, roles);
      // Sessions carry the old roles; signing the person out makes the new ones apply at the next sign-in.
      await this.identity.logout(keycloakId);
    }

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
    await this.identity.setPassword(await this.keycloakId(row), password, true);
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
    await this.disable(row);
    await this.setStatus(id, 'blocked');
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
    await this.identity.setEnabled(await this.keycloakId(row), true);
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
    if (row.status === 'active') await this.disable(row);
    await this.setStatus(id, 'cancelled');
    return this.get(id);
  }

  private async disable(row: Row): Promise<void> {
    const keycloakId = await this.keycloakId(row);
    await this.identity.setEnabled(keycloakId, false);
    await this.identity.logout(keycloakId);
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

  /** Accounts made in Keycloak before they ever signed in have no stored id yet; look them up by username. */
  private async keycloakId(row: Row): Promise<string> {
    if (row.keycloakSub) return row.keycloakSub;
    const id = await this.identity.findIdByUsername(row.username);
    if (!id)
      throw new AppError(HttpStatus.CONFLICT, 'IDENTITY_NOT_FOUND', 'This person has no sign-in account');
    await this.db.update(users).set({ keycloakSub: id }).where(eq(users.id, row.id));
    return id;
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
