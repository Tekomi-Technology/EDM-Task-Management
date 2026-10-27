CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'on_hold' BEFORE 'resolved';--> statement-breakpoint
ALTER TYPE "public"."ticket_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "on_duty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_assigned_at" timestamp with time zone;--> statement-breakpoint
-- Keep the meaning of the old flag: inactive accounts become blocked.
UPDATE "users" SET "status" = CASE WHEN "active" THEN 'active'::"user_status" ELSE 'blocked'::"user_status" END;
