import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { INTEGRATION_ROLES, isRole, USER_ROLES, type Role } from '../contract';
import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { UsersService } from '../users/users.service';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC, ROLES_KEY } from './decorators';
import { JWKS, keycloakIssuer } from './jwks';

interface KeycloakClaims extends JWTPayload {
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  realm_access?: { roles?: string[] };
}

/** Checks the Keycloak access token on every route, then the route's @Roles(). Registered globally. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(JWKS) private readonly jwks: JWTVerifyGetKey,
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersService
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Sign in required');
    }

    const claims = await this.verify(header.slice('Bearer '.length));
    req.user = await this.toAuthUser(claims);

    // Deny by default: a route without @Roles is for people who work in the system (any staff role), never for
    // other systems' accounts or a sign-in that has no role here.
    const required =
      this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets) ??
      (USER_ROLES as readonly Role[]);
    if (!required.some((r) => req.user!.roles.includes(r))) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN_ROLE', 'You do not have access to this action');
    }
    return true;
  }

  private async verify(token: string): Promise<KeycloakClaims> {
    try {
      const { payload } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        issuer: keycloakIssuer(this.env),
        audience: this.env.KEYCLOAK_AUDIENCE
      });
      return payload;
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        throw new AppError(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED', 'Your session has expired');
      }
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid access token');
    }
  }

  private async toAuthUser(claims: KeycloakClaims): Promise<AuthUser> {
    const roles = (claims.realm_access?.roles ?? []).filter(isRole);
    const isIntegration = roles.some((r) => (INTEGRATION_ROLES as readonly string[]).includes(r));
    const username = claims.preferred_username ?? claims.sub!;
    const fullName =
      [claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.name || username;
    const base = { sub: claims.sub!, username, fullName, roles, isIntegration };
    if (isIntegration) return { ...base, userId: null, teamId: null, onDuty: false };
    const user = await this.users.ensureFromToken(base);
    return { ...base, fullName: user.fullName, userId: user.id, teamId: user.teamId, onDuty: user.onDuty };
  }
}
