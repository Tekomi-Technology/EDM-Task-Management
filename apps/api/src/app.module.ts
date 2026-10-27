import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { EscalationModule } from './escalation/escalation.module';
import { LocationModule } from './location/location.module';
import { RedisModule } from './redis/redis.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ConfigModule } from './config/config.module';
import { loadEnv } from './config/env';
import { DbModule } from './db/db.module';
import { PartitionsService } from './db/partitions.service';
import { RetentionService } from './db/retention.service';
import { HealthController } from './health/health.controller';
import { HelpModule } from './help/help.module';
import { IntakeModule } from './intake/intake.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { NetworkModule } from './network/network.module';
import { SalesModule } from './sales/sales.module';
import { StaffModule } from './staff/staff.module';
import { StockApiModule } from './stock/stock-api.module';
import { StockModule } from './stock/stock.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReportsModule } from './reports/reports.module';
import { StorageModule } from './storage/storage.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

const env = loadEnv();

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: env.NODE_ENV === 'test' ? 'silent' : 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization'],
        transport:
          env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined
      }
    }),
    DbModule,
    RedisModule,
    LocationModule,
    StockModule,
    IntegrationsModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    UsersModule,
    TicketsModule,
    IntakeModule,
    NetworkModule,
    StaffModule,
    EscalationModule,
    StockApiModule,
    SalesModule,
    HelpModule,
    ReportsModule,
    AdminModule
  ],
  controllers: [HealthController],
  providers: [PartitionsService, RetentionService, { provide: APP_FILTER, useClass: HttpExceptionFilter }]
})
export class AppModule {}
