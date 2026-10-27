import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { HelpController } from './help.controller';
import { HelpService } from './help.service';

@Module({ imports: [TicketsModule, UsersModule], controllers: [HelpController], providers: [HelpService] })
export class HelpModule {}
