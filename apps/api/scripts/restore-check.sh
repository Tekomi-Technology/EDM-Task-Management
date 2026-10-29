#!/usr/bin/env bash
# Restore drill: takes a backup, restores the application database into a scratch database, and checks that
# every table holds the same number of rows as the live one. Run it after changing the backup set-up, and
# regularly (a backup that was never restored is a hope, not a backup). Exits non-zero when anything differs.
set -euo pipefail
cd "$(dirname "$0")/.."
# On the server the backend's settings are in .env here; on a developer machine there is none.
if [[ -f .env ]]; then DEFAULT_COMPOSE=docker-compose.yml DEFAULT_ENV=.env; else DEFAULT_COMPOSE=docker-compose.dev.yml DEFAULT_ENV=; fi
COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE}"
ENV_FILE="${ENV_FILE-$DEFAULT_ENV}"
compose() { docker compose -f "$COMPOSE_FILE" ${ENV_FILE:+--env-file "$ENV_FILE"} "$@"; }
check_db="edm_restore_check"

counts() {
  # Exact row count of every table (partitions counted through their parent).
  compose exec -T postgres psql -U edm -d "$1" -tA -v ON_ERROR_STOP=1 -c "
    select string_agg(format('select %L as t, count(*) as n from %I.%I', c.relname, n.nspname, c.relname), ' union all ')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname in ('public', 'drizzle') and not c.relispartition
      and c.relname <> 'spatial_ref_sys'" |
    compose exec -T postgres psql -U edm -d "$1" -tA -F' ' | sort
}

before="$(counts edm)"
BACKUP_DIR="${BACKUP_DIR:-./backups}" DATABASES=edm ENV_FILE="$ENV_FILE" scripts/backup.sh >/dev/null
latest="$(ls -1d "${BACKUP_DIR:-./backups}"/20* | sort | tail -1)"
scripts/restore.sh "$latest" --into "$check_db" >/dev/null
after="$(counts "$check_db")"
compose exec -T postgres psql -U edm -d postgres -c "DROP DATABASE \"$check_db\" WITH (FORCE)" >/dev/null

if [[ "$before" == "$after" ]]; then
  echo "Restore check passed: $(wc -l <<< "$after") tables, $(awk '{s += $2} END {print s}' <<< "$after") rows, same as live ($(basename "$latest"))."
else
  echo "Restore check FAILED: row counts differ (live < > restored):" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
