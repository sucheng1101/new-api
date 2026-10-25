#!/usr/bin/env bash
set -Eeuo pipefail

: "${RELEASE_TAG:?Set RELEASE_TAG, for example v1.2.3}"
: "${CONFIRM_RELEASE:?Set CONFIRM_RELEASE=YES to allow the service switch}"

if [[ "$CONFIRM_RELEASE" != "YES" ]]; then
  echo "Set CONFIRM_RELEASE=YES after reviewing the release and backup plan." >&2
  exit 2
fi
if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid release tag: $RELEASE_TAG" >&2
  exit 2
fi

PROJECT="${PROJECT:-sucheng1101/new-api}"
APP_ROOT="${APP_ROOT:-/opt/new-api}"
SERVICE_NAME="${SERVICE_NAME:-new-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/status}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_ROOT/backups}"
detect_asset_name() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'new-api-%s\n' "$RELEASE_TAG" ;;
    aarch64|arm64) printf 'new-api-arm64-%s\n' "$RELEASE_TAG" ;;
    *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 4 ;;
  esac
}
ASSET_NAME="${ASSET_NAME:-$(detect_asset_name)}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/$PROJECT/releases/download/$RELEASE_TAG}"
PRE_UPDATE_HOOK="${PRE_UPDATE_HOOK:-}"
POST_UPDATE_HOOK="${POST_UPDATE_HOOK:-}"
DB_BACKUP_COMMAND="${DB_BACKUP_COMMAND:-}"

command -v curl >/dev/null || { echo 'curl is required' >&2; exit 2; }
command -v jq >/dev/null || { echo 'jq is required' >&2; exit 2; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required' >&2; exit 2; }
command -v systemctl >/dev/null || { echo 'systemctl is required' >&2; exit 2; }
command -v grep >/dev/null || { echo 'grep is required' >&2; exit 2; }
if [[ -z "$DB_BACKUP_COMMAND" ]]; then
  echo 'Set DB_BACKUP_COMMAND to a project database backup command before release.' >&2
  exit 2
fi

mkdir -p "$APP_ROOT" "$BACKUP_ROOT"
exec 9>"$APP_ROOT/.release-update.lock"
flock -n 9 || { echo 'Another release update is already running.' >&2; exit 3; }

work_dir=$(mktemp -d)
backup_dir="$BACKUP_ROOT/$RELEASE_TAG-$(date +%Y%m%d-%H%M%S)"
current_binary="$APP_ROOT/new-api"
trap 'rm -rf "$work_dir"' EXIT

# Database backup is a hard precondition for any release mutation.  Capture
# command output as evidence, while redacting common secret-bearing values.
mkdir -p "$backup_dir"
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

curl --fail --location --retry 3 --silent --show-error \
  "$RELEASE_BASE/release-manifest.json" -o "$work_dir/release-manifest.json"
manifest_tag=$(jq -r '.tag' "$work_dir/release-manifest.json")
[[ "$manifest_tag" == "$RELEASE_TAG" ]] || { echo 'Release manifest tag mismatch.' >&2; exit 4; }
expected_sha=$(jq -r --arg name "$ASSET_NAME" '.assets[] | select(.name == $name) | .sha256' "$work_dir/release-manifest.json")
[[ -n "$expected_sha" && "$expected_sha" != "null" ]] || { echo "Asset not listed: $ASSET_NAME" >&2; exit 4; }

curl --fail --location --retry 3 --silent --show-error \
  "$RELEASE_BASE/$ASSET_NAME" -o "$work_dir/new-api"
actual_sha=$(sha256sum "$work_dir/new-api" | awk '{print $1}')
[[ "$actual_sha" == "$expected_sha" ]] || { echo 'Release checksum mismatch.' >&2; exit 4; }

if [[ -f "$current_binary" ]]; then
  cp -a "$current_binary" "$backup_dir/new-api"
fi
if [[ -f "$APP_ROOT/.env" ]]; then
  cp -a "$APP_ROOT/.env" "$backup_dir/.env"
fi

if [[ -n "$PRE_UPDATE_HOOK" ]]; then
  bash -Eeuo pipefail -c "$PRE_UPDATE_HOOK"
fi

rollback() {
  set +e
  systemctl stop "$SERVICE_NAME"
  if [[ -f "$backup_dir/new-api" ]]; then cp -a "$backup_dir/new-api" "$current_binary"; fi
  systemctl start "$SERVICE_NAME"
  echo "Release failed; restored backup at $backup_dir" >&2
}
trap rollback ERR

systemctl stop "$SERVICE_NAME"
install -m 0755 "$work_dir/new-api" "$current_binary"
systemctl start "$SERVICE_NAME"
for _ in {1..30}; do
  if response=$(curl --fail --silent --show-error "$HEALTH_URL") &&
     jq -e --arg expected "$RELEASE_TAG" '.success == true and .data.version == $expected' <<<"$response" >/dev/null; then
    trap - ERR
    if [[ -n "$POST_UPDATE_HOOK" ]]; then bash -Eeuo pipefail -c "$POST_UPDATE_HOOK"; fi
    echo "Release $RELEASE_TAG is healthy. Backup: $backup_dir"
    exit 0
  fi
  sleep 2
done
echo 'Health check did not pass within the startup window.' >&2
rollback
exit 5
