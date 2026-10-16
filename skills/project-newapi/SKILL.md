---
name: project-newapi
description: Project-specific architecture, development, billing, database, UI, verification, and release guidance for the new-api repository at D:\Desktop\object\newapi. Use for all code, schema, frontend, test, and release work in this repository.
---

# new-api Project Guide

## Scope

Repository: `D:\Desktop\object\newapi`

This is an AI API gateway with user accounts, quota billing, provider relays, subscriptions, payments, and an administration console.

Primary stack: Go, Gin, GORM, React 18, Vite, Semi Design, Redis, SQLite/MySQL/PostgreSQL.

Bootstrap status: imported draft. Commands below are documented or discovered; mark them verified only after running them successfully in the current workspace.

## First Steps

- Read `AGENTS.md` before edits; its project rules are authoritative.
- Check `git status --short --branch` and preserve unrelated user changes.
- Confirm the current branch and remotes before commits or releases.
- Treat upstream remotes as read-only. Local development does not publish source changes. Every production release must be committed and pushed to project-owned GitHub and Gitee repositories, with both release branches verified at the same commit before deployment begins.
- Search with `rg` and follow existing Router -> Controller -> Service -> Model boundaries.

## Project Map

- `router/`: Gin route registration and middleware composition.
- `controller/`: HTTP handlers and request validation.
- `service/`: reusable domain and settlement logic.
- `model/`: GORM models, migrations, and database access.
- `relay/`: request conversion and upstream provider adapters.
- `middleware/`: authentication, rate limits, distribution, and logging.
- `setting/`: system configuration.
- `common/`: shared JSON, cache, crypto, quota, and environment helpers.
- `web/`: React/Vite console; frontend translations are in `web/src/i18n/locales/`.
- `docs/superpowers/specs/`: accepted product and engineering specifications.

## Development Commands

- Local runtime/start/rebuild: `powershell -ExecutionPolicy Bypass -File .\scripts\local-native-start.ps1 -Owner CLI-NA-RUNTIME-01` (Windows-native, port `5200`). Go, Bun, and Python 3 must be available; `-BunPath` accepts the installed executable path.
- Backend verification: Windows-native `go test` on affected packages; frontend verification: Bun tests, Prettier, ESLint, `bun run build`, and Playwright desktop/mobile checks.
- Local acceptance: compare Git HEAD with the runtime lock, `/api/status` version, process/executable hash, served frontend entry asset and SHA-256, port ownership, actual database path and backup evidence. `local-check.ps1` is a historical Docker-only checker and is not native acceptance evidence.
- Historical Docker diagnostics may use `docker compose -p newapi-dev -f docker-compose.dev.yml ps`; do not start or recreate Docker for local development.

## Local Runtime Safety Standard

- Canonical local runtime is Windows-native `new-api.exe` on `http://127.0.0.1:5200`, as explicitly requested by the user. Keep a single project runtime and leave port `3000` unused by this project.
- `scripts/local-native-start.ps1` owns the runtime lock at `.git/new-api-dev/runtime-lock.json` and an exclusive operation file lock. It checks the locked runtime mode, owner, PID, executable, database engine/instance, and port ownership before any rebuild or process switch.
- An owner/mode/database mismatch aborts for investigation; never silently take over a different runtime or guess its database. The current canonical local database is `data/one-api.db` with `SQL_DSN=local`, `LOG_SQL_DSN=local`, and an absolute `SQLITE_PATH` in the child process environment.
- Native process matching requires the executable/command line to point into this checkout; a generic `go`, `node`, or `bun` process is never stopped by name alone.
- After every source or build-input change, rerun `scripts/local-native-start.ps1`: online backup and full integrity verification precede the frontend/backend builds; the previous process stays running until both builds pass. Preserve the previous executable for automatic rollback when startup acceptance fails.
- Every start/restart must verify `/api/status`, the embedded frontend root/asset hash, Git commit/version, process/executable hash, port ownership, database-instance match, and native rollback path. A source commit or successful build alone does not prove that the browser is running it.
- If a port, container, or process cannot be attributed to this checkout, leave it running and report the owner instead of stopping it.
- Only the task's runtime-owner session may start, stop, rebuild, or switch the runtime; other sessions perform read-only checks.
- Treat stale processes and browser caches as runtime evidence issues: inspect ownership, executable version, and the loaded frontend asset before claiming a UI fix is deployed.
- Windows process-exit and atomic runtime-record rules: see [native runtime troubleshooting](references/windows-native-runtime.md). Run `scripts/test-local-native-start.ps1` after changing these utilities.

### Runtime Database Backup Gate (mandatory)

- Incident root cause to preserve: the former `local-start.ps1` only selected SQLite snapshots while the active runtime used MySQL, and a direct Compose `up --build --force-recreate` bypassed the wrapper. A SQLite snapshot is not evidence for a MySQL/PostgreSQL runtime; all state changes must pass the unified gate.
- Before every restart, rebuild, recreate, runtime-mode switch, release publication, deployment, or rollback, back up and verify the database actually used by the live app. Detect the engine and instance from runtime configuration; do not assume that a SQLite snapshot covers a MySQL or PostgreSQL runtime.
- `scripts/local-native-start.ps1` is the local entrypoint. For SQLite, `scripts/database-backup.ps1 -DatabaseMode sqlite` calls Python's online backup API (including committed WAL data), performs full `PRAGMA integrity_check`, and records SHA-256, byte size, source path, timestamp, validation, and native restore instructions. A header check or plain copy of a live database is insufficient.
- Historical Compose operations still use the backup-gated `scripts/local-start.ps1`; never bypass that gate with direct state-changing Compose commands.
- `scripts/production-update-compose.sh` and `scripts/production-update.sh` are subject to the same gate: before `pull`/`up` or `systemctl stop/start`, they must invoke `DB_BACKUP_COMMAND` (or an equivalent unified database-backup workflow), verify instance-matched/checksum-verified evidence, and fail closed when proof is absent. Direct Compose or `systemctl` state changes outside those guarded scripts are non-compliant.
- The gate must fail closed before any container stop/recreate or mode switch when the backup is missing, empty, corrupt, stale, tied to another instance, or not integrity/read verified. Never use `docker compose down -v` or delete named volumes.
- Runtime lock and release evidence must contain the engine/instance, backup artifact path, UTC timestamp, SHA-256, integrity/restore-read result, and concrete rollback path. Keep dumps and metadata outside Git commits, and scrub credentials, tokens, cookies, and private configuration.
- Native and release acceptance must show the backup artifact, checksum, verification result, runtime-instance match, and rollback path in addition to health, commit, artifact, port, and process checks. Runtime records must describe native executable/database rollback for native operation, rather than Docker recovery commands.

### Historical Docker runtime inventory (inactive local mode)

| Item | Value |
|---|---|
| Compose file | `docker-compose.dev.yml` |
| Compose project | `newapi-dev` |
| Application URL | `http://127.0.0.1:5200` |
| MySQL | `127.0.0.1:13306`, stable volume `new-api-dev-mysql-data` |
| Redis | `127.0.0.1:16379`, stable volume `new-api-dev-redis-data` |
| MinIO API/console | `127.0.0.1:19000` / `127.0.0.1:19001`, stable volume `new-api-dev-minio-data` |
| Container names | `new-api-${VERSION}-app/mysql/redis/minio` |
| Database bootstrap | Before any state-changing start/rebuild/switch, the backup gate captures and verifies the actual runtime database (SQLite, MySQL, or PostgreSQL). SQLite snapshot selection/restoration remains supported; a MySQL/PostgreSQL runtime is never covered by a SQLite-only snapshot, and the current instance is preserved before any restore |
| Runtime lock | `.git/new-api-dev/runtime-lock.json` |
| Build identity | `org.opencontainers.image.revision` label and `git rev-parse HEAD` |

### Mode switch contract

Keep local operation Windows-native. A future runtime-mode change requires explicit user direction, an instance-matched verified backup, ownership checks, and a recorded rollback path before stopping the current project process. Preserve named volumes and application data. Do not switch back to Docker during review or merely because an older SOP defaults to it.

### API address and domain management

- User-facing API connection strings follow `window.location.origin` through `getServerAddress()` in `web/src/helpers/token.js`. Cached `/api/status.server_address` may contain an obsolete host or port and must not override the active browser entrypoint in the homepage, token connectors, or CCSwitch links.
- Domain management and domain whitelist use the same backend `records` data and editor. Keep direct host authorization distinct from per-user IPv4 authorization; management placement does not replace runtime IP checks.
- Verify security/domain refresh labels and independent loading, tab order (security, whitelist, blacklist, domain management), editable names/addresses/descriptions/status/order, and IP whitelist search/pagination. Do not invent two static gateway/OpenAI rows outside the shared records.

## Engineering Rules

- Use `common.Marshal`, `common.Unmarshal`, `common.UnmarshalJsonStr`, and `common.DecodeJson`; do not call JSON marshal/unmarshal functions directly in business code.
- All schemas and queries must work on SQLite, MySQL >= 5.7.8, and PostgreSQL >= 9.6. Prefer GORM and portable column types.
- Keep optional upstream relay scalar fields as pointers with `omitempty` so explicit zero values survive conversion.
- Read `pkg/billingexpr/expr.md` before changing expression-based billing.
- Preserve project identity, attribution, module paths, package metadata, and protected identifiers described in `AGENTS.md`.
- Prefer Bun for frontend work and preserve the existing Semi Design visual system and i18n conventions.

### External JSON Provider Verification

- Before mapping a third-party JSON response, verify the live/provider-documented payload shape and mirror it in an `httptest` fixture. Do not infer flat field names from the UI requirements.
- The `ipwho.is` geolocation response nests operator data under `connection.isp`/`connection.asn` and timezone under `timezone.id`; preserve this mapping when changing the IP geolocation service.

## Billing And Wallet Safety

- Before changing wallets, top-ups, redemption codes, promotion rewards, refunds, lottery, or dashboard analytics, read `docs/superpowers/specs/2026-09-20-promotion-lottery-wallet-dashboard-design.md`.
- Successful balance top-ups and redemption-code redemptions participate in two-level promotion rewards. A redemption code uses its quota face value as the reward base; subscription purchases do not participate. Redeemed quota is refundable through the admin workflow using the same promotion-cost rule as a top-up: prior rewards remain with inviters and the redeeming user bears the cost.
- Store quota and monetary calculations in integer quota units where possible; avoid floating-point settlement.
- Use database transactions, row locking or portable conditional updates, unique idempotency keys, and immutable ledgers for wallet mutations.
- Keep aggregate balances and ledger entries consistent in the same transaction.
- Payment callbacks, refunds, promotion rewards, and lottery awards require replay-safe tests.
- Successful top-ups are settled only through `model.SettleTopUpSuccess`: order status, cash lot, promotion snapshots, and reward credits commit in one transaction. EPay, Stripe, Creem, Waffo, Waffo Pancake, and administrator completion must not modify quota directly.
- Two-level promotion rewards use integer basis points (`PromotionLevel1BasisPoints`/`PromotionLevel2BasisPoints`, defaults 500/300). Redemption codes share the same promotion settlement and create refundable cash lots; subscriptions remain outside promotion settlement.
- Promotion balance (`aff_quota`) stays outside spendable `quota` until an atomic promotion-to-gift transfer creates paired immutable ledger rows.
- Any source-specific wallet deduction must restore the same source when a relay pre-consumption is partially or fully refunded.
- Promotion and lottery administrator configuration displays monetary values in RMB (`￥`) while API/model settlement remains integer quota. Convert through the runtime `quota_per_unit` from `/api/status`; keep validation for zero, minimum one-quota increments, non-finite values, and safe integer bounds. Do not extend this display conversion to recharge, redemption-code, gifting, refund, or manual balance-adjustment pages without a separately confirmed scope.
- Wallet relay billing uses `BillingSession`/`WalletFunding` with `RelayInfo.RequestId`; every debit/refund gets a distinct idempotency key while `WalletConsumptionAllocation` records gift-first and cash-FIFO sources. Async tasks persist `BillingRequestId` in `TaskPrivateData` so polling refunds and delta settlements use the same source allocations; legacy tasks without it retain the old quota path.
- For direct non-session wallet billing (`PostConsumeQuota`), use the request ID plus an incrementing operation sequence to avoid idempotency-key collisions across repeated charges. Concurrent wallet operations use a portable upsert/no-op conflict path on the unique idempotency key before locking the user row.

## Quality Gates

- Backend/domain changes: focused tests plus `go test ./...` when feasible.
- Frontend changes: formatting, ESLint, production build, and browser checks at desktop and mobile widths.
- Schema changes: migration coverage and behavior checks on SQLite, MySQL, and PostgreSQL paths.
- Billing changes: concurrency, idempotency, partial refund, retry, and rollback tests.
- i18n changes: run the repository i18n lint/sync workflow and avoid hard-coded user-facing strings.

### Registration Email Domain Policy

- Registration and verification-code endpoints must validate the same runtime email-domain whitelist.
- `/api/status` exposes the normalized policy so the registration form can show the exact allowed domains; distinguish QQ-only, multiple-domain, and closed-registration states.

### Usage Log UI And Image Requests

- Image generation/edit requests are logged through the request context key
  `image_generation_log`; only sanitized prompt and generation parameters are
  persisted in `Log.Other`, never uploaded image bytes or base64 payloads.
- The usage-log detail adapter detects image logs from the structured marker or
  `/v1/images/generations` and `/v1/images/edits` paths. Image logs render
  request, prompt, output metadata, token, and billing sections; text logs keep
  the existing detail layout.
- Image error rows prefer `Other.error_code` in the details column. Keep this
  behavior scoped to image endpoints so ordinary text error summaries remain
  unchanged.

## Release Safety

### Database Backup Preflight

- A release, publication, deployment, or rollback MUST have a verified backup of the actual target database before any service restart or replacement. Record engine/instance, artifact, SHA-256, integrity/read verification, retention, and rollback location with the release evidence.
- If the backup gate fails, stop the operation before uploading, replacing, restarting, or switching anything. Preserve the backup needed for rollback; remove only unrelated temporary release artifacts after verification.
- `scripts/production-update-compose.sh` and `scripts/production-update.sh` must leave the backup artifact, checksum, validation result, and rollback location in their release evidence before reporting a healthy update.

### Platform Release Matrix

- Windows artifacts are for local Windows testing only (`*.exe`). Never use a Windows artifact on the Ubuntu production server.
- Ubuntu production deployments must use the matching Linux artifact: `linux-amd64` for x86_64 servers or `linux-arm64` for ARM servers.
- Every formal release must publish the complete platform set: Linux amd64, Linux arm64, macOS, Windows, checksums, and `release-manifest.json`.
- Upgrade selection must detect the running OS and CPU architecture before downloading an artifact; an incompatible artifact must be rejected before replacement.
- Release acceptance must verify that the manifest contains the Ubuntu target artifact before enabling production upgrade.

- Do not place credentials, tokens, cookies, private configuration, or database dumps in the repository or this skill.
- During one deployment, retain supplied credentials only in process memory and reuse them for retries.
- For formal production release, push and verify both project-owned GitHub and Gitee release branches at the same commit before deployment. Upstream repositories remain read-only; local rebuilds do not require remote publication.
- After verified deployment, remove local release archives, temporary binaries, caches, and remote staging directories; preserve rollback backups and application data.
- Before packaging or sharing, scrub local secrets, logs, session files, dumps, and generated artifacts.

## Maintenance

Update this skill when durable setup commands, architecture boundaries, billing invariants, schema conventions, verification steps, or release procedures change.
