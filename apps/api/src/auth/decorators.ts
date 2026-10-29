import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '../contract';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC = 'isPublic';
export const ROLES_KEY = 'roles';
export const BEFORE_PASSWORD_CHANGE = 'beforePasswordChange';

/** Route needs no token (health check, signing in). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route a person with a temporary password may use before choosing their own (who am I, change password). */
export const BeforePasswordChange = () => SetMetadata(BEFORE_PASSWORD_CHANGE, true);

/** Route is limited to these roles; without it any signed-in person (not another system) may use the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user
);
