#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_TAG:?Set RELEASE_TAG}"
: "${CONFIRM_RELEASE:?Set CONFIRM_RELEASE=YES}"
[[ "$CONFIRM_RELEASE" == YES ]] || exit 2
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${COMPOSE_SERVICE:-new-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/status}"
command -v docker >/dev/null || { echo 'docker is required' >&2; exit 2; }
backup_dir="$PROJECT_DIR/backups/$RELEASE_TAG-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp -a "$COMPOSE_FILE" "$backup_dir/" 2>/dev/null || true
[[ -f "$PROJECT_DIR/.env" ]] && cp -a "$PROJECT_DIR/.env" "$backup_dir/" || true
export IMAGE_TAG="$RELEASE_TAG"
docker compose -f "$COMPOSE_FILE" pull "$SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --no-deps "$SERVICE"
for _ in {1..30}; do
  if curl --fail --silent "$HEALTH_URL" >/dev/null; then echo "Compose release $RELEASE_TAG is healthy. Backup: $backup_dir"; exit 0; fi
  sleep 2
done
echo 'Compose health check failed.' >&2
exit 5
