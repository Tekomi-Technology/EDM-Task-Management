import { Inject, Injectable } from '@nestjs/common';
import type { LocationBatch, StaffLocation } from '@edm/shared';
import type IORedis from 'ioredis';
import { ENV, type Env } from '../config/env';
import { DB, type Db } from '../db/db.module';
import { staffLocations } from '../db/partitioned';
import { REDIS } from '../redis/redis.module';

const key = (userId: string) => `staff:location:${userId}`;
const DAY_S = 24 * 3600;
/** Points older than this are not accepted (the history table only keeps recent months). */
const MAX_AGE_MS = 7 * DAY_S * 1000;

export interface KnownLocation extends StaffLocation {
  /** Recent enough to count the person as online and to measure distances from. */
  fresh: boolean;
}

/**
 * Where field staff are. Every point goes into the partitioned history table; the newest one per person is also
 * kept in Redis, so the live map and assignment read it without touching the history.
 */
@Injectable()
export class LocationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(ENV) private readonly env: Env
  ) {}

  /** Stores points sent by the app (possibly a batch kept while offline). Returns how many were kept. */
  async record(userId: string, points: LocationBatch['points']): Promise<number> {
    const now = Date.now();
    // A phone with a wrong clock must not write into the future or far into the past.
    const valid = points
      .map((p) => ({ ...p, at: Date.parse(p.recordedAt) }))
      .filter((p) => p.at <= now + 2 * 60_000 && now - p.at <= MAX_AGE_MS);
    if (valid.length === 0) return 0;
    await this.db
      .insert(staffLocations)
      .values(
        valid.map((p) => ({
          userId,
          recordedAt: new Date(Math.min(p.at, now)),
          location: { lat: p.lat, lng: p.lng },
          accuracyM: p.accuracy ?? null
        }))
      )
      .onConflictDoNothing();

    const newest = valid.reduce((a, b) => (b.at > a.at ? b : a));
    const current = await this.latest([userId]);
    const known = current.get(userId);
    if (!known || Date.parse(known.at) < newest.at) {
      const value: StaffLocation = {
        lat: newest.lat,
        lng: newest.lng,
        accuracy: newest.accuracy ?? null,
        at: new Date(Math.min(newest.at, now)).toISOString()
      };
      await this.redis.set(key(userId), JSON.stringify(value), 'EX', DAY_S);
    }
    return valid.length;
  }

  /** Newest known position of each person (none if not seen in the last day). */
  async latest(userIds: string[]): Promise<Map<string, KnownLocation>> {
    const result = new Map<string, KnownLocation>();
    if (userIds.length === 0) return result;
    const values = await this.redis.mget(userIds.map(key));
    const freshAfter = Date.now() - this.env.STAFF_OFFLINE_AFTER_MIN * 60_000;
    values.forEach((raw, i) => {
      if (!raw) return;
      try {
        const v = JSON.parse(raw) as StaffLocation;
        const lat = Number(v.lat);
        const lng = Number(v.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        result.set(userIds[i]!, { ...v, lat, lng, fresh: Date.parse(v.at) >= freshAfter });
      } catch {
        // Ignore a damaged entry; the next point replaces it.
      }
    });
    return result;
  }
}
