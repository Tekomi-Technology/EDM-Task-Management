import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TicketsModule],
  controllers: [ReportsController],
  providers: [ReportsService]
})
export class ReportsModule {}
