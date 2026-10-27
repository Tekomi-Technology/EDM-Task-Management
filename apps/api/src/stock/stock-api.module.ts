import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { StockController, StockIntakeController } from './stock.controller';

@Module({ imports: [TicketsModule], controllers: [StockController, StockIntakeController] })
export class StockApiModule {}
