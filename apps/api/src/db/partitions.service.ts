import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from './db.module';

const MONTHS_AHEAD = 3;
const EVERY_12_HOURS = 12 * 60 * 60 * 1000;

/** Keeps monthly partitions created ahead of time for the partitioned tables. */
@Injectable()
export class PartitionsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PartitionsService.name);
  private timer?: NodeJS.Timeout;

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensure();
    this.timer = setInterval(() => void this.ensure(), EVERY_12_HOURS).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async ensure(): Promise<void> {
    try {
      await this.db.execute(sql`select ensure_month_partitions('ticket_events', ${MONTHS_AHEAD})`);
      await this.db.execute(sql`select ensure_month_partitions('staff_locations', ${MONTHS_AHEAD})`);
    } catch (err) {
      this.logger.error(`Could not create partitions: ${(err as Error).message}`);
    }
  }
}
