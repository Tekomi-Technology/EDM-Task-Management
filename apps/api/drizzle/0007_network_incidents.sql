CREATE TYPE "public"."alarm_severity" AS ENUM('critical', 'major', 'minor', 'warning');--> statement-breakpoint
CREATE TABLE "alarms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alarm_id" text NOT NULL,
	"element_code" text NOT NULL,
	"element_name" text,
	"element_type" text,
	"parent_element_code" text,
	"correlation_id" text,
	"alarm_type" text NOT NULL,
	"severity" "alarm_severity" NOT NULL,
	"location" geometry(Point, 4326),
	"customers_affected" integer,
	"details" text,
	"raised_at" timestamp with time zone NOT NULL,
	"cleared_at" timestamp with time zone,
	"ticket_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alarms_alarm_id_unique" UNIQUE("alarm_id")
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "element_code" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "element_name" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "severity" "alarm_severity";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "customers_affected" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "incident_id" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "acknowledged_by" uuid;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "scheduled_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "scheduled_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "outage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "escalation_level" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alarms" ADD CONSTRAINT "alarms_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alarms_ticket_idx" ON "alarms" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "alarms_element_idx" ON "alarms" USING btree ("element_code");--> statement-breakpoint
CREATE INDEX "alarms_correlation_idx" ON "alarms" USING btree ("correlation_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_incident_id_tickets_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_type_status_idx" ON "tickets" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "tickets_incident_idx" ON "tickets" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "tickets_element_idx" ON "tickets" USING btree ("element_code");