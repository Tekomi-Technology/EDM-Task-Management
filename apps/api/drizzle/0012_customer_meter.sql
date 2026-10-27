ALTER TABLE "customers" ADD COLUMN "meter_number" text;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_meter_number_unique" UNIQUE("meter_number");--> statement-breakpoint
-- Meters fitted before this column existed: the latest installation recorded on each customer's connections.
UPDATE "customers" c SET "meter_number" = m.meter
FROM (
	SELECT DISTINCT ON (customer_id) customer_id, details->'installation'->>'meterNumber' AS meter
	FROM tickets
	WHERE type = 'new_connection' AND details->'installation'->>'meterNumber' IS NOT NULL
	ORDER BY customer_id, updated_at DESC
) m
WHERE m.customer_id = c.id
	AND NOT EXISTS (SELECT 1 FROM customers o WHERE o.meter_number = m.meter);
