import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { USER_ROLES, type Role } from '@edm/shared';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';

export interface IdentityProfile {
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

/** Accounts in the identity provider (Keycloak). An abstract class so tests can swap in a fake. */
export abstract class IdentityAdmin {
  /** Creates an enabled account and returns its id. Throws USERNAME_TAKEN when the username exists. */
  abstract createUser(profile: IdentityProfile): Promise<string>;
  abstract updateProfile(id: string, profile: Omit<IdentityProfile, 'username'>): Promise<void>;
  /** Sets the account's app roles to exactly `roles`; Keycloak's own roles are left alone. */
  abstract setRoles(id: string, roles: readonly Role[]): Promise<void>;
  /** A temporary password must be changed at the next sign-in. */
  abstract setPassword(id: string, password: string, temporary: boolean): Promise<void>;
  abstract setEnabled(id: string, enabled: boolean): Promise<void>;
  /** Ends all sessions, so a blocked person cannot refresh their token. */
  abstract logout(id: string): Promise<void>;
  abstract findIdByUsername(username: string): Promise<string | null>;
  abstract deleteUser(id: string): Promise<void>;
  /** Whether another system's sign-in client is enabled; null when there is no such client. */
  abstract clientEnabled(clientId: string): Promise<boolean | null>;
}

const unavailable = (detail: string) =>
  new AppError(
    HttpStatus.BAD_GATEWAY,
    'IDENTITY_UNAVAILABLE',
    'The sign-in server did not accept the change',
    {
      detail
    }
  );

/** Keycloak Admin REST API, called with the `edm-api-admin` service account (client credentials). */
@Injectable()
export class KeycloakAdmin extends IdentityAdmin {
  private readonly logger = new Logger(KeycloakAdmin.name);
  private token: { value: string; expiresAt: number } | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  async createUser(p: IdentityProfile): Promise<string> {
    const res = await this.call('POST', '/users', {
      username: p.username,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email ?? undefined,
      emailVerified: !!p.email,
      enabled: true
    });
    if (res.status === 409) {
      throw new AppError(HttpStatus.CONFLICT, 'USERNAME_TAKEN', 'This username or email is already used');
    }
    await this.expectOk(res, 'create user');
    const id = res.headers.get('location')?.split('/').pop();
    if (!id) throw unavailable('create user: no id returned');
    return id;
  }

  async updateProfile(id: string, p: Omit<IdentityProfile, 'username'>): Promise<void> {
    const current = (await (
      await this.expectOk(await this.call('GET', `/users/${id}`), 'read user')
    ).json()) as Record<string, unknown>;
    const res = await this.call('PUT', `/users/${id}`, {
      ...current,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email ?? undefined
    });
    if (res.status === 409)
      throw new AppError(HttpStatus.CONFLICT, 'EMAIL_TAKEN', 'This email is already used');
    await this.expectOk(res, 'update user');
  }

  async setRoles(id: string, roles: readonly Role[]): Promise<void> {
    const path = `/users/${id}/role-mappings/realm`;
    const current = (await (await this.expectOk(await this.call('GET', path), 'read roles')).json()) as {
      name: string;
    }[];
    const managed = USER_ROLES as readonly string[];
    const remove = current.filter((r) => managed.includes(r.name) && !roles.includes(r.name as Role));
    const add = [];
    for (const name of roles.filter((r) => !current.some((c) => c.name === r))) {
      add.push(
        await (await this.expectOk(await this.call('GET', `/roles/${name}`), `read role ${name}`)).json()
      );
    }
    if (remove.length) await this.expectOk(await this.call('DELETE', path, remove), 'remove roles');
    if (add.length) await this.expectOk(await this.call('POST', path, add), 'add roles');
  }

  async setPassword(id: string, password: string, temporary: boolean): Promise<void> {
    await this.expectOk(
      await this.call('PUT', `/users/${id}/reset-password`, { type: 'password', value: password, temporary }),
      'set password'
    );
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = (await (
      await this.expectOk(await this.call('GET', `/users/${id}`), 'read user')
    ).json()) as Record<string, unknown>;
    await this.expectOk(
      await this.call('PUT', `/users/${id}`, { ...current, enabled }),
      'enable/disable user'
    );
  }

  async logout(id: string): Promise<void> {
    await this.expectOk(await this.call('POST', `/users/${id}/logout`), 'log out user');
  }

  async findIdByUsername(username: string): Promise<string | null> {
    const res = await this.call('GET', `/users?exact=true&username=${encodeURIComponent(username)}`);
    const rows = (await (await this.expectOk(res, 'find user')).json()) as { id: string }[];
    return rows[0]?.id ?? null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.expectOk(await this.call('DELETE', `/users/${id}`), 'delete user');
  }

  async clientEnabled(clientId: string): Promise<boolean | null> {
    const res = await this.call('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
    const rows = (await (await this.expectOk(res, 'find client')).json()) as { enabled: boolean }[];
    return rows[0]?.enabled ?? null;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const url = `${this.env.KEYCLOAK_URL}/admin/realms/${this.env.KEYCLOAK_REALM}${path}`;
    try {
      return await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw unavailable(`${method} ${path}: ${(err as Error).message}`);
    }
  }

  private async expectOk(res: Response, what: string): Promise<Response> {
    if (res.ok) return res;
    const text = await res.text().catch(() => '');
    this.logger.error(`Keycloak ${what} failed: ${res.status} ${text}`);
    if (res.status === 404)
      throw new AppError(HttpStatus.NOT_FOUND, 'IDENTITY_NOT_FOUND', 'Account not found');
    if (res.status === 400) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IDENTITY_REJECTED',
        'The sign-in server refused the value',
        {
          detail: text
        }
      );
    }
    throw unavailable(`${what}: ${res.status}`);
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const secret = this.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
    if (!secret) {
      throw new AppError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'IDENTITY_NOT_CONFIGURED',
        'Account management is not set up (KEYCLOAK_ADMIN_CLIENT_SECRET)'
      );
    }
    let res: Response;
    try {
      res = await fetch(
        `${this.env.KEYCLOAK_URL}/realms/${this.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.env.KEYCLOAK_ADMIN_CLIENT_ID,
            client_secret: secret
          })
        }
      );
    } catch (err) {
      throw unavailable(`token: ${(err as Error).message}`);
    }
    if (!res.ok) throw unavailable(`token: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }
}
