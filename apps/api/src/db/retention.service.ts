import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from './db.module';

const EVERY_HOUR = 60 * 60 * 1000;
/** Rows removed per statement, so a big clean-up (after a long storm) never locks a table for long. */
const BATCH = 5_000;

/**
 * Removes records that are only useful for a while: the integration log behind the Connected systems screen, the
 * alerts under the bell, and where field staff have been (the privacy policy promises this limit). Tickets, their
 * history and stock movements are never removed.
 */
@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.RUN_WORKERS) return;
    this.timer = setInterval(() => void this.run(), EVERY_HOUR).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many rows went from each table. */
  async run(): Promise<Record<string, number>> {
    const removed: Record<string, number> = {};
    for (const [table, clean] of [
      ['integration_calls', () => this.olderThan('integration_calls', this.env.INTEGRATION_LOG_DAYS)],
      ['user_notifications', () => this.olderThan('user_notifications', this.env.NOTIFICATION_DAYS)],
      ['staff_locations', () => this.locationsOlderThan(this.env.LOCATION_HISTORY_DAYS)]
    ] as const) {
      try {
        removed[table] = await clean();
      } catch (err) {
        this.logger.warn(`Could not clean up ${table}: ${(err as Error).message}`);
      }
    }
    return removed;
  }

  private olderThan(table: string, days: number): Promise<number> {
    const name = sql.identifier(table);
    return this.inBatches(
      sql`delete from ${name} where id in (
        select id from ${name} where created_at < now() - make_interval(days => ${days}) limit ${BATCH})`
    );
  }

  /** staff_locations has no id column and is dated by when the phone recorded the point. */
  private locationsOlderThan(days: number): Promise<number> {
    return this.inBatches(
      sql`delete from staff_locations where (user_id, recorded_at) in (
        select user_id, recorded_at from staff_locations
        where recorded_at < now() - make_interval(days => ${days}) limit ${BATCH})`
    );
  }

  private async inBatches(statement: SQL): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.db.execute(statement);
      total += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) < BATCH) return total;
    }
  }
}
