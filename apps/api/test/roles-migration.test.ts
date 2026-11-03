import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inArray, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '../src/db/schema';
import { createTestApp, resetData, type TestContext } from './helpers';

const MIGRATION = readFileSync(join(__dirname, '../drizzle/0018_four_roles.sql'), 'utf8');

describe('four roles: rewriting the roles people already have', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  it('turns NOC into operations supervisor, drops the network team and BO support, and keeps each account', async () => {
    const before: [string, string[], 'active' | 'blocked'][] = [
      ['m.noc', ['noc'], 'active'],
      ['m.both', ['noc', 'technical_manager'], 'active'],
      ['m.bo', ['bo_support'], 'blocked'],
      ['m.net', ['network_team', 'team_manager'], 'active']
    ];
    await t.db
      .insert(users)
      .values(
        before.map(([username, roles, status]) => ({ username, fullName: username, roles, status })) as never
      );

    for (const statement of MIGRATION.split('--> statement-breakpoint')) {
      if (statement.trim()) await t.db.execute(sql.raw(statement));
    }

    const after = await t.db
      .select({ username: users.username, roles: users.roles, status: users.status })
      .from(users)
      .where(
        inArray(
          users.username,
          before.map(([u]) => u)
        )
      );
    const byName = Object.fromEntries(after.map((u) => [u.username, u]));
    expect(byName['m.noc']).toEqual({ username: 'm.noc', roles: ['technical_manager'], status: 'active' });
    expect(byName['m.both']).toEqual({ username: 'm.both', roles: ['technical_manager'], status: 'active' });
    expect(byName['m.bo']).toEqual({ username: 'm.bo', roles: [], status: 'blocked' });
    expect(byName['m.net']).toEqual({ username: 'm.net', roles: ['team_manager'], status: 'active' });
  });
});
