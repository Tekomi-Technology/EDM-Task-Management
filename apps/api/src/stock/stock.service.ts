import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdjustStock,
  DepotInput,
  MaterialLine,
  MovementQuery,
  MovementView,
  MyVan,
  ReceiveStock,
  StockItemInput,
  StockItemView,
  StockLevel,
  StockLine,
  StockLocationView,
  TransferStock,
  UpdateDepot,
  VehicleInput,
  VehicleView
} from '../contract';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { actorLabel, type AuthUser } from '../auth/auth-user';
import { AppError, notFound } from '../common/errors';
import { DB, type Db, type Tx } from '../db/db.module';
import {
  areas,
  stockItems,
  stockLocations,
  stockMovements,
  stockReservations,
  teams,
  ticketMaterials,
  tickets,
  users,
  vehicles
} from '../db/schema';

const fromLoc = alias(stockLocations, 'from_loc');
const toLoc = alias(stockLocations, 'to_loc');

/** Quantities are stored as doubles; round to 3 decimals when adding them up. */
const round = (n: number) => Math.round(n * 1000) / 1000;

function level(free: number, item: { lowLevel: number; watchLevel: number }): StockLevel {
  if (free <= item.lowLevel) return 'low';
  if (free <= item.watchLevel) return 'watch';
  return 'good';
}

/**
 * Stock kept as a ledger: every receipt, transfer, use on a job and correction is one movement; what is in a
 * place is the sum of what came in minus what went out. Nothing is edited after the fact.
 */
@Injectable()
export class StockService {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- Reading ----

  /** Balance of each item in each place (only non-zero), from the ledger. */
  private async balances(
    db: Db | Tx,
    locationIds?: string[]
  ): Promise<{ locationId: string; itemId: string; quantity: number }[]> {
    const filter = locationIds?.length
      ? sql`where location_id in (${sql.join(
          locationIds.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql``;
    const result = await db.execute<{ location_id: string; item_id: string; quantity: number }>(sql`
      select location_id, item_id, round(sum(q)::numeric, 3)::float8 as quantity from (
        select to_location_id as location_id, item_id, quantity as q from stock_movements where to_location_id is not null
        union all
        select from_location_id, item_id, -quantity from stock_movements where from_location_id is not null
      ) m ${filter}
      group by location_id, item_id
      having round(sum(q)::numeric, 3) <> 0`);
    return result.rows.map((r) => ({
      locationId: r.location_id,
      itemId: r.item_id,
      quantity: Number(r.quantity)
    }));
  }

  private async reservedBy(db: Db | Tx): Promise<{ locationId: string; itemId: string; quantity: number }[]> {
    const rows = await db
      .select({
        locationId: stockReservations.locationId,
        itemId: stockReservations.itemId,
        quantity: sql<number>`sum(${stockReservations.quantity})::float8`
      })
      .from(stockReservations)
      .where(isNull(stockReservations.releasedAt))
      .groupBy(stockReservations.locationId, stockReservations.itemId);
    return rows.map((r) => ({ ...r, quantity: Number(r.quantity) }));
  }

  /** The catalogue with totals in depots and vans, what is reserved, and whether to order more. */
  async items(): Promise<StockItemView[]> {
    const [items, locations, balances, reserved] = await Promise.all([
      this.db.select().from(stockItems).where(eq(stockItems.active, true)).orderBy(asc(stockItems.name)),
      this.db.select({ id: stockLocations.id, kind: stockLocations.kind }).from(stockLocations),
      this.balances(this.db),
      this.reservedBy(this.db)
    ]);
    const kindOf = new Map(locations.map((l) => [l.id, l.kind]));
    return items.map((item) => {
      const sumWhere = (kind: 'depot' | 'van') =>
        round(
          balances
            .filter((b) => b.itemId === item.id && kindOf.get(b.locationId) === kind)
            .reduce((a, b) => a + b.quantity, 0)
        );
      const inDepots = sumWhere('depot');
      const res = round(reserved.filter((r) => r.itemId === item.id).reduce((a, b) => a + b.quantity, 0));
      return {
        id: item.id,
        code: item.code,
        name: item.name,
        unit: item.unit,
        lowLevel: item.lowLevel,
        watchLevel: item.watchLevel,
        inDepots,
        inVans: sumWhere('van'),
        reserved: res,
        level: level(inDepots - res, item)
      };
    });
  }

  async locations(): Promise<StockLocationView[]> {
    return this.db
      .select({
        id: stockLocations.id,
        kind: stockLocations.kind,
        code: stockLocations.code,
        name: stockLocations.name,
        areaId: stockLocations.areaId,
        areaName: areas.name,
        teamId: stockLocations.teamId,
        teamName: teams.name
      })
      .from(stockLocations)
      .leftJoin(areas, eq(areas.id, stockLocations.areaId))
      .leftJoin(teams, eq(teams.id, stockLocations.teamId))
      .orderBy(asc(stockLocations.kind), asc(stockLocations.name));
  }

  /** A new depot for an area that has none yet: one depot per area receives its stock and holds its reservations. */
  async createDepot(input: DepotInput): Promise<StockLocationView> {
    const id = await this.db.transaction(async (tx) => {
      // One at a time, so two people adding a depot for the same area cannot both succeed.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('depots'))`);
      const [area] = await tx.select({ id: areas.id }).from(areas).where(eq(areas.id, input.areaId));
      if (!area) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'AREA_NOT_FOUND', 'Area not found');
      const [existing] = await tx
        .select({ name: stockLocations.name })
        .from(stockLocations)
        .where(and(eq(stockLocations.kind, 'depot'), eq(stockLocations.areaId, input.areaId)));
      if (existing) {
        throw new AppError(
          HttpStatus.CONFLICT,
          'AREA_HAS_DEPOT',
          `This area already has a depot: ${existing.name}`
        );
      }
      await this.checkDepotCode(tx, input.code, null);
      const [row] = await tx
        .insert(stockLocations)
        .values({ kind: 'depot', code: input.code, name: input.name, areaId: input.areaId })
        .returning({ id: stockLocations.id });
      return row!.id;
    });
    return (await this.locations()).find((l) => l.id === id)!;
  }

  /** Corrects a depot's name or code (the code must match EDM's stock system for its receipts to arrive). */
  async updateDepot(id: string, input: UpdateDepot): Promise<StockLocationView> {
    await this.db.transaction(async (tx) => {
      const loc = await this.location(tx, id);
      if (loc.kind !== 'depot') throw notFound('Depot');
      if (input.code) await this.checkDepotCode(tx, input.code, id);
      await tx
        .update(stockLocations)
        .set({ ...(input.code ? { code: input.code } : {}), ...(input.name ? { name: input.name } : {}) })
        .where(eq(stockLocations.id, id));
    });
    return (await this.locations()).find((l) => l.id === id)!;
  }

  private async checkDepotCode(tx: Tx, code: string, ignoreId: string | null): Promise<void> {
    const [taken] = await tx
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(eq(stockLocations.code, code));
    if (taken && taken.id !== ignoreId) {
      throw new AppError(HttpStatus.CONFLICT, 'DEPOT_CODE_TAKEN', `The code ${code} is already used`);
    }
  }

  /** What is in one place, with what is reserved there. */
  async locationStock(locationId: string, db: Db | Tx = this.db): Promise<StockLine[]> {
    const [balances, reserved, items] = await Promise.all([
      this.balances(db, [locationId]),
      this.reservedBy(db),
      db.select().from(stockItems)
    ]);
    const byId = new Map(items.map((i) => [i.id, i]));
    const itemIds = new Set([
      ...balances.map((b) => b.itemId),
      ...reserved.filter((r) => r.locationId === locationId).map((r) => r.itemId)
    ]);
    return [...itemIds]
      .map((itemId) => {
        const item = byId.get(itemId)!;
        return {
          itemId,
          code: item.code,
          name: item.name,
          unit: item.unit,
          quantity: balances.find((b) => b.itemId === itemId)?.quantity ?? 0,
          reserved: round(
            reserved
              .filter((r) => r.itemId === itemId && r.locationId === locationId)
              .reduce((a, b) => a + b.quantity, 0)
          )
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async movements(q: MovementQuery): Promise<MovementView[]> {
    const rows = await this.db
      .select({
        id: stockMovements.id,
        kind: stockMovements.kind,
        itemCode: stockItems.code,
        itemName: stockItems.name,
        unit: stockItems.unit,
        quantity: stockMovements.quantity,
        from: fromLoc.name,
        to: toLoc.name,
        ticketId: stockMovements.ticketId,
        ticketCode: tickets.code,
        actorName: users.fullName,
        actorLabel: stockMovements.actorLabel,
        reference: stockMovements.reference,
        note: stockMovements.note,
        createdAt: stockMovements.createdAt
      })
      .from(stockMovements)
      .innerJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
      .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
      .leftJoin(toLoc, eq(toLoc.id, stockMovements.toLocationId))
      .leftJoin(tickets, eq(tickets.id, stockMovements.ticketId))
      .leftJoin(users, eq(users.id, stockMovements.actorUserId))
      .where(
        and(
          q.itemId ? eq(stockMovements.itemId, q.itemId) : undefined,
          q.kind ? eq(stockMovements.kind, q.kind) : undefined,
          q.locationId
            ? sql`(${stockMovements.fromLocationId} = ${q.locationId} or ${stockMovements.toLocationId} = ${q.locationId})`
            : undefined
        )
      )
      .orderBy(desc(stockMovements.createdAt))
      .limit(q.limit);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      itemCode: r.itemCode,
      itemName: r.itemName,
      unit: r.unit,
      quantity: r.quantity,
      from: r.from,
      to: r.to,
      ticket: r.ticketId ? { id: r.ticketId, code: r.ticketCode! } : null,
      actorName: r.actorName ?? r.actorLabel,
      reference: r.reference,
      note: r.note,
      createdAt: r.createdAt.toISOString()
    }));
  }

  // ---- Writing ----

  /** Serialises changes to one item in one place, so two transfers cannot both take the last unit. */
  private async lock(tx: Tx, locationId: string, itemId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${locationId}:${itemId}`}))`);
  }

  /** What can be taken from a place: its balance minus what is reserved there. */
  private async available(tx: Tx, locationId: string, itemId: string): Promise<number> {
    const [balance] = (await this.balances(tx, [locationId])).filter((b) => b.itemId === itemId);
    const [{ reserved }] = await tx
      .select({ reserved: sql<number>`coalesce(sum(${stockReservations.quantity}), 0)::float8` })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.locationId, locationId),
          eq(stockReservations.itemId, itemId),
          isNull(stockReservations.releasedAt)
        )
      );
    return round((balance?.quantity ?? 0) - Number(reserved));
  }

  private async location(tx: Db | Tx, id: string) {
    const [loc] = await tx.select().from(stockLocations).where(eq(stockLocations.id, id));
    if (!loc) throw notFound('Stock location');
    return loc;
  }

  private async itemNames(tx: Db | Tx, ids: string[]) {
    const rows = await tx.select().from(stockItems).where(inArray(stockItems.id, ids));
    if (rows.length !== new Set(ids).size) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'ITEM_NOT_FOUND', 'Unknown stock item');
    }
    return new Map(rows.map((r) => [r.id, r]));
  }

  async receive(input: ReceiveStock, actor: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const loc = await this.location(tx, input.locationId);
      if (loc.kind !== 'depot') {
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_A_DEPOT', 'Stock is received into a depot');
      }
      await this.itemNames(
        tx,
        input.lines.map((l) => l.itemId)
      );
      await tx.insert(stockMovements).values(
        input.lines.map((l) => ({
          kind: 'receive' as const,
          itemId: l.itemId,
          quantity: l.quantity,
          toLocationId: loc.id,
          actorUserId: actor.userId,
          actorLabel: actorLabel(actor),
          reference: input.reference ?? null,
          note: input.note ?? null
        }))
      );
    });
  }

  /** Moves stock between places; refuses to take more than is there (and not reserved). */
  async transfer(input: TransferStock, actor: AuthUser): Promise<void> {
    if (input.fromLocationId === input.toLocationId) {
      throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'SAME_PLACE', 'Choose two different places');
    }
    await this.db.transaction(async (tx) => {
      await this.location(tx, input.fromLocationId);
      await this.location(tx, input.toLocationId);
      const names = await this.itemNames(
        tx,
        input.lines.map((l) => l.itemId)
      );
      for (const l of input.lines) {
        await this.lock(tx, input.fromLocationId, l.itemId);
        const free = await this.available(tx, input.fromLocationId, l.itemId);
        if (free < l.quantity) {
          const item = names.get(l.itemId)!;
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'NOT_ENOUGH_STOCK',
            `Only ${free} ${item.unit} of ${item.name} can be taken from there`,
            { itemId: l.itemId, available: free }
          );
        }
      }
      await tx.insert(stockMovements).values(
        input.lines.map((l) => ({
          kind: 'transfer' as const,
          itemId: l.itemId,
          quantity: l.quantity,
          fromLocationId: input.fromLocationId,
          toLocationId: input.toLocationId,
          actorUserId: actor.userId,
          actorLabel: actorLabel(actor),
          note: input.note ?? null
        }))
      );
    });
  }

  /** After a stock-take: records the difference between the books and what was counted. */
  async adjust(input: AdjustStock, actor: AuthUser): Promise<number> {
    return this.db.transaction(async (tx) => {
      await this.location(tx, input.locationId);
      await this.itemNames(tx, [input.itemId]);
      await this.lock(tx, input.locationId, input.itemId);
      const [current] = (await this.balances(tx, [input.locationId])).filter(
        (b) => b.itemId === input.itemId
      );
      const diff = round(input.countedQuantity - (current?.quantity ?? 0));
      if (diff === 0) return 0;
      await tx.insert(stockMovements).values({
        kind: 'adjust',
        itemId: input.itemId,
        quantity: Math.abs(diff),
        fromLocationId: diff < 0 ? input.locationId : null,
        toLocationId: diff > 0 ? input.locationId : null,
        actorUserId: actor.userId,
        actorLabel: actorLabel(actor),
        note: input.reason
      });
      return diff;
    });
  }

  // ---- Tickets ----

  /** The depot of the area a ticket is in. */
  private async depotFor(
    tx: Tx,
    ticket: { areaId: string | null; teamId: string | null }
  ): Promise<string | null> {
    let areaId = ticket.areaId;
    if (!areaId && ticket.teamId) {
      [{ areaId }] = await tx.select({ areaId: teams.areaId }).from(teams).where(eq(teams.id, ticket.teamId));
    }
    if (!areaId) return null;
    const [depot] = await tx
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(and(eq(stockLocations.kind, 'depot'), eq(stockLocations.areaId, areaId)));
    return depot?.id ?? null;
  }

  /** What the depot of an area or team could set aside now (its balance minus what is reserved), per item. */
  async freeInDepot(
    place: { areaId: string | null; teamId: string | null },
    itemIds: string[]
  ): Promise<{ depot: { id: string; name: string } | null; free: Map<string, number> }> {
    return this.db.transaction(async (tx) => {
      const depotId = await this.depotFor(tx, place);
      const free = new Map<string, number>();
      if (!depotId) return { depot: null, free };
      for (const id of itemIds) free.set(id, await this.available(tx, depotId, id));
      const loc = await this.location(tx, depotId);
      return { depot: { id: depotId, name: loc!.name }, free };
    });
  }

  /**
   * Sets material aside in the ticket's depot. With `partial`, reserves what is available and returns what could
   * not be (used for estimates from surveys); otherwise refuses if anything is missing.
   */
  async reserve(
    tx: Tx,
    ticket: { id: string; areaId: string | null; teamId: string | null },
    lines: MaterialLine[],
    partial = false
  ): Promise<MaterialLine[]> {
    const depot = await this.depotFor(tx, ticket);
    if (!depot) {
      if (partial) return lines;
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'NO_DEPOT',
        'This ticket has no depot to reserve from'
      );
    }
    const names = await this.itemNames(
      tx,
      lines.map((l) => l.itemId)
    );
    const missing: MaterialLine[] = [];
    for (const l of lines) {
      await this.lock(tx, depot, l.itemId);
      const free = await this.available(tx, depot, l.itemId);
      const take = partial ? Math.min(free, l.quantity) : l.quantity;
      if (!partial && free < l.quantity) {
        const item = names.get(l.itemId)!;
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'NOT_ENOUGH_STOCK',
          `Only ${free} ${item.unit} of ${item.name} are free in the depot`,
          { itemId: l.itemId, available: free }
        );
      }
      if (take > 0) {
        await tx
          .insert(stockReservations)
          .values({ ticketId: ticket.id, itemId: l.itemId, locationId: depot, quantity: take });
      }
      if (take < l.quantity) missing.push({ itemId: l.itemId, quantity: round(l.quantity - take) });
    }
    return missing;
  }

  async releaseReservations(tx: Tx, ticketId: string): Promise<void> {
    await tx
      .update(stockReservations)
      .set({ releasedAt: new Date() })
      .where(and(eq(stockReservations.ticketId, ticketId), isNull(stockReservations.releasedAt)));
  }

  /** Materials the staff member used, recorded when they report the job done; taken from their van. */
  async recordMaterials(
    tx: Tx,
    ticket: { id: string; areaId: string | null; teamId: string | null },
    userId: string,
    lines: MaterialLine[]
  ): Promise<void> {
    if (lines.length === 0) return;
    await this.itemNames(
      tx,
      lines.map((l) => l.itemId)
    );
    const [van] = await tx
      .select({ locationId: vehicles.locationId })
      .from(vehicles)
      .where(eq(vehicles.assignedUserId, userId));
    const from = van?.locationId ?? (await this.depotFor(tx, ticket));
    await tx.insert(ticketMaterials).values(
      lines.map((l) => ({
        ticketId: ticket.id,
        itemId: l.itemId,
        quantity: l.quantity,
        fromLocationId: from,
        recordedBy: userId
      }))
    );
  }

  /**
   * When a ticket closes, the materials recorded on it leave stock ("consume"), and its reservations end.
   * Reality wins: a van can go below zero if the books were wrong; the shortfall is returned so it can be noted.
   */
  async postConsumption(
    tx: Tx,
    ticketId: string,
    actor: AuthUser
  ): Promise<{ itemId: string; short: number }[]> {
    const pending = await tx
      .select()
      .from(ticketMaterials)
      .where(and(eq(ticketMaterials.ticketId, ticketId), isNull(ticketMaterials.movementId)));
    const shortfalls: { itemId: string; short: number }[] = [];
    for (const m of pending) {
      const [movement] = await tx
        .insert(stockMovements)
        .values({
          kind: 'consume',
          itemId: m.itemId,
          quantity: m.quantity,
          fromLocationId: m.fromLocationId,
          ticketId,
          // Used by whoever recorded it on the job, not by whoever closed the ticket (often the Call Center or Sales).
          actorUserId: m.recordedBy ?? actor.userId,
          actorLabel: m.recordedBy ? null : actorLabel(actor)
        })
        .returning({ id: stockMovements.id });
      await tx.update(ticketMaterials).set({ movementId: movement!.id }).where(eq(ticketMaterials.id, m.id));
      if (m.fromLocationId) {
        const [after] = (await this.balances(tx, [m.fromLocationId])).filter((b) => b.itemId === m.itemId);
        if ((after?.quantity ?? 0) < 0) shortfalls.push({ itemId: m.itemId, short: -(after?.quantity ?? 0) });
      }
    }
    await this.releaseReservations(tx, ticketId);
    return shortfalls;
  }

  async ticketStock(ticketId: string) {
    const [materials, reservations] = await Promise.all([
      this.db
        .select({
          id: ticketMaterials.id,
          itemId: ticketMaterials.itemId,
          code: stockItems.code,
          name: stockItems.name,
          unit: stockItems.unit,
          quantity: ticketMaterials.quantity,
          fromLocation: stockLocations.name,
          movementId: ticketMaterials.movementId,
          recordedBy: users.fullName,
          createdAt: ticketMaterials.createdAt
        })
        .from(ticketMaterials)
        .innerJoin(stockItems, eq(stockItems.id, ticketMaterials.itemId))
        .leftJoin(stockLocations, eq(stockLocations.id, ticketMaterials.fromLocationId))
        .leftJoin(users, eq(users.id, ticketMaterials.recordedBy))
        .where(eq(ticketMaterials.ticketId, ticketId))
        .orderBy(asc(ticketMaterials.createdAt)),
      this.db
        .select({
          id: stockReservations.id,
          itemId: stockReservations.itemId,
          code: stockItems.code,
          name: stockItems.name,
          unit: stockItems.unit,
          quantity: stockReservations.quantity,
          locationName: stockLocations.name
        })
        .from(stockReservations)
        .innerJoin(stockItems, eq(stockItems.id, stockReservations.itemId))
        .innerJoin(stockLocations, eq(stockLocations.id, stockReservations.locationId))
        .where(and(eq(stockReservations.ticketId, ticketId), isNull(stockReservations.releasedAt)))
    ]);
    return {
      materials: materials.map(({ movementId, createdAt, ...m }) => ({
        ...m,
        posted: !!movementId,
        recordedAt: createdAt.toISOString()
      })),
      reservations
    };
  }

  // ---- Catalogue ----

  async upsertItems(items: StockItemInput[]): Promise<number> {
    for (const i of items) {
      await this.db
        .insert(stockItems)
        .values(i)
        .onConflictDoUpdate({
          target: stockItems.code,
          set: { name: i.name, unit: i.unit, lowLevel: i.lowLevel, watchLevel: i.watchLevel, active: true }
        });
    }
    return items.length;
  }

  async catalog() {
    return this.db
      .select({ id: stockItems.id, code: stockItems.code, name: stockItems.name, unit: stockItems.unit })
      .from(stockItems)
      .where(eq(stockItems.active, true))
      .orderBy(asc(stockItems.name));
  }

  // ---- Who may move stock ----

  /** Team managers move stock only in their area's depot and their team's vans; managers above them anywhere. */
  async assertCanManage(actor: AuthUser, locationIds: string[]): Promise<void> {
    if (actor.roles.some((r) => r === 'admin' || r === 'technical_manager')) return;
    if (!actor.roles.includes('team_manager') || !actor.teamId) {
      throw new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN_ROLE', 'You cannot move stock');
    }
    const [team] = await this.db
      .select({ areaId: teams.areaId })
      .from(teams)
      .where(eq(teams.id, actor.teamId));
    const locs = await this.db.select().from(stockLocations).where(inArray(stockLocations.id, locationIds));
    for (const l of locs) {
      const mine = l.kind === 'van' ? l.teamId === actor.teamId : l.areaId === team?.areaId;
      if (!mine) throw new AppError(HttpStatus.FORBIDDEN, 'NOT_IN_TEAM', `${l.name} is not your team’s`);
    }
  }

  // ---- EDM's stock management system ----

  /** A receipt from EDM's stock system, by depot and item codes. Sending the same reference again does nothing. */
  async syncReceipt(
    input: { externalRef: string; depotCode: string; lines: { itemCode: string; quantity: number }[] },
    actor: AuthUser
  ): Promise<{ result: 'received' | 'duplicate'; lines: number }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`receipt:${input.externalRef}`}))`);
      const [seen] = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(and(eq(stockMovements.kind, 'receive'), eq(stockMovements.reference, input.externalRef)))
        .limit(1);
      if (seen) return { result: 'duplicate' as const, lines: 0 };
      const [depot] = await tx
        .select()
        .from(stockLocations)
        .where(and(eq(stockLocations.code, input.depotCode), eq(stockLocations.kind, 'depot')));
      if (!depot)
        throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'DEPOT_NOT_FOUND', `No depot ${input.depotCode}`);
      const codes = [...new Set(input.lines.map((l) => l.itemCode))];
      const items = await tx.select().from(stockItems).where(inArray(stockItems.code, codes));
      const missing = codes.filter((c) => !items.some((i) => i.code === c));
      if (missing.length) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'ITEM_NOT_FOUND',
          `Unknown item codes: ${missing.join(', ')}`,
          {
            missing
          }
        );
      }
      await tx.insert(stockMovements).values(
        input.lines.map((l) => ({
          kind: 'receive' as const,
          itemId: items.find((i) => i.code === l.itemCode)!.id,
          quantity: l.quantity,
          toLocationId: depot.id,
          actorLabel: actorLabel(actor),
          reference: input.externalRef
        }))
      );
      return { result: 'received' as const, lines: input.lines.length };
    });
  }

  /** Materials used on jobs since a time, for EDM's stock system to deduct on its side. */
  async consumption(since: string, limit: number) {
    const rows = await this.db
      .select({
        movementId: stockMovements.id,
        itemCode: stockItems.code,
        quantity: stockMovements.quantity,
        unit: stockItems.unit,
        locationCode: fromLoc.code,
        ticketCode: tickets.code,
        usedAt: stockMovements.createdAt
      })
      .from(stockMovements)
      .innerJoin(stockItems, eq(stockItems.id, stockMovements.itemId))
      .leftJoin(fromLoc, eq(fromLoc.id, stockMovements.fromLocationId))
      .leftJoin(tickets, eq(tickets.id, stockMovements.ticketId))
      .where(and(eq(stockMovements.kind, 'consume'), sql`${stockMovements.createdAt} > ${since}`))
      .orderBy(asc(stockMovements.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, usedAt: r.usedAt.toISOString() }));
  }

  // ---- Vehicles (each van is a small stock location) ----

  async vehicles(teamId?: string | null): Promise<VehicleView[]> {
    const rows = await this.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        label: vehicles.label,
        teamId: vehicles.teamId,
        teamName: teams.name,
        locationId: vehicles.locationId,
        assignedId: users.id,
        assignedName: users.fullName
      })
      .from(vehicles)
      .innerJoin(teams, eq(teams.id, vehicles.teamId))
      .leftJoin(users, eq(users.id, vehicles.assignedUserId))
      .where(and(eq(vehicles.active, true), teamId ? eq(vehicles.teamId, teamId) : undefined))
      .orderBy(asc(teams.name), asc(vehicles.plate));
    const balances = await this.balances(
      this.db,
      rows.map((r) => r.locationId)
    );
    return rows.map((r) => ({
      id: r.id,
      plate: r.plate,
      label: r.label,
      teamId: r.teamId,
      teamName: r.teamName,
      locationId: r.locationId,
      assignedTo: r.assignedId ? { id: r.assignedId, fullName: r.assignedName! } : null,
      itemsOnBoard: balances.filter((b) => b.locationId === r.locationId && b.quantity > 0).length
    }));
  }

  async createVehicle(input: VehicleInput): Promise<VehicleView> {
    const id = await this.db.transaction(async (tx) => {
      const [taken] = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.plate, input.plate));
      if (taken)
        throw new AppError(HttpStatus.CONFLICT, 'PLATE_TAKEN', 'A vehicle with this plate already exists');
      const [team] = await tx.select().from(teams).where(eq(teams.id, input.teamId));
      if (!team) throw new AppError(HttpStatus.UNPROCESSABLE_ENTITY, 'TEAM_NOT_FOUND', 'Team not found');
      const [loc] = await tx
        .insert(stockLocations)
        .values({
          kind: 'van',
          code: `VAN-${input.plate}`,
          name: `Van ${input.plate}`,
          areaId: team.areaId,
          teamId: team.id
        })
        .returning({ id: stockLocations.id });
      const [v] = await tx
        .insert(vehicles)
        .values({ plate: input.plate, label: input.label ?? null, teamId: input.teamId, locationId: loc!.id })
        .returning({ id: vehicles.id });
      return v!.id;
    });
    return (await this.vehicles()).find((v) => v.id === id)!;
  }

  /** Gives a van to a field staff member of its team (taking it from whoever had it), or frees it. */
  async assignVehicle(vehicleId: string, userId: string | null, actor: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [v] = await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)).for('update');
      if (!v) throw notFound('Vehicle');
      const isManagerOnly =
        actor.roles.includes('team_manager') &&
        !actor.roles.some((r) => r === 'admin' || r === 'technical_manager');
      if (isManagerOnly && v.teamId !== actor.teamId) {
        throw new AppError(HttpStatus.FORBIDDEN, 'NOT_IN_TEAM', 'This vehicle belongs to another team');
      }
      if (userId) {
        const [u] = await tx.select().from(users).where(eq(users.id, userId));
        if (!u || u.teamId !== v.teamId || u.status !== 'active' || !u.roles.includes('field_staff')) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'NOT_IN_TEAM',
            'Choose active field staff of the vehicle’s team'
          );
        }
        await tx.update(vehicles).set({ assignedUserId: null }).where(eq(vehicles.assignedUserId, userId));
      }
      await tx.update(vehicles).set({ assignedUserId: userId }).where(eq(vehicles.id, vehicleId));
    });
  }

  async myVan(userId: string): Promise<MyVan> {
    const [van] = (await this.vehicles()).filter((v) => v.assignedTo?.id === userId);
    return {
      vehicle: van ?? null,
      lines: van ? (await this.locationStock(van.locationId)).filter((l) => l.quantity > 0) : [],
      catalog: await this.catalog()
    };
  }
}
