import { Inject, Injectable } from '@nestjs/common';
import type { SignInSettings } from '../contract';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { settings } from '../db/schema';

export const DEFAULT_SIGN_IN_SETTINGS: SignInSettings = {
  minPasswordLength: 8,
  maxFailedSignIns: 5,
  lockMinutes: 15,
  webSessionDays: 7,
  appSessionDays: 30
};
const KEY = 'sign_in';

/** Settings → Sign-in security: password length, locking after wrong passwords, how long people stay signed in. */
@Injectable()
export class SignInSettingsService {
  private cached: { value: SignInSettings; at: number } | undefined;

  constructor(@Inject(DB) private readonly db: Db) {}

  async get(): Promise<SignInSettings> {
    if (this.cached && Date.now() - this.cached.at < 30_000) return this.cached.value;
    const [row] = await this.db.select().from(settings).where(eq(settings.key, KEY));
    const value = { ...DEFAULT_SIGN_IN_SETTINGS, ...((row?.value as Partial<SignInSettings>) ?? {}) };
    this.cached = { value, at: Date.now() };
    return value;
  }

  async update(value: SignInSettings): Promise<SignInSettings> {
    await this.db
      .insert(settings)
      .values({ key: KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    this.cached = undefined;
    return this.get();
  }
}
