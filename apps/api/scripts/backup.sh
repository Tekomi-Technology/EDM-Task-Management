#!/usr/bin/env bash
# Backs up EDM Tasks: the database (tickets, accounts, settings…) as a pg_dump custom-format file checked to be
# readable, plus a mirror of the photo attachments in S3.
#
#   apps/api/scripts/backup.sh     # the server's backend when apps/api/.env exists, else the development one
#
# Settings (environment): BACKUP_DIR (./backups), KEEP_DAYS (14), DATABASES ("edm"; missing ones are
# skipped), and for attachments BACKUP_S3_ENDPOINT (the public address on the server) or S3_ENDPOINT, S3_ACCESS_KEY,
# S3_SECRET_KEY, S3_BUCKET (read from ENV_FILE too). Backups go to apps/api/backups unless BACKUP_DIR says otherwise.
# Run it every night from cron, e.g.  15 2 * * *  /root/EDM-Task-Management/apps/api/scripts/backup.sh >> /var/log/edm-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
# On the server the backend's settings are in .env here; on a developer machine there is none.
if [[ -f .env ]]; then DEFAULT_COMPOSE=docker-compose.yml DEFAULT_ENV=.env; else DEFAULT_COMPOSE=docker-compose.dev.yml DEFAULT_ENV=; fi
COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE}"
ENV_FILE="${ENV_FILE-$DEFAULT_ENV}"
if [[ -n "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DATABASES="${DATABASES:-edm}"
compose() { docker compose -f "$COMPOSE_FILE" ${ENV_FILE:+--env-file "$ENV_FILE"} "$@"; }

stamp="$(date -u +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/$stamp"
mkdir -p "$target"
echo "Backup $stamp → $target"

for db in $DATABASES; do
  exists="$(compose exec -T postgres psql -U edm -d edm -tAc "select 1 from pg_database where datname = '$db'")"
  if [[ "$exists" != "1" ]]; then
    echo "  $db: no such database here, skipped"
    continue
  fi
  compose exec -T postgres pg_dump -U edm -Fc -Z 6 -d "$db" > "$target/$db.dump"
  # A dump that pg_restore cannot list is no backup.
  tables="$(compose exec -T postgres pg_restore --list < "$target/$db.dump" | grep -c ' TABLE DATA ' || true)"
  echo "  $db: $(du -h "$target/$db.dump" | cut -f1), $tables tables"
done
(cd "$target" && sha256sum ./*.dump > SHA256SUMS)

if [[ -n "${BACKUP_S3_ENDPOINT:-${S3_ENDPOINT:-}}" && -n "${S3_ACCESS_KEY:-}" ]]; then
  # One mirror, updated each night: only new photos are copied. Photos are never changed or deleted by the app.
  endpoint="${BACKUP_S3_ENDPOINT:-${S3_ENDPOINT/localhost/host.docker.internal}}"
  mkdir -p "$BACKUP_DIR/attachments"
  docker run --rm --add-host host.docker.internal:host-gateway \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    -e AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
    -v "$(realpath "$BACKUP_DIR/attachments"):/backup" amazon/aws-cli:2.22.0 \
    --endpoint-url "$endpoint" s3 sync "s3://${S3_BUCKET:-edm-attachments}" /backup --only-show-errors
  echo "  attachments: $(find "$BACKUP_DIR/attachments" -type f | wc -l) files in the mirror"
else
  echo "  attachments: S3 settings not given, skipped"
fi

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -print -exec rm -rf {} + |
  sed 's/^/  removed old backup /'
echo "Done."
