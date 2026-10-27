import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { nmsAlarmBatchSchema, type NmsAlarmBatch } from '@edm/shared';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody } from '../common/zod';
import { NmsService, type AlarmResult } from './nms.service';

/** API for the network management system. Authenticate with the `nms-system` client (client credentials). */
@ApiTags('intake: NMS')
@ApiBearerAuth()
@Controller('intake/nms')
@Roles('integration_nms')
export class NmsController {
  constructor(private readonly nms: NmsService) {}

  @Post('alarms')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send alarm events (raise or clear)',
    description:
      'Events are handled in the order sent. Alarms with the same correlationId, element or parent element are grouped ' +
      'into one network incident ticket; warnings are only recorded. Sending the same event again is harmless.'
  })
  @ApiZodBody(nmsAlarmBatchSchema)
  receive(
    @ZodBody(nmsAlarmBatchSchema) body: NmsAlarmBatch,
    @CurrentUser() user: AuthUser
  ): Promise<{ results: AlarmResult[] }> {
    return this.nms.receive(body.alarms, user).then((results) => ({ results }));
  }
}
