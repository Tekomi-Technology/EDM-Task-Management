import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createApiKeySchema,
  createAreaSchema,
  createTeamSchema,
  updateAreaSchema,
  updateTeamSchema,
  type AreaView,
  type CreateArea,
  type CreateTeam,
  type UpdateArea,
  type UpdateTeam,
  createUserSchema,
  signInSettingsSchema,
  type ApiKeyView,
  type CreateApiKey,
  type CreatedApiKey,
  type SignInSettings,
  updateUserSchema,
  userListQuerySchema,
  type AdminUser,
  type CreateUser,
  type TeamView,
  type UpdateUser,
  type UserListQuery
} from '../contract';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { ApiZodBody, ZodBody, ZodQuery } from '../common/zod';
import { ApiKeysService } from '../auth/api-keys.service';
import { SignInSettingsService } from '../auth/sign-in-settings.service';
import { AdminUsersService } from './admin-users.service';
import { AreasService } from './areas.service';

/** The admin area: users and roles, API keys for the other EDM systems, sign-in security. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly apiKeys: ApiKeysService,
    private readonly signIn: SignInSettingsService,
    private readonly areas: AreasService
  ) {}

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

  @Get('api-keys')
  listApiKeys(): Promise<ApiKeyView[]> {
    return this.apiKeys.list();
  }

  /** The key is in the answer only this once. */
  @Post('api-keys')
  @ApiZodBody(createApiKeySchema)
  createApiKey(
    @ZodBody(createApiKeySchema) body: CreateApiKey,
    @CurrentUser() actor: AuthUser
  ): Promise<CreatedApiKey> {
    return this.apiKeys.create(body, actor);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  revokeApiKey(@Param('id', ParseUUIDPipe) id: string): Promise<ApiKeyView> {
    return this.apiKeys.revoke(id);
  }

  @Get('settings/sign-in')
  signInSettings(): Promise<SignInSettings> {
    return this.signIn.get();
  }

  @Put('settings/sign-in')
  @ApiZodBody(signInSettingsSchema)
  updateSignInSettings(@ZodBody(signInSettingsSchema) body: SignInSettings): Promise<SignInSettings> {
    return this.signIn.update(body);
  }

  @Get('areas')
  listAreas(): Promise<AreaView[]> {
    return this.areas.list();
  }

  @Post('areas')
  @ApiZodBody(createAreaSchema)
  createArea(@ZodBody(createAreaSchema) body: CreateArea): Promise<AreaView> {
    return this.areas.createArea(body);
  }

  @Patch('areas/:id')
  @ApiZodBody(updateAreaSchema)
  updateArea(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateAreaSchema) body: UpdateArea
  ): Promise<AreaView> {
    return this.areas.updateArea(id, body);
  }

  @Delete('areas/:id')
  @HttpCode(204)
  deleteArea(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.areas.deleteArea(id);
  }

  @Post('teams')
  @ApiZodBody(createTeamSchema)
  createTeam(@ZodBody(createTeamSchema) body: CreateTeam): Promise<TeamView> {
    return this.areas.createTeam(body);
  }

  @Patch('teams/:id')
  @ApiZodBody(updateTeamSchema)
  updateTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @ZodBody(updateTeamSchema) body: UpdateTeam
  ): Promise<TeamView> {
    return this.areas.updateTeam(id, body);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  deleteTeam(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.areas.deleteTeam(id);
  }
}
