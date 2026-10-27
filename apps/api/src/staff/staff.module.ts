import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [TicketsModule, UsersModule],
  controllers: [StaffController],
  providers: [StaffService]
})
export class StaffModule {}
