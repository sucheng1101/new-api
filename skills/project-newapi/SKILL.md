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
- Treat upstream remotes as read-only. GitHub is the only project publication source. Local development and online version sync never publish source changes; formal release uses the verified project-owned GitHub remote only.
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

- Local runtime/start/rebuild: `powershell -ExecutionPolicy Bypass -File .\scripts\local-start.ps1 -Owner SESSION_ID` (uses `docker-compose.dev.yml`, project `newapi-dev`, port `5200`).
- Local acceptance: `powershell -ExecutionPolicy Bypass -File .\scripts\local-check.ps1 -ExpectedCommit (git rev-parse HEAD)`.
- Backend tests: run inside a disposable Go container or the project Docker build; do not use a Windows-native Go process as release evidence.
- Frontend install/build/lint/i18n: run inside the project Docker build or a disposable Bun container mounted to `web/`; do not use a Windows-native Bun process as release evidence.
- Docker status: `docker compose -p newapi-dev -f docker-compose.dev.yml ps`.
- Docker source refresh: `powershell -ExecutionPolicy Bypass -File .\scripts\local-start.ps1 -Owner SESSION_ID` (the wrapper performs the database-backup gate before Compose changes).

## Local Runtime Safety Standard

- Canonical local runtime is Docker Compose (`docker-compose.dev.yml`); Windows-native Go/Bun is a documented exception only.
- One project has one active runtime group. Never run Docker and Windows-native newapi instances together, and never start a second Compose project for this checkout.
- `scripts/local-start.ps1` owns the runtime lock at `.git/new-api-dev/runtime-lock.json`, checks Docker and port ownership, stops only the identified newapi native process group, and rebuilds/recreates the current workspace in Docker.
- The start wrapper validates `runtime_owner`; a different owner can take over only after the Compose runtime is absent and the lock is older than 30 minutes. Ambiguous or active ownership is left untouched.
- Native process matching requires the executable/command line to point into this checkout; a generic `go`, `node`, or `bun` process is never stopped by name alone.
- After every source or build-input change, rerun `scripts/local-start.ps1`; it performs the required backup gate and then runs `docker compose ... up -d --build --force-recreate`. Plain `restart` is not sufficient for the baked-in application image.
- Every start/restart must verify `/api/status`, `/api/status/latest-release`, the embedded frontend root, the current workspace commit, image revision label, ports, and absence of a native process.
- If a port, container, or process cannot be attributed to this checkout, leave it running and report the owner instead of stopping it.
- Only the task's runtime-owner session may start, stop, rebuild, or switch the runtime; other sessions perform read-only checks.
- Treat stale processes and browser caches as runtime evidence issues: inspect ownership and loaded image revision before changing application code.

### Runtime Database Backup Gate (mandatory)

- Incident root cause to preserve: the former `local-start.ps1` only selected SQLite snapshots while the active runtime used MySQL, and a direct Compose `up --build --force-recreate` bypassed the wrapper. A SQLite snapshot is not evidence for a MySQL/PostgreSQL runtime; all state changes must pass the unified gate.
- Before every restart, rebuild, recreate, runtime-mode switch, release publication, deployment, or rollback, back up and verify the database actually used by the live app. Detect the engine and instance from runtime configuration; do not assume that a SQLite snapshot covers a MySQL or PostgreSQL runtime.
- `scripts/local-start.ps1` is the only approved local entrypoint for state-changing Compose operations. Do not hand-run `docker compose up`, `restart`, `stop`, `down`, `rm`, or equivalent commands to bypass the gate; `ps`, `config`, `logs`, and `inspect` remain read-only diagnostics.
- `scripts/production-update-compose.sh` and `scripts/production-update.sh` are subject to the same gate: before `pull`/`up` or `systemctl stop/start`, they must invoke `DB_BACKUP_COMMAND` (or an equivalent unified database-backup workflow), verify instance-matched/checksum-verified evidence, and fail closed when proof is absent. Direct Compose or `systemctl` state changes outside those guarded scripts are non-compliant.
- The gate must fail closed before any container stop/recreate or mode switch when the backup is missing, empty, corrupt, stale, tied to another instance, or not integrity/read verified. Never use `docker compose down -v` or delete named volumes.
- Runtime lock and release evidence must contain the engine/instance, backup artifact path, UTC timestamp, SHA-256, integrity/restore-read result, and concrete rollback path. Keep dumps and metadata outside Git commits, and scrub credentials, tokens, cookies, and private configuration.
- `local-check.ps1` and release acceptance must show the backup artifact, checksum, verification result, runtime-instance match, and rollback path in addition to health, commit, image, port, and process checks.

### Docker runtime inventory

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

To switch from native to Docker, stop only the project-owned native process group, verify ports are free, then run `local-start.ps1` (including its database-backup gate). To use a native exception, complete the same backup preflight and use the approved runtime-owner procedure to stop the `newapi-dev` Compose application group; record the reason and owner in the board, and restore Docker before review/release. Do not use `docker compose down -v`; named data volumes are preserved.

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
- For formal production release, push and verify the project-owned GitHub remote only. For server-only online version sync, do not publish or push solely because the server version changed; Gitee is not contacted.
- After verified deployment, remove local release archives, temporary binaries, caches, and remote staging directories; preserve rollback backups and application data.
- Before packaging or sharing, scrub local secrets, logs, session files, dumps, and generated artifacts.

## Maintenance

Update this skill when durable setup commands, architecture boundaries, billing invariants, schema conventions, verification steps, or release procedures change.
