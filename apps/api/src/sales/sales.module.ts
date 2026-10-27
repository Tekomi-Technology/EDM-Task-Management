import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { NewCustomersController, SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [TicketsModule],
  controllers: [SalesController, NewCustomersController],
  providers: [SalesService]
})
export class SalesModule {}
