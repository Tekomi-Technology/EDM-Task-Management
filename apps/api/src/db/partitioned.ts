import { sql } from 'drizzle-orm';
import { jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { point } from './types';

/**
 * Tables partitioned by month. Their DDL is in drizzle/0001_partitions.sql (hand-written);
 * these definitions only give Drizzle the column types for queries.
 */
export const ticketEvents = pgTable(
  'ticket_events',
  {
    id: uuid('id').notNull().defaultRandom(),
    ticketId: uuid('ticket_id').notNull(),
    type: text('type').notNull(),
    actorUserId: uuid('actor_user_id'),
    /** Who did it, for actors without a user row (e.g. "Call Center system"). */
    actorLabel: text('actor_label'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`)
  },
  (t) => [primaryKey({ columns: [t.id, t.createdAt] })]
);

export const staffLocations = pgTable(
  'staff_locations',
  {
    userId: uuid('user_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    location: point('location').notNull(),
    accuracyM: real('accuracy_m')
  },
  (t) => [primaryKey({ columns: [t.userId, t.recordedAt] })]
);
