import { sql } from 'drizzle-orm';
import type { Db, Tx } from './db.module';

/**
 * Marks a team to get the new tickets in every area that has teams but none marked (a new area's first team, or
 * after the marked one moved away or was deleted): the first by code. A team added later never takes over by itself.
 */
export async function markTeamReceivers(db: Db | Tx): Promise<void> {
  await db.execute(sql`
    update teams set receives_new = true
    where id in (
      select distinct on (x.area_id) x.id from teams x
      where not exists (select 1 from teams y where y.area_id = x.area_id and y.receives_new)
      order by x.area_id, x.code)`);
}
