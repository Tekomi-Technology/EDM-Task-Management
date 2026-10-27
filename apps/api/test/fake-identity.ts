import { HttpStatus } from '@nestjs/common';
import type { Role } from '@edm/shared';
import { randomUUID } from 'node:crypto';
import { IdentityAdmin, type IdentityProfile } from '../src/admin/identity-admin';
import { AppError } from '../src/common/errors';
import { SEED_USERS } from '../src/db/seed-data';

interface FakeAccount extends IdentityProfile {
  id: string;
  roles: Role[];
  enabled: boolean;
  password: { value: string; temporary: boolean } | null;
  logouts: number;
}

/** In-memory stand-in for Keycloak, so account tests run without it. Starts with the seed accounts. */
export class FakeIdentityAdmin extends IdentityAdmin {
  accounts = new Map<string, FakeAccount>();
  /** Set to make the next call fail, to test that a failed create leaves nothing behind. */
  failNext: string | null = null;

  constructor() {
    super();
    this.reset();
  }

  reset(): void {
    this.accounts.clear();
    this.failNext = null;
    for (const u of SEED_USERS) {
      const [firstName, ...rest] = u.fullName.split(' ');
      this.accounts.set(u.id, {
        id: u.id,
        username: u.username,
        firstName,
        lastName: rest.join(' '),
        email: null,
        roles: [...u.roles],
        enabled: true,
        password: null,
        logouts: 0
      });
    }
  }

  private maybeFail(op: string): void {
    if (this.failNext === op) {
      this.failNext = null;
      throw new AppError(HttpStatus.BAD_GATEWAY, 'IDENTITY_UNAVAILABLE', `fake ${op} failure`);
    }
  }

  private get(id: string): FakeAccount {
    const a = this.accounts.get(id);
    if (!a) throw new AppError(HttpStatus.NOT_FOUND, 'IDENTITY_NOT_FOUND', 'Account not found');
    return a;
  }

  async createUser(p: IdentityProfile): Promise<string> {
    this.maybeFail('createUser');
    if ([...this.accounts.values()].some((a) => a.username === p.username)) {
      throw new AppError(HttpStatus.CONFLICT, 'USERNAME_TAKEN', 'This username or email is already used');
    }
    const id = randomUUID();
    this.accounts.set(id, { ...p, id, roles: [], enabled: true, password: null, logouts: 0 });
    return id;
  }

  async updateProfile(id: string, p: Omit<IdentityProfile, 'username'>): Promise<void> {
    Object.assign(this.get(id), p);
  }

  async setRoles(id: string, roles: readonly Role[]): Promise<void> {
    this.maybeFail('setRoles');
    this.get(id).roles = [...roles];
  }

  async setPassword(id: string, value: string, temporary: boolean): Promise<void> {
    this.get(id).password = { value, temporary };
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    this.get(id).enabled = enabled;
  }

  async logout(id: string): Promise<void> {
    this.get(id).logouts++;
  }

  async findIdByUsername(username: string): Promise<string | null> {
    return [...this.accounts.values()].find((a) => a.username === username)?.id ?? null;
  }

  async deleteUser(id: string): Promise<void> {
    this.accounts.delete(id);
  }

  /** Clients of the other systems; tests switch one off to see the Connected systems screen notice. */
  clients = new Map<string, boolean>([
    ['call-center-system', true],
    ['sales-system', true],
    ['nms-system', true],
    ['stock-system', true]
  ]);

  async clientEnabled(clientId: string): Promise<boolean | null> {
    return this.clients.get(clientId) ?? null;
  }
}
