import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from './db.module';

const EVERY_HOUR = 60 * 60 * 1000;
/** Rows removed per statement, so a big clean-up (after a long storm) never locks a table for long. */
const BATCH = 5_000;

/**
 * Removes records that are only useful for a while: the integration log behind the Connected systems screen and
 * the alerts under the bell. Tickets, their history and stock movements are never removed.
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
    for (const [table, days] of [
      ['integration_calls', this.env.INTEGRATION_LOG_DAYS],
      ['user_notifications', this.env.NOTIFICATION_DAYS]
    ] as const) {
      try {
        removed[table] = await this.olderThan(table, days);
      } catch (err) {
        this.logger.warn(`Could not clean up ${table}: ${(err as Error).message}`);
      }
    }
    return removed;
  }

  private async olderThan(table: string, days: number): Promise<number> {
    const name = sql.identifier(table);
    let total = 0;
    for (;;) {
      const result = await this.db.execute(sql`
        delete from ${name} where id in (
          select id from ${name} where created_at < now() - make_interval(days => ${days}) limit ${BATCH})`);
      total += result.rowCount ?? 0;
      if ((result.rowCount ?? 0) < BATCH) return total;
    }
  }
}
