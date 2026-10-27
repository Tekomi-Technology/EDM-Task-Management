import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { ENV, type Env } from '../config/env';
import * as partitioned from './partitioned';
import * as schema from './schema';

export const fullSchema = { ...schema, ...partitioned };
export type Db = NodePgDatabase<typeof fullSchema>;
/** A Drizzle transaction handle; services accept `Db | Tx` so they can join a caller's transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export function createDb(databaseUrl: string): { pool: Pool; db: Db } {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return { pool, db: drizzle(pool, { schema: fullSchema }) };
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => new Pool({ connectionString: env.DATABASE_URL, max: 10 })
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema: fullSchema })
    }
  ],
  exports: [DB, PG_POOL]
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
