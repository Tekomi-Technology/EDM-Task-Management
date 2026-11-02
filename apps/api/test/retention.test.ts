import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { RetentionService } from '../src/db/retention.service';
import { integrationCalls, userNotifications } from '../src/db/schema';
import { createTestApp, ids, resetData, type TestContext } from './helpers';

describe('clean-up of short-lived records', () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetData(t.db));

  it('removes log rows and bell alerts older than the configured days, and keeps the rest', async () => {
    const old = sql`now() - interval '91 days'`;
    await t.db.insert(integrationCalls).values([
      {
        system: 'nms',
        direction: 'in',
        operation: 'POST /intake/nms/alarms',
        ok: true,
        durationMs: 5,
        createdAt: old
      },
      { system: 'nms', direction: 'in', operation: 'POST /intake/nms/alarms', ok: true, durationMs: 5 }
    ] as never);
    await t.db.insert(userNotifications).values([
      { userId: ids['helena.mondlane'], title: 'Old', createdAt: old },
      { userId: ids['helena.mondlane'], title: 'New' }
    ] as never);

    // Partitions only start at last month, so the old point needs its own.
    await t.db.execute(sql`
      create table if not exists staff_locations_retention_test partition of staff_locations
      for values from ('2000-01-01') to ('2000-02-01')`);
    await t.db.execute(sql`
      insert into staff_locations (user_id, recorded_at, location) values
        (${ids['helena.mondlane']}, '2000-01-15', ST_SetSRID(ST_MakePoint(32.5, -25.9), 4326)),
        (${ids['helena.mondlane']}, now(), ST_SetSRID(ST_MakePoint(32.5, -25.9), 4326))`);

    expect(await t.app.get(RetentionService).run()).toEqual({
      integration_calls: 1,
      user_notifications: 1,
      staff_locations: 1
    });
    const left = await t.db.execute(sql`select recorded_at from staff_locations`);
    expect(left.rows).toHaveLength(1);
    expect(new Date(left.rows[0]!.recorded_at as string).getFullYear()).toBeGreaterThan(2000);
    expect((await t.db.select().from(userNotifications)).map((n) => n.title)).toEqual(['New']);
    expect(await t.db.select().from(integrationCalls)).toHaveLength(1);
  });
});
