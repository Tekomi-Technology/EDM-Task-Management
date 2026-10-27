import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { EscalationService } from './escalation.service';

@Module({
  imports: [TicketsModule, UsersModule],
  providers: [EscalationService],
  exports: [EscalationService]
})
export class EscalationModule {}
