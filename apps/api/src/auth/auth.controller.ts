import { Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  refreshSchema,
  signInSchema,
  type ChangePassword,
  type SignIn,
  type SignInResult
} from '../contract';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ApiZodBody, ZodBody } from '../common/zod';
import { ENV, type Env } from '../config/env';
import { AuthService, type IssuedSession } from './auth.service';
import type { AuthUser } from './auth-user';
import { BeforePasswordChange, CurrentUser, Public } from './decorators';

/** The web app's renewal token: sent only to these routes, never readable by the page's scripts. */
const COOKIE = 'edm_session';
const COOKIE_PATH = '/api/auth';

/** Many sign-ins from one address in a short time: slows down guessing across many accounts. */
const ATTEMPTS_PER_ADDRESS = 30;
const ATTEMPT_WINDOW_MS = 10 * 60_000;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function cookieValue(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

@ApiTags('signing in')
@Controller('auth')
export class AuthController {
  private readonly attempts = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Username and password. The web app gets its renewal token as a cookie, the phone app in the answer. */
  @Post('sign-in')
  @Public()
  @HttpCode(200)
  @ApiZodBody(signInSchema)
  async signIn(
    @ZodBody(signInSchema) body: SignIn,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<SignInResult> {
    this.countAttempt(req.ip ?? 'unknown');
    return this.answer(await this.auth.signIn(body), body.client, res);
  }

  /** A new access token for a session that has not ended; the renewal token changes each time. */
  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiZodBody(refreshSchema)
  async refresh(
    @ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<SignInResult> {
    const fromApp = !!body.refreshToken;
    try {
      const session = await this.auth.refresh(body.refreshToken ?? cookieValue(req));
      return this.answer(session, fromApp ? 'app' : 'web', res);
    } catch (err) {
      if (!fromApp) this.clearCookie(res);
      throw err;
    }
  }

  @Post('sign-out')
  @Public()
  @HttpCode(204)
  @ApiZodBody(refreshSchema)
  async signOut(
    @ZodBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<void> {
    await this.auth.signOut(body.refreshToken ?? cookieValue(req));
    this.clearCookie(res);
  }

  /** The person's own password: needed after a temporary one; signs out their other browsers and phones. */
  @Post('change-password')
  @BeforePasswordChange()
  @HttpCode(204)
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @ZodBody(changePasswordSchema) body: ChangePassword,
    @CurrentUser() user: AuthUser
  ): Promise<void> {
    await this.auth.changePassword(user.userId!, user.sessionId!, body);
  }

  private answer(session: IssuedSession, client: 'web' | 'app', res: Response): SignInResult {
    const { refreshToken, refreshExpiresAt, ...result } = session;
    if (client === 'app') return { ...result, refreshToken };
    res.cookie(COOKIE, refreshToken, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: refreshExpiresAt
    });
    return result;
  }

  private clearCookie(res: Response): void {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  private countAttempt(address: string): void {
    // Scripts on the server itself (tests, the simulators); visitors arrive with their own address through nginx.
    if (LOOPBACK.has(address)) return;
    const now = Date.now();
    const entry = this.attempts.get(address);
    if (!entry || entry.until < now) {
      this.attempts.set(address, { count: 1, until: now + ATTEMPT_WINDOW_MS });
      if (this.attempts.size > 10_000) {
        for (const [key, value] of this.attempts) if (value.until < now) this.attempts.delete(key);
      }
      return;
    }
    entry.count += 1;
    if (entry.count > ATTEMPTS_PER_ADDRESS) {
      throw new AppError(
        HttpStatus.TOO_MANY_REQUESTS,
        'TOO_MANY_ATTEMPTS',
        'Too many sign-in attempts from this address. Try again later'
      );
    }
  }
}
