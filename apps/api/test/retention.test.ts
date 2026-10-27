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

    expect(await t.app.get(RetentionService).run()).toEqual({ integration_calls: 1, user_notifications: 1 });
    expect((await t.db.select().from(userNotifications)).map((n) => n.title)).toEqual(['New']);
    expect(await t.db.select().from(integrationCalls)).toHaveLength(1);
  });
});
