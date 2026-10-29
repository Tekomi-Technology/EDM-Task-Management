import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AreaView,
  Boundary,
  CreateArea,
  CreateTeam,
  TeamView,
  UpdateArea,
  UpdateTeam
} from '../contract';
import { eq, sql } from 'drizzle-orm';
import { AppError, notFound } from '../common/errors';
import { DB, type Db, type Tx } from '../db/db.module';
import { areas, teams } from '../db/schema';

/** "Maputo Central" → "MAPUTO_CENTRAL": letters and digits only, accents dropped. */
export function codeFrom(name: string): string {
  const code = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return code || 'AREA';
}

/** Rings closed (first point repeated at the end), as PostGIS expects; the map drawing leaves them open. */
function closed(boundary: Boundary): Boundary {
  const close = (ring: [number, number][]) => {
    const [first, last] = [ring[0]!, ring[ring.length - 1]!];
    return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
  };
  return boundary.type === 'Polygon'
    ? { type: 'Polygon', coordinates: boundary.coordinates.map(close) }
    : { type: 'MultiPolygon', coordinates: boundary.coordinates.map((p) => p.map(close)) };
}

const geometry = (boundary: Boundary) =>
  sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(closed(boundary))}), 4326))`;

/**
 * Settings → Areas and teams. A ticket goes to the area its place lies in, and to the area's first team (by code);
 * areas may not overlap, so every place has one answer.
 */
@Injectable()
export class AreasService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async list(): Promise<AreaView[]> {
    const rows = await this.db.execute<{
      id: string;
      code: string;
      name: string;
      geojson: string;
      size_km2: number;
      open_tickets: number;
      teams: { id: string; code: string; name: string; people: number; managers: string[] }[] | null;
    }>(sql`
      select a.id, a.code, a.name, ST_AsGeoJSON(a.boundary, 6) as geojson,
        round((ST_Area(a.boundary::geography) / 1e6)::numeric, 1)::float as size_km2,
        (select count(*)::int from tickets x where x.area_id = a.id and x.status not in ('closed', 'cancelled')) as open_tickets,
        (select json_agg(json_build_object(
            'id', t.id, 'code', t.code, 'name', t.name,
            'people', (select count(*)::int from users u where u.team_id = t.id and u.status = 'active'),
            'managers', coalesce((select json_agg(u.full_name order by u.full_name) from users u
              where u.team_id = t.id and u.status = 'active' and 'team_manager' = any(u.roles)), '[]'::json)
          ) order by t.code)
          from teams t where t.area_id = a.id) as teams
      from areas a
      order by a.name`);
    return rows.rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      boundary: (JSON.parse(r.geojson) as { coordinates: [number, number][][][] }).coordinates,
      sizeKm2: r.size_km2,
      openTickets: r.open_tickets,
      teams: r.teams ?? []
    }));
  }

  async createArea(input: CreateArea): Promise<AreaView> {
    const id = await this.db.transaction(async (tx) => {
      await this.checkBoundary(tx, input.boundary, null);
      const code = await this.freeCode(tx, 'areas', codeFrom(input.name));
      const [row] = await tx
        .insert(areas)
        .values({ code, name: input.name, boundary: sql`${geometry(input.boundary)}` as unknown as string })
        .returning({ id: areas.id });
      return row!.id;
    });
    return this.get(id);
  }

  async updateArea(id: string, input: UpdateArea): Promise<AreaView> {
    await this.get(id);
    await this.db.transaction(async (tx) => {
      if (input.boundary) await this.checkBoundary(tx, input.boundary, id);
      await tx
        .update(areas)
        .set({
          ...(input.name ? { name: input.name } : {}),
          ...(input.boundary ? { boundary: sql`${geometry(input.boundary)}` as unknown as string } : {})
        })
        .where(eq(areas.id, id));
    });
    return this.get(id);
  }

  /** Only an area never used: no team, and no ticket recorded in it (history keeps the area). */
  async deleteArea(id: string): Promise<void> {
    const area = await this.get(id);
    if (area.teams.length) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'AREA_HAS_TEAMS',
        'Move or delete the teams of this area first'
      );
    }
    const [{ used }] = (
      await this.db.execute<{ used: boolean }>(
        sql`select exists(select 1 from tickets where area_id = ${id}) or exists(select 1 from stock_locations where area_id = ${id}) as used`
      )
    ).rows;
    if (used) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'AREA_IN_USE',
        'Tickets or depots belong to this area; it is kept for history'
      );
    }
    await this.db.delete(areas).where(eq(areas.id, id));
  }

  async createTeam(input: CreateTeam): Promise<TeamView> {
    await this.get(input.areaId);
    const id = await this.db.transaction(async (tx) => {
      const code = await this.freeCode(tx, 'teams', codeFrom(input.name));
      const [row] = await tx
        .insert(teams)
        .values({ code, name: input.name, areaId: input.areaId })
        .returning({ id: teams.id });
      return row!.id;
    });
    return this.team(id);
  }

  /** Renaming or moving a team to another area; its people and open tickets go with it. */
  async updateTeam(id: string, input: UpdateTeam): Promise<TeamView> {
    await this.team(id);
    if (input.areaId) await this.get(input.areaId);
    await this.db
      .update(teams)
      .set({ ...(input.name ? { name: input.name } : {}), ...(input.areaId ? { areaId: input.areaId } : {}) })
      .where(eq(teams.id, id));
    return this.team(id);
  }

  /** Only a team never used: nobody in it, and no ticket, van or help request recorded for it. */
  async deleteTeam(id: string): Promise<void> {
    await this.team(id);
    const [{ used }] = (
      await this.db.execute<{ used: boolean }>(sql`select
        exists(select 1 from users where team_id = ${id})
        or exists(select 1 from tickets where team_id = ${id})
        or exists(select 1 from vehicles where team_id = ${id})
        or exists(select 1 from stock_locations where team_id = ${id})
        or exists(select 1 from help_requests where team_id = ${id}) as used`)
    ).rows;
    if (used) {
      throw new AppError(
        HttpStatus.CONFLICT,
        'TEAM_IN_USE',
        'People, tickets or vans belong to this team; move the people to another team, the team is kept for history'
      );
    }
    await this.db.delete(teams).where(eq(teams.id, id));
  }

  private async get(id: string): Promise<AreaView> {
    const area = (await this.list()).find((a) => a.id === id);
    if (!area) throw notFound('Area');
    return area;
  }

  private async team(id: string): Promise<TeamView> {
    const [row] = await this.db
      .select({ id: teams.id, code: teams.code, name: teams.name, areaName: areas.name })
      .from(teams)
      .innerJoin(areas, eq(areas.id, teams.areaId))
      .where(eq(teams.id, id));
    if (!row) throw notFound('Team');
    return row;
  }

  /** A valid shape that does not overlap another area (touching along an edge is fine). */
  private async checkBoundary(tx: Tx, boundary: Boundary, ignoreId: string | null): Promise<void> {
    const shape = geometry(boundary);
    let valid: { valid: boolean; reason: string };
    try {
      [valid] = (
        await tx.execute<{ valid: boolean; reason: string }>(
          sql`select ST_IsValid(${shape}) as valid, ST_IsValidReason(${shape}) as reason`
        )
      ).rows as [{ valid: boolean; reason: string }];
    } catch {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BOUNDARY_INVALID',
        'The boundary is not a valid shape'
      );
    }
    if (!valid.valid) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BOUNDARY_INVALID',
        'The boundary crosses itself or is not closed',
        { reason: valid.reason }
      );
    }
    const overlaps = await tx.execute<{ name: string }>(sql`
      select name from areas
      where (${ignoreId}::uuid is null or id <> ${ignoreId}::uuid)
        and ST_Intersects(boundary, ${shape})
        and ST_Area(ST_Intersection(boundary, ${shape})::geography) > 1
      order by name`);
    if (overlaps.rows.length) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AREAS_OVERLAP',
        `The boundary overlaps ${overlaps.rows.map((r) => r.name).join(', ')}`,
        { areas: overlaps.rows.map((r) => r.name) }
      );
    }
  }

  /** The code, or the code with a number added when it is taken. */
  private async freeCode(tx: Tx, table: 'areas' | 'teams', base: string): Promise<string> {
    const taken = new Set(
      (
        await tx.execute<{ code: string }>(
          sql`select code from ${sql.identifier(table)} where code = ${base} or code like ${`${base}\\_%`}`
        )
      ).rows.map((r) => r.code)
    );
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  }
}
