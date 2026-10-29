import { Inject, Injectable } from '@nestjs/common';
import { API_KEY_ROLE, type ApiKeyView, type CreateApiKey, type CreatedApiKey } from '../contract';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { notFound } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { apiKeys, users } from '../db/schema';
import type { AuthUser } from './auth-user';
import { randomToken, sha256 } from './tokens';

/** Keys start with this, so the API tells them apart from sign-in tokens (and people recognise them). */
export const API_KEY_PREFIX = 'edm_';

const creator = alias(users, 'creator');
const columns = {
  id: apiKeys.id,
  system: apiKeys.system,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  createdAt: apiKeys.createdAt,
  createdByName: creator.fullName,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt
};

const toView = (r: {
  id: string;
  system: ApiKeyView['system'];
  name: string;
  prefix: string;
  createdAt: Date;
  createdByName: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}): ApiKeyView => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  revokedAt: r.revokedAt?.toISOString() ?? null
});

/**
 * Admin area → API keys: the Call Center, Sales, NMS and stock systems call the API with a key made here. Only a hash
 * is kept, so a lost key cannot be shown again: make a new one and revoke the old.
 */
@Injectable()
export class ApiKeysService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(): Promise<ApiKeyView[]> {
    const rows = await this.db
      .select(columns)
      .from(apiKeys)
      .leftJoin(creator, eq(creator.id, apiKeys.createdBy))
      .orderBy(sql`${apiKeys.revokedAt} is not null`, desc(apiKeys.createdAt));
    return rows.map(toView);
  }

  async create(input: CreateApiKey, actor: AuthUser): Promise<CreatedApiKey> {
    const key = `${API_KEY_PREFIX}${randomToken(30)}`;
    const [row] = await this.db
      .insert(apiKeys)
      .values({
        system: input.system,
        name: input.name,
        prefix: key.slice(0, 12),
        keyHash: sha256(key),
        createdBy: actor.userId
      })
      .returning({ id: apiKeys.id });
    return { apiKey: await this.get(row!.id), key };
  }

  /** The key stops working at once. */
  async revoke(id: string): Promise<ApiKeyView> {
    await this.get(id);
    await this.db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
    return this.get(id);
  }

  /** The system calling with this key, or null for an unknown or revoked key. */
  async authenticate(key: string): Promise<AuthUser | null> {
    const [row] = await this.db
      .select({ id: apiKeys.id, system: apiKeys.system, name: apiKeys.name, lastUsedAt: apiKeys.lastUsedAt })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)));
    if (!row) return null;
    // Shown in the admin area; written at most once a minute.
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      void this.db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, row.id))
        .catch(() => undefined);
    }
    return {
      sub: `api-key:${row.id}`,
      username: row.name,
      fullName: row.name,
      roles: [API_KEY_ROLE[row.system]],
      userId: null,
      teamId: null,
      onDuty: false,
      isIntegration: true,
      sessionId: null
    };
  }

  private async get(id: string): Promise<ApiKeyView> {
    const [row] = await this.db
      .select(columns)
      .from(apiKeys)
      .leftJoin(creator, eq(creator.id, apiKeys.createdBy))
      .where(eq(apiKeys.id, id));
    if (!row) throw notFound('API key');
    return toView(row);
  }
}
