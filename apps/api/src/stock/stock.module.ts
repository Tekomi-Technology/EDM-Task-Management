import { Global, Module } from '@nestjs/common';
import { StockService } from './stock.service';

/** The stock ledger, used by tickets (materials, reservations) and by the stock screens. */
@Global()
@Module({ providers: [StockService], exports: [StockService] })
export class StockModule {}
