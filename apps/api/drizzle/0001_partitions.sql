-- Hand-written: drizzle-kit cannot generate partitioned tables.
-- ticket_events and staff_locations grow fast, so they are partitioned by month.

CREATE TABLE "ticket_events" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "tickets"("id"),
	"type" text NOT NULL,
	"actor_user_id" uuid REFERENCES "users"("id"),
	"actor_label" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
CREATE INDEX "ticket_events_ticket_idx" ON "ticket_events" ("ticket_id", "created_at");
--> statement-breakpoint
CREATE TABLE "staff_locations" (
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"recorded_at" timestamp with time zone NOT NULL,
	"location" geometry(Point, 4326) NOT NULL,
	"accuracy_m" real,
	PRIMARY KEY ("user_id", "recorded_at")
) PARTITION BY RANGE ("recorded_at");
--> statement-breakpoint
-- Creates one partition per month for parent_table, from last month up to months_ahead months from now.
-- Safe to run repeatedly; the API runs it on startup and every day.
CREATE OR REPLACE FUNCTION ensure_month_partitions(parent_table text, months_ahead int)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
	month_start date;
	partition_name text;
BEGIN
	FOR i IN -1..months_ahead LOOP
		month_start := (date_trunc('month', now()) + make_interval(months => i))::date;
		partition_name := format('%s_y%sm%s', parent_table, to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
		IF to_regclass(partition_name) IS NULL THEN
			EXECUTE format(
				'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
				partition_name, parent_table, month_start, (month_start + interval '1 month')::date
			);
		END IF;
	END LOOP;
END;
$$;
--> statement-breakpoint
SELECT ensure_month_partitions('ticket_events', 3);
--> statement-breakpoint
SELECT ensure_month_partitions('staff_locations', 3);
