import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@edm/shared';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';

/** Route needs no token (health check, API docs). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route is limited to these Keycloak realm roles; without it any signed-in caller may use the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user
);
