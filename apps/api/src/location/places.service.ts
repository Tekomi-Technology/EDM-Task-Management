import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

interface NominatimPlace {
  display_name?: string;
  address?: Record<string, string>;
}

/** Nominatim's usage policy asks clients to name themselves and to send at most one request a second. */
const USER_AGENT = 'EDM-Tasks/1.0 (Electricidade de Mocambique)';
const MIN_GAP_MS = 1000;
const CACHE_SIZE = 500;

/**
 * The address of a point marked on the map, so the person entering a ticket does not have to type it. Answers are
 * kept in memory (the same places come up again) and requests are spaced out for the public server.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly cache = new Map<string, string | null>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async addressAt(lat: number, lng: number): Promise<string | null> {
    if (!this.env.GEOCODER_URL) return null;
    // About a metre apart: the same point clicked twice is answered from memory.
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const address = await this.inTurn(() => this.lookup(lat, lng));
    if (address !== undefined) {
      if (this.cache.size >= CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, address);
    }
    return address ?? null;
  }

  /** One request at a time, at least a second apart. */
  private inTurn<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastAt = Date.now();
      return job();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The address, null when there is none there, undefined when the service did not answer (not remembered). */
  private async lookup(lat: number, lng: number): Promise<string | null | undefined> {
    const url = new URL('/reverse', this.env.GEOCODER_URL);
    url.search = new URLSearchParams({
      format: 'jsonv2',
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1',
      'accept-language': 'pt'
    }).toString();
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        this.logger.warn(`Address lookup answered ${res.status}`);
        return undefined;
      }
      return shortAddress((await res.json()) as NominatimPlace);
    } catch (err) {
      this.logger.warn(`Address lookup failed: ${(err as Error).message}`);
      return undefined;
    }
  }
}

/** "Rua 4 123, Matola Gare, Matola": street and number, neighbourhood, town; the full name when parts are missing. */
export function shortAddress(place: NominatimPlace): string | null {
  const a = place.address ?? {};
  const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(' ');
  const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.city_district;
  const town = a.city ?? a.town ?? a.village ?? a.municipality;
  const parts = [...new Set([street, area, town].filter((p): p is string => !!p))];
  if (parts.length >= 2) return parts.join(', ');
  return place.display_name?.split(',').slice(0, 4).join(',').trim() || null;
}
