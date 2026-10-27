import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  helpListQuerySchema,
  helpReplySchema,
  helpRequestSchema,
  type HelpReply,
  type HelpRequestInput,
  type HelpRequestView
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { HelpService } from './help.service';

const OFFICE = ['admin', 'technical_manager', 'team_manager', 'noc', 'bo_support', 'network_team'] as const;

@ApiTags('help requests')
@ApiBearerAuth()
@Controller()
export class HelpController {
  constructor(private readonly help: HelpService) {}

  /** A field staff member asks the back office for help (a second person, a truck, material, a switch-off…). */
  @Post('help-requests')
  @Roles('field_staff')
  @ApiZodBody(helpRequestSchema)
  create(
    @ZodBody(helpRequestSchema) body: HelpRequestInput,
    @CurrentUser() user: AuthUser
  ): Promise<HelpRequestView> {
    return this.help.create(body, user);
  }

  @Get('help-requests')
  @Roles(...OFFICE)
  list(
    @CurrentUser() user: AuthUser,
    @ZodQuery(helpListQuerySchema) q: z.infer<typeof helpListQuerySchema>
  ): Promise<HelpRequestView[]> {
    return this.help.list(user, q.status, q.areaId);
  }

  @Get('me/help-requests')
  @Roles('field_staff')
  mine(@CurrentUser() user: AuthUser): Promise<HelpRequestView[]> {
    return this.help.list(user);
  }

  @Get('help-requests/:id')
  @Roles(...OFFICE, 'field_staff')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser): Promise<HelpRequestView> {
    return this.help.get(id, user);
  }

  /** Answer (office) or add to the conversation (the staff member who asked). */
  @Post('help-requests/:id/messages')
  @HttpCode(200)
  @Roles(...OFFICE, 'field_staff')
  @ApiZodBody(helpReplySchema)
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(helpReplySchema) body: HelpReply,
    @CurrentUser() user: AuthUser
  ): Promise<HelpRequestView> {
    return this.help.reply(id, body, user);
  }
}
