import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/env';
import { InboxController } from './inbox.controller';
import { NotificationsService } from './notifications.service';
import { createPushSender, PUSH_SENDER } from './push-sender';
import { createSmsSender, SMS_SENDER } from './sms-sender';

@Global()
@Module({
  controllers: [InboxController],
  providers: [
    NotificationsService,
    { provide: SMS_SENDER, useFactory: createSmsSender, inject: [ENV] },
    { provide: PUSH_SENDER, useFactory: createPushSender, inject: [ENV] }
  ],
  exports: [NotificationsService]
})
export class NotificationsModule {}
