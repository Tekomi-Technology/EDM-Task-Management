import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators';
import { AppError } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';

type Check = 'ok' | 'down';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService
  ) {}

  @Get()
  @Public()
  async check(): Promise<{ status: 'ok'; checks: Record<string, Check> }> {
    const run = (p: Promise<unknown>): Promise<Check> =>
      p.then(() => 'ok' as const).catch(() => 'down' as const);
    const [database, redis, storage] = await Promise.all([
      run(this.db.execute(sql`select 1`)),
      run(this.notifications.ping()),
      run(this.storage.ping())
    ]);
    const checks = { database, redis, storage };
    if (Object.values(checks).includes('down')) {
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'UNHEALTHY', 'A dependency is down', checks);
    }
    return { status: 'ok', checks };
  }
}
