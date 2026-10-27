import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadEnv } from '../config/env';
import { createDb } from './db.module';

export const MIGRATIONS_FOLDER = resolve(__dirname, '../../drizzle');

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { pool, db } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations(loadEnv().DATABASE_URL)
    .then(() => console.log('Migrations applied'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
