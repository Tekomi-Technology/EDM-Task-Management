import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { ENV, type Env } from '../config/env';

const ISSUER = 'edm-tasks';
/** Access tokens are short; the browser or phone renews them with its session's renewal token. */
export const ACCESS_TOKEN_SECONDS = 15 * 60;

export class TokenExpired extends Error {}

/** Random renewal tokens and API keys are stored only as this hash. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Signs and checks the access tokens: the user id and the session they belong to, signed with AUTH_SECRET. */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Env) {
    this.key = new TextEncoder().encode(env.AUTH_SECRET);
  }

  access(userId: string, sessionId: string): Promise<string> {
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_SECONDS}s`)
      .sign(this.key);
  }

  /** The user and session ids; throws TokenExpired, or Error for any other bad token. */
  async verify(token: string): Promise<{ userId: string; sessionId: string }> {
    try {
      const { payload } = await jwtVerify<{ sid?: string }>(token, this.key, {
        issuer: ISSUER,
        algorithms: ['HS256']
      });
      if (!payload.sub || !payload.sid) throw new Error('Incomplete token');
      return { userId: payload.sub, sessionId: payload.sid };
    } catch (err) {
      if (err instanceof errors.JWTExpired) throw new TokenExpired();
      throw err;
    }
  }
}
