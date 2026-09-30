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
ASSET_NAME="${ASSET_NAME:-new-api-$RELEASE_TAG}"
RELEASE_BASE="${RELEASE_BASE:-https://github.com/$PROJECT/releases/download/$RELEASE_TAG}"
PRE_UPDATE_HOOK="${PRE_UPDATE_HOOK:-}"
POST_UPDATE_HOOK="${POST_UPDATE_HOOK:-}"

command -v curl >/dev/null || { echo 'curl is required' >&2; exit 2; }
command -v jq >/dev/null || { echo 'jq is required' >&2; exit 2; }
command -v sha256sum >/dev/null || { echo 'sha256sum is required' >&2; exit 2; }
command -v systemctl >/dev/null || { echo 'systemctl is required' >&2; exit 2; }

mkdir -p "$APP_ROOT" "$BACKUP_ROOT"
exec 9>"$APP_ROOT/.release-update.lock"
flock -n 9 || { echo 'Another release update is already running.' >&2; exit 3; }

work_dir=$(mktemp -d)
backup_dir="$BACKUP_ROOT/$RELEASE_TAG-$(date +%Y%m%d-%H%M%S)"
current_binary="$APP_ROOT/new-api"
trap 'rm -rf "$work_dir"' EXIT

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

mkdir -p "$backup_dir"
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
  if curl --fail --silent --show-error "$HEALTH_URL" >/dev/null; then
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
