#!/usr/bin/env bash
# Makes a separate database for load tests (edm_load), so a storm never fills the development data:
# schema, sample data, and 20,000 synthetic customers spread over Matola and Maputo.
# Then start an API on it:  pnpm loadtest:api   and run the storm:  pnpm loadtest
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="${LOAD_DB:-edm_load}"
CUSTOMERS="${LOAD_CUSTOMERS:-20000}"
psql() { docker compose -f apps/api/docker-compose.dev.yml exec -T postgres psql -U edm -v ON_ERROR_STOP=1 "$@"; }

psql -d edm -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB OWNER edm"
psql -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS postgis" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
export DATABASE_URL="postgres://edm:edm_dev_password@localhost:55432/$DB"
pnpm --filter @edm/api db:migrate
pnpm --filter @edm/api db:seed
psql -d "$DB" -c "
  INSERT INTO customers (contract_no, full_name, phone, address, location)
  SELECT '5' || lpad(g::text, 7, '0'), 'Load customer ' || g, '+25884' || lpad(g::text, 7, '0'),
         'Synthetic address ' || g,
         ST_SetSRID(ST_MakePoint(32.42 + random() * 0.20, -25.99 + random() * 0.08), 4326)
  FROM generate_series(1, $CUSTOMERS) g"
echo "Load database $DB ready with $CUSTOMERS extra customers."
