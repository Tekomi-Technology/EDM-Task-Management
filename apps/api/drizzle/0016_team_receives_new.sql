ALTER TABLE "teams" ADD COLUMN "receives_new" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "teams" SET "receives_new" = true WHERE "id" IN (SELECT DISTINCT ON ("area_id") "id" FROM "teams" ORDER BY "area_id", "code");
