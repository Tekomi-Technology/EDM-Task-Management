CREATE TYPE "public"."integration_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."integration_system" AS ENUM('call_center', 'sales', 'nms', 'stock', 'sms', 'push');--> statement-breakpoint
CREATE TABLE "integration_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system" "integration_system" NOT NULL,
	"direction" "integration_direction" NOT NULL,
	"operation" text NOT NULL,
	"status_code" integer,
	"ok" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "reopen_count" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "integration_calls_system_idx" ON "integration_calls" USING btree ("system","created_at");--> statement-breakpoint
CREATE INDEX "integration_calls_created_idx" ON "integration_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tickets_closed_at_idx" ON "tickets" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "tickets_resolved_at_idx" ON "tickets" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");--> statement-breakpoint
-- Tickets fixed before these columns existed: take the last "reported fixed" time and the reopen count from the history.
UPDATE "tickets" t SET "resolved_at" = e.at
FROM (
	SELECT ticket_id, max(coalesce((data->>'occurredAt')::timestamptz, created_at)) AS at
	FROM ticket_events WHERE type = 'resolve' GROUP BY ticket_id
) e
WHERE e.ticket_id = t.id;--> statement-breakpoint
UPDATE "tickets" t SET "reopen_count" = e.n
FROM (SELECT ticket_id, count(*)::smallint AS n FROM ticket_events WHERE type = 'reopen' GROUP BY ticket_id) e
WHERE e.ticket_id = t.id;
