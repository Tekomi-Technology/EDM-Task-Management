#!/usr/bin/env bash
# Restores a backup made by backup.sh.
#
#   infra/scripts/restore.sh backups/20261027-021500                 # replaces edm and keycloak (asks first)
#   infra/scripts/restore.sh backups/20261027-021500 --into edm_copy # application data into another database
#   ... --attachments                                                # also copies the photos back to S3
#
# Before replacing the live databases, stop the API and Keycloak:  docker compose ... stop api keycloak
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-}"
if [[ -n "$ENV_FILE" ]]; then set -a; source "$ENV_FILE"; set +a; fi
compose() { docker compose -f "$COMPOSE_FILE" ${ENV_FILE:+--env-file "$ENV_FILE"} "$@"; }

source_dir="${1:?give the backup folder, e.g. backups/20261027-021500}"
shift
into=""
attachments=false
yes=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --into) into="$2"; shift 2 ;;
    --attachments) attachments=true; shift ;;
    --yes) yes=true; shift ;;
    *) echo "Unknown option $1" >&2; exit 2 ;;
  esac
done

(cd "$source_dir" && sha256sum --quiet -c SHA256SUMS) || { echo "Checksums do not match: the backup is damaged." >&2; exit 1; }

restore_db() {
  local file="$1" db="$2"
  compose exec -T postgres psql -U edm -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" -c "CREATE DATABASE \"$db\" OWNER edm" >/dev/null
  compose exec -T postgres psql -U edm -d "$db" -c "CREATE EXTENSION IF NOT EXISTS postgis" >/dev/null
  compose exec -T postgres pg_restore -U edm -d "$db" --no-owner --exit-on-error < "$file"
  echo "  $db restored from $(basename "$file")"
}

if [[ -n "$into" ]]; then
  restore_db "$source_dir/edm.dump" "$into"
else
  if [[ "$yes" != true ]]; then
    read -r -p "This replaces the live databases with the backup of $(basename "$source_dir"). Type RESTORE: " answer
    [[ "$answer" == "RESTORE" ]] || { echo "Nothing changed."; exit 1; }
  fi
  for file in "$source_dir"/*.dump; do restore_db "$file" "$(basename "$file" .dump)"; done
fi

if [[ "$attachments" == true ]]; then
  endpoint="${S3_ENDPOINT:?set S3_ENDPOINT}"
  endpoint="${endpoint/localhost/host.docker.internal}"
  docker run --rm --add-host host.docker.internal:host-gateway \
    -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
    -e AWS_DEFAULT_REGION="${S3_REGION:-us-east-1}" \
    -v "$(realpath "$(dirname "$source_dir")/attachments"):/backup:ro" amazon/aws-cli:2.22.0 \
    --endpoint-url "$endpoint" s3 sync /backup "s3://${S3_BUCKET:-edm-attachments}" --only-show-errors
  echo "  attachments copied back to ${S3_BUCKET:-edm-attachments}"
fi
echo "Done. Start the API and Keycloak again."
