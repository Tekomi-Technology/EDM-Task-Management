import { defineConfig } from 'drizzle-kit';

// Partitioned tables (ticket_events, staff_locations) live in src/db/partitioned.ts and are created by
// a hand-written migration, because drizzle-kit cannot generate PARTITION BY.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://edm:edm_dev_password@localhost:55432/edm' }
});
