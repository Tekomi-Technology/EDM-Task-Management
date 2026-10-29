import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { USER_ROLES, type Role } from '../contract';
import { AppError } from '../common/errors';
import { UsersService } from '../users/users.service';
import { API_KEY_PREFIX, ApiKeysService } from './api-keys.service';
import type { AuthUser } from './auth-user';
import { BEFORE_PASSWORD_CHANGE, IS_PUBLIC, ROLES_KEY } from './decorators';
import { TokenExpired, TokenService } from './tokens';

const unauthenticated = (message: string) =>
  new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', message);

/**
 * Checks every route: a person's access token or another system's API key, then the route's @Roles(). Registered
 * globally. The person is read from the database on each request, so blocking or a change of role applies at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly apiKeys: ApiKeysService,
    private readonly users: UsersService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated('Sign in required');
    const credential = header.slice('Bearer '.length).trim();

    req.user = credential.startsWith(API_KEY_PREFIX)
      ? await this.fromApiKey(credential)
      : await this.fromToken(
          credential,
          this.reflector.getAllAndOverride<boolean>(BEFORE_PASSWORD_CHANGE, targets)
        );

    // Deny by default: a route without @Roles is for people who work in the system (any staff role), never for
    // other systems' keys or an account that has no role here.
    const required =
      this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ??
      (USER_ROLES as readonly Role[]);
    if (!required.some((r) => req.user!.roles.includes(r))) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN_ROLE', 'You do not have access to this action');
    }
    return true;
  }

  private async fromApiKey(key: string): Promise<AuthUser> {
    const user = await this.apiKeys.authenticate(key);
    if (!user) throw unauthenticated('Unknown or revoked API key');
    return user;
  }

  private async fromToken(token: string, beforePasswordChange: boolean | undefined): Promise<AuthUser> {
    let ids: { userId: string; sessionId: string };
    try {
      ids = await this.tokens.verify(token);
    } catch (err) {
      if (err instanceof TokenExpired) {
        throw new AppError(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', 'Your session has expired');
      }
      throw unauthenticated('Invalid access token');
    }
    const user = await this.users.forRequest(ids.userId);
    if (!user) throw unauthenticated('Unknown account');
    if (user.mustChangePassword && !beforePasswordChange) {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'PASSWORD_CHANGE_REQUIRED',
        'Choose your own password before continuing'
      );
    }
    return {
      sub: user.id,
      username: user.username,
      fullName: user.fullName,
      roles: user.roles.filter((r): r is Role => (USER_ROLES as readonly string[]).includes(r)),
      userId: user.id,
      teamId: user.teamId,
      onDuty: user.onDuty,
      isIntegration: false,
      sessionId: ids.sessionId
    };
  }
}
