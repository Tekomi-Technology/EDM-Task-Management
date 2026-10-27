import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { CallCenterController } from './call-center.controller';
import { CallCenterService } from './call-center.service';

@Module({
  imports: [TicketsModule],
  controllers: [CallCenterController],
  providers: [CallCenterService]
})
export class IntakeModule {}
