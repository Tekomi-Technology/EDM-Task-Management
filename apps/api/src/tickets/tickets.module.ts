import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { OfficeTicketsController } from './office-tickets.controller';
import { OfficeTicketsService } from './office-tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketsQuery } from './tickets.query';
import { TicketsService } from './tickets.service';

@Module({
  imports: [UsersModule],
  controllers: [TicketsController, OfficeTicketsController],
  providers: [TicketsService, TicketsQuery, OfficeTicketsService],
  exports: [TicketsService, TicketsQuery]
})
export class TicketsModule {}
