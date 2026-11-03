-- Four roles (2026-11-03): NOC becomes part of the operations supervisor (technical_manager); the network team and
-- BO support roles are dropped. Accounts stay as they are; only the roles change, keeping their order, once each.
UPDATE "users"
SET "roles" = ARRAY(
  SELECT r
  FROM (
    SELECT DISTINCT ON (r) r, ord
    FROM unnest(array_replace("roles", 'noc', 'technical_manager')) WITH ORDINALITY AS x (r, ord)
    WHERE r NOT IN ('network_team', 'bo_support')
    ORDER BY r, ord
  ) kept
  ORDER BY ord
)
WHERE "roles" && ARRAY['noc', 'network_team', 'bo_support']::text[];
