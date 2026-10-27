-- now() is the same for every row written in one transaction, so a ticket's history could come back out of order
-- (e.g. "created" and the automatic "assign"). clock_timestamp() gives each event its own time.
ALTER TABLE "ticket_events" ALTER COLUMN "created_at" SET DEFAULT clock_timestamp();
