ALTER TABLE "tickets" ADD COLUMN "offered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "offer_round" smallint DEFAULT 0 NOT NULL;