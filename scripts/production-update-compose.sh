#!/usr/bin/env bash
set -Eeuo pipefail
: "${RELEASE_TAG:?Set RELEASE_TAG}"
: "${CONFIRM_RELEASE:?Set CONFIRM_RELEASE=YES}"
[[ "$CONFIRM_RELEASE" == YES ]] || exit 2
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
SERVICE="${COMPOSE_SERVICE:-new-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/status}"
DB_BACKUP_COMMAND="${DB_BACKUP_COMMAND:-}"
EXPECTED_VERSION="${EXPECTED_VERSION:-$RELEASE_TAG}"
command -v docker >/dev/null || { echo 'docker is required' >&2; exit 2; }
command -v grep >/dev/null || { echo 'grep is required' >&2; exit 2; }
if [[ -z "$DB_BACKUP_COMMAND" ]]; then
  echo 'Set DB_BACKUP_COMMAND to a project database backup command before release.' >&2
  exit 2
fi
backup_dir="$PROJECT_DIR/backups/$RELEASE_TAG-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"

# Database backup is a hard precondition for pull/up.  Capture command output
# as evidence and redact common secret-bearing values before persisting it.
db_backup_evidence="$backup_dir/database-backup.log"
db_backup_command_output="$backup_dir/.database-backup.command-output"
{
  printf 'started_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! bash -Eeuo pipefail -c "$DB_BACKUP_COMMAND" >"$db_backup_command_output" 2>&1; then
    sed -E 's/("?(password|passwd|token|secret|api[_-]?key)"?[[:space:]]*[=:][[:space:]]*)"?[^"[:space:],}]+"?/\1[REDACTED]/Ig' "$db_backup_command_output"
    printf 'status=failed\n'
    printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    rm -f "$db_backup_command_output"
    echo "Database backup command failed; see $db_backup_evidence" >&2
    exit 5
  fi
  sed -E 's/("?(password|passwd|token|secret|api[_-]?key)"?[[:space:]]*[=:][[:space:]]*)"?[^"[:space:],}]+"?/\1[REDACTED]/Ig' "$db_backup_command_output"
  if ! grep -Eiq '(^|[[:space:]])(engine|mode)[[:space:]]*=' "$db_backup_command_output" ||
     ! grep -Eiq '(^|[[:space:]])(instance|source)[[:space:]]*=' "$db_backup_command_output" ||
     ! grep -Eiq '(^|[[:space:]])sha256[[:space:]]*=[[:space:]]*[0-9a-f]{64}' "$db_backup_command_output" ||
     ! grep -Eiq '(^|[[:space:]])(validation|status)[[:space:]]*=[[:space:]]*(passed|ok)' "$db_backup_command_output" ||
     ! grep -Eiq '(^|[[:space:]])(rollback|path)[[:space:]]*=' "$db_backup_command_output"; then
    printf 'status=failed\nreason=missing-verifiable-backup-fields\n'
    printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    rm -f "$db_backup_command_output"
    echo "Database backup command output must include engine/mode, instance/source, sha256, validation/status, and rollback/path fields; see $db_backup_evidence" >&2
    exit 5
  fi
  rm -f "$db_backup_command_output"
  printf 'status=passed\n'
  printf 'completed_at_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$db_backup_evidence"
[[ -s "$db_backup_evidence" ]] || { echo 'Database backup evidence is empty.' >&2; exit 5; }
cp -a "$COMPOSE_FILE" "$backup_dir/" 2>/dev/null || true
[[ -f "$PROJECT_DIR/.env" ]] && cp -a "$PROJECT_DIR/.env" "$backup_dir/" || true
export IMAGE_TAG="$RELEASE_TAG"
docker compose -f "$COMPOSE_FILE" pull "$SERVICE"
docker compose -f "$COMPOSE_FILE" up -d --no-deps "$SERVICE"
for _ in {1..30}; do
  if response=$(curl --fail --silent "$HEALTH_URL") &&
     echo "$response" | grep -q '"success"[[:space:]]*:[[:space:]]*true' &&
     echo "$response" | grep -q "\"version\"[[:space:]]*:[[:space:]]*\"$EXPECTED_VERSION\""; then
    echo "Compose release $RELEASE_TAG is healthy. Backup: $backup_dir"
    exit 0
  fi
  sleep 2
done
echo 'Compose health check failed.' >&2
exit 5
