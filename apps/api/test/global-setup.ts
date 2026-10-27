import { runMigrations } from '../src/db/migrate';

/** Applies migrations to the test database once before all test files. */
export default async function setup(): Promise<void> {
  await runMigrations(
    process.env.TEST_DATABASE_URL ?? 'postgres://edm:edm_dev_password@localhost:55432/edm_test'
  );
}
