import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ChangePassword, SignIn, SignInResult } from '../contract';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/errors';
import { DB, type Db } from '../db/db.module';
import { sessions, users } from '../db/schema';
import {
  hashPassword,
  NO_ACCOUNT_HASH,
  passwordProblem,
  passwordProblemText,
  verifyPassword
} from './passwords';
import { SignInSettingsService } from './sign-in-settings.service';
import { ACCESS_TOKEN_SECONDS, randomToken, sha256, TokenService } from './tokens';

type Client = 'web' | 'app';

/** A sign-in or renewal: the answer for the client, plus the renewal token and how long it lasts. */
export interface IssuedSession extends SignInResult {
  refreshToken: string;
  refreshExpiresAt: Date;
}

const wrongCredentials = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Wrong username or password');
const signedOut = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_ENDED', 'Your session has ended; sign in again');

/**
 * Signing in with a username and password. People stay signed in through a session: a renewal token (kept by
 * the browser in a cookie, by the phone app itself) that buys new short access tokens until it expires.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokenService,
    private readonly settings: SignInSettingsService
  ) {}

  async signIn(input: SignIn): Promise<IssuedSession> {
    const [user] = await this.db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
        status: users.status,
        mustChangePassword: users.mustChangePassword,
        failedSignIns: users.failedSignIns,
        lockedUntil: users.lockedUntil
      })
      .from(users)
      .where(sql`lower(${users.username}) = ${input.username.trim().toLowerCase()}`);

    // Same work and the same answer whether the username exists or not.
    const ok = await verifyPassword(user?.passwordHash ?? NO_ACCOUNT_HASH, input.password);
    if (!user || !user.passwordHash || user.status !== 'active') throw wrongCredentials();
    if (user.lockedUntil && user.lockedUntil > new Date()) throw this.locked(user.lockedUntil);

    if (!ok) {
      const rules = await this.settings.get();
      const failed = user.failedSignIns + 1;
      const lockedUntil =
        failed >= rules.maxFailedSignIns ? new Date(Date.now() + rules.lockMinutes * 60_000) : null;
      await this.db
        .update(users)
        .set({ failedSignIns: lockedUntil ? 0 : failed, lockedUntil })
        .where(eq(users.id, user.id));
      throw lockedUntil ? this.locked(lockedUntil) : wrongCredentials();
    }

    await this.db
      .update(users)
      .set({ failedSignIns: 0, lockedUntil: null, lastSeenAt: new Date() })
      .where(eq(users.id, user.id));
    return this.newSession(user.id, input.client, user.mustChangePassword);
  }

  /** A new access token and a new renewal token (the old one stops working), for the same session. */
  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) throw signedOut();
    const [row] = await this.db
      .select({
        id: sessions.id,
        client: sessions.client,
        userId: sessions.userId,
        status: users.status,
        mustChangePassword: users.mustChangePassword
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, sha256(refreshToken)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date())
        )
      );
    if (!row || row.status !== 'active') throw signedOut();

    // Signed in for as long as the session is used: each renewal moves the end forward.
    const token = randomToken();
    const expiresAt = await this.expiry(row.client);
    await this.db
      .update(sessions)
      .set({ tokenHash: sha256(token), expiresAt, lastUsedAt: new Date() })
      .where(eq(sessions.id, row.id));
    return {
      accessToken: await this.tokens.access(row.userId, row.id),
      expiresIn: ACCESS_TOKEN_SECONDS,
      refreshToken: token,
      refreshExpiresAt: expiresAt,
      mustChangePassword: row.mustChangePassword
    };
  }

  async signOut(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.tokenHash, sha256(refreshToken)), isNull(sessions.revokedAt)));
  }

  /** The person's own new password; their other browsers and phones are signed out. */
  async changePassword(userId: string, sessionId: string, input: ChangePassword): Promise<void> {
    const [user] = await this.db
      .select({ username: users.username, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'WRONG_PASSWORD', 'The current password is wrong');
    }
    await this.checkNewPassword(user.username, input.newPassword);
    if (input.newPassword === input.currentPassword) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PASSWORD_NOT_CHANGED',
        'Choose a password different from the current one'
      );
    }
    await this.db
      .update(users)
      .set({
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(users.id, userId));
    await this.endSessions(userId, sessionId);
  }

  /** Throws when a password chosen by a person does not follow the rules in Settings. */
  async checkNewPassword(username: string, password: string): Promise<void> {
    const { minPasswordLength } = await this.settings.get();
    const reason = passwordProblem(password, username, minPasswordLength);
    // The reason and length let the web app say it in the person's language.
    if (reason) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'WEAK_PASSWORD',
        passwordProblemText(reason, minPasswordLength),
        { reason, minLength: minPasswordLength }
      );
    }
  }

  /** Signs the person out everywhere (blocked, password reset), or everywhere but the session given. */
  async endSessions(userId: string, keepSessionId?: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          keepSessionId ? ne(sessions.id, keepSessionId) : undefined
        )
      );
  }

  private async newSession(
    userId: string,
    client: Client,
    mustChangePassword: boolean
  ): Promise<IssuedSession> {
    const token = randomToken();
    const expiresAt = await this.expiry(client);
    const [session] = await this.db
      .insert(sessions)
      .values({ userId, client, tokenHash: sha256(token), expiresAt })
      .returning({ id: sessions.id });
    return {
      accessToken: await this.tokens.access(userId, session!.id),
      expiresIn: ACCESS_TOKEN_SECONDS,
      refreshToken: token,
      refreshExpiresAt: expiresAt,
      mustChangePassword
    };
  }

  private async expiry(client: Client): Promise<Date> {
    const rules = await this.settings.get();
    const days = client === 'app' ? rules.appSessionDays : rules.webSessionDays;
    return new Date(Date.now() + days * 86_400_000);
  }

  private locked(until: Date): AppError {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return new AppError(
      HttpStatus.TOO_MANY_REQUESTS,
      'ACCOUNT_LOCKED',
      `Too many wrong passwords. Try again in ${minutes} min`,
      { minutes }
    );
  }
}
