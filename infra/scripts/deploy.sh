#!/usr/bin/env bash
# Builds and (re)starts EDM Tasks on a single VPS (infra/DEPLOY-VPS.md).
#
#   infra/scripts/deploy.sh                 # git pull, build the images, start or update every container
#   infra/scripts/deploy.sh --no-pull       # same, with the code as it is on disk
#   infra/scripts/deploy.sh ps              # any other docker compose command: logs -f api, restart keycloak, down…
#
# Settings (environment): ENV_FILE (infra/.env.prod).
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE="${ENV_FILE:-infra/.env.prod}"
[[ -f "$ENV_FILE" ]] || { echo "No $ENV_FILE: copy infra/.env.vps.example to it and fill it in." >&2; exit 1; }
if grep -q '=change-me$' "$ENV_FILE"; then
  echo "$ENV_FILE still has change-me values:" >&2
  grep -n '=change-me$' "$ENV_FILE" | cut -d= -f1 >&2
  exit 1
fi
compose() { docker compose -f infra/docker-compose.prod.yml -f infra/docker-compose.vps.yml --env-file "$ENV_FILE" "$@"; }

case "${1:-}" in
  "" | --no-pull)
    [[ "${1:-}" == --no-pull ]] || git pull --ff-only
    compose build --pull
    # The API applies database migrations when it starts.
    compose up -d --remove-orphans --wait --wait-timeout 600
    docker image prune -f > /dev/null
    compose ps
    ;;
  *) compose "$@" ;;
esac
