import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { NetworkController } from './network.controller';
import { NmsController } from './nms.controller';
import { NmsService } from './nms.service';

@Module({
  imports: [TicketsModule, UsersModule],
  controllers: [NmsController, NetworkController],
  providers: [NmsService]
})
export class NetworkModule {}
