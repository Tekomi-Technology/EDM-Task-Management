import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  pushDeviceSchema,
  removePushDeviceSchema,
  type CurrentUser as CurrentUserView,
  type PushDevice,
  type StaffMember
} from '../contract';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth-user';
import { BeforePasswordChange, CurrentUser, Roles } from '../auth/decorators';
import { AppError } from '../common/errors';
import { ApiZodBody, ZodBody } from '../common/zod';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly notifications: NotificationsService
  ) {}

  @Get('me')
  @BeforePasswordChange()
  async me(@CurrentUser() user: AuthUser): Promise<CurrentUserView> {
    return {
      id: user.userId ?? user.sub,
      username: user.username,
      fullName: user.fullName,
      roles: user.roles,
      teamId: user.teamId,
      teamName: await this.users.teamName(user.teamId),
      onDuty: user.onDuty
    };
  }

  /** Figures for the top of the app's job list. */
  @Get('me/today')
  @Roles('field_staff')
  async today(@CurrentUser() user: AuthUser): Promise<{ done: number }> {
    return { done: await this.users.doneToday(user.userId!) };
  }

  /** The app registers its push token after sign-in, so new jobs arrive as notifications. */
  @Post('me/devices')
  @HttpCode(204)
  @Roles('field_staff', 'team_manager', 'technical_manager', 'admin', 'noc', 'network_team', 'bo_support')
  @ApiZodBody(pushDeviceSchema)
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @ZodBody(pushDeviceSchema) body: PushDevice
  ): Promise<void> {
    await this.notifications.registerDevice(user.userId!, body.token, body.platform);
  }

  /** The app calls this when signing out, so the phone stops receiving this person's jobs. */
  @Post('me/devices/remove')
  @HttpCode(204)
  @Roles('field_staff', 'team_manager', 'technical_manager', 'admin', 'noc', 'network_team', 'bo_support')
  @ApiZodBody(removePushDeviceSchema)
  async removeDevice(
    @CurrentUser() user: AuthUser,
    @ZodBody(removePushDeviceSchema) body: z.infer<typeof removePushDeviceSchema>
  ): Promise<void> {
    await this.notifications.removeDevice(user.userId!, body.token);
  }

  /** Field staff a team manager can assign tickets to. */
  @Get('teams/:teamId/staff')
  @Roles('team_manager', 'technical_manager', 'admin')
  teamStaff(
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser() user: AuthUser
  ): Promise<StaffMember[]> {
    if (!user.roles.some((r) => r === 'admin' || r === 'technical_manager') && user.teamId !== teamId) {
      throw new AppError(HttpStatus.FORBIDDEN, 'NOT_IN_TEAM', 'You can only see staff of your own team');
    }
    return this.users.teamStaff(teamId);
  }
}
