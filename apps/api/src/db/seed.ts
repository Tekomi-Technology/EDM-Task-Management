import { eq, sql } from 'drizzle-orm';
import { sha256 } from '../auth/tokens';
import { loadEnv } from '../config/env';
import { createDb, type Db } from './db.module';
import {
  apiKeys,
  areas,
  customers,
  stockItems,
  stockLocations,
  stockMovements,
  teams,
  users,
  vehicles
} from './schema';
import {
  SEED_API_KEYS,
  SEED_AREAS,
  SEED_CUSTOMERS,
  SEED_DEPOTS,
  SEED_ITEMS,
  SEED_PASSWORD_HASH,
  SEED_STOCK,
  SEED_TEAMS,
  SEED_USERS,
  SEED_VANS
} from './seed-data';

/** Inserts or refreshes the sample areas, teams, users and customers. Safe to run repeatedly. */
export async function seed(db: Db): Promise<void> {
  for (const a of SEED_AREAS) {
    await db
      .insert(areas)
      .values({ code: a.code, name: a.name, boundary: a.wkt })
      .onConflictDoUpdate({ target: areas.code, set: { name: a.name, boundary: a.wkt } });
  }
  const areaRows = await db.select({ id: areas.id, code: areas.code }).from(areas);
  const areaId = (code: string) => areaRows.find((r) => r.code === code)!.id;

  for (const t of SEED_TEAMS) {
    await db
      .insert(teams)
      .values({ code: t.code, name: t.name, areaId: areaId(t.areaCode) })
      .onConflictDoUpdate({ target: teams.code, set: { name: t.name, areaId: areaId(t.areaCode) } });
  }
  const teamRows = await db.select({ id: teams.id, code: teams.code }).from(teams);
  const teamId = (code: string | null) => (code ? teamRows.find((r) => r.code === code)!.id : null);

  for (const u of SEED_USERS) {
    const values = {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      phone: u.phone,
      teamId: teamId(u.team),
      roles: [...u.roles],
      passwordHash: SEED_PASSWORD_HASH
    };
    await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
        target: users.id,
        // Sample accounts always sign in with the sample password, also in a database made before passwords.
        set: {
          fullName: values.fullName,
          phone: values.phone,
          teamId: values.teamId,
          roles: values.roles,
          passwordHash: values.passwordHash
        }
      });
  }

  for (const k of SEED_API_KEYS) {
    await db
      .insert(apiKeys)
      .values({ system: k.system, name: k.name, prefix: k.key.slice(0, 12), keyHash: sha256(k.key) })
      .onConflictDoNothing();
  }

  await seedStock(db, areaId, teamId);

  for (const c of SEED_CUSTOMERS) {
    const values = {
      contractNo: c.contractNo,
      meterNumber: c.meterNumber,
      fullName: c.fullName,
      phone: c.phone,
      address: c.address,
      location: { lng: c.lng, lat: c.lat }
    };
    await db
      .insert(customers)
      .values(values)
      .onConflictDoUpdate({ target: customers.contractNo, set: values });
  }
}

/** Catalogue, depots, vans and opening stock. The opening stock is only booked once (reference SEED). */
async function seedStock(
  db: Db,
  areaId: (code: string) => string,
  teamId: (code: string | null) => string | null
) {
  for (const i of SEED_ITEMS) {
    await db
      .insert(stockItems)
      .values({ ...i })
      .onConflictDoUpdate({
        target: stockItems.code,
        set: { name: i.name, lowLevel: i.lowLevel, watchLevel: i.watchLevel }
      });
  }
  for (const d of SEED_DEPOTS) {
    await db
      .insert(stockLocations)
      .values({ kind: 'depot', code: d.code, name: d.name, areaId: areaId(d.areaCode) })
      .onConflictDoNothing();
  }
  const people = await db.select({ id: users.id, username: users.username }).from(users);
  for (const v of SEED_VANS) {
    const team = teamId(v.team)!;
    const [team_] = await db.select({ areaId: teams.areaId }).from(teams).where(eq(teams.id, team));
    await db
      .insert(stockLocations)
      .values({
        kind: 'van',
        code: `VAN-${v.plate}`,
        name: `Van ${v.plate}`,
        areaId: team_!.areaId,
        teamId: team
      })
      .onConflictDoNothing();
    const [loc] = await db
      .select({ id: stockLocations.id })
      .from(stockLocations)
      .where(eq(stockLocations.code, `VAN-${v.plate}`));
    await db
      .insert(vehicles)
      .values({
        plate: v.plate,
        label: v.label,
        teamId: team,
        locationId: loc!.id,
        assignedUserId: people.find((p) => p.username === v.driver)?.id ?? null
      })
      .onConflictDoNothing();
  }
  const [booked] = await db
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(eq(stockMovements.reference, 'SEED'))
    .limit(1);
  if (booked) return;
  const items = await db.select({ id: stockItems.id, code: stockItems.code }).from(stockItems);
  const locations = await db
    .select({ id: stockLocations.id, code: stockLocations.code })
    .from(stockLocations);
  await db.insert(stockMovements).values(
    SEED_STOCK.map(([where, code, quantity]) => ({
      kind: 'receive' as const,
      itemId: items.find((i) => i.code === code)!.id,
      quantity,
      toLocationId: locations.find((l) => l.code === where || l.code === `VAN-${where}`)!.id,
      actorLabel: 'Opening stock',
      reference: 'SEED'
    }))
  );
}

if (require.main === module) {
  const { pool, db } = createDb(loadEnv().DATABASE_URL);
  seed(db)
    .then(async () => {
      const [{ count }] = (await db.execute<{ count: string }>(sql`select count(*) from users`)).rows;
      console.log(`Seed done (${count} users)`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
