import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  updateUserSchema,
  userListQuerySchema,
  type AdminUser,
  type CreateUser,
  type TeamView,
  type UpdateUser,
  type UserListQuery
} from '@edm/shared';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { AdminUsersService } from './admin-users.service';

/** Users & roles screen. Admins only. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  list(@ZodQuery(userListQuerySchema) q: UserListQuery): Promise<AdminUser[]> {
    return this.users.list(q);
  }

  @Get('teams')
  teams(): Promise<TeamView[]> {
    return this.users.teams();
  }

  /** The temporary password is shown once; the person must change it at first sign-in. */
  @Post('users')
  @ApiZodBody(createUserSchema)
  create(
    @ZodBody(createUserSchema) body: CreateUser
  ): Promise<{ user: AdminUser; temporaryPassword: string }> {
    return this.users.create(body);
  }

  @Patch('users/:id')
  @ApiZodBody(updateUserSchema)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateUserSchema) body: UpdateUser,
    @CurrentUser() actor: AuthUser
  ): Promise<AdminUser> {
    return this.users.update(id, body, actor);
  }

  @Post('users/:id/reset-password')
  @HttpCode(200)
  resetPassword(@Param('id', ParseUUIDPipe) id: string): Promise<{ temporaryPassword: string }> {
    return this.users.resetPassword(id);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<AdminUser> {
    return this.users.block(id, actor);
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  unblock(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUser> {
    return this.users.unblock(id);
  }

  @Post('users/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<AdminUser> {
    return this.users.cancel(id, actor);
  }
}
