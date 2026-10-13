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
- Docker source refresh: `docker compose -p newapi-dev -f docker-compose.dev.yml up -d --build --force-recreate`.

## Local Runtime Safety Standard

- Canonical local runtime is Docker Compose (`docker-compose.dev.yml`); Windows-native Go/Bun is a documented exception only.
- One project has one active runtime group. Never run Docker and Windows-native newapi instances together, and never start a second Compose project for this checkout.
- `scripts/local-start.ps1` owns the runtime lock at `.git/new-api-dev/runtime-lock.json`, checks Docker and port ownership, stops only the identified newapi native process group, and rebuilds/recreates the current workspace in Docker.
- The start wrapper validates `runtime_owner`; a different owner can take over only after the Compose runtime is absent and the lock is older than 30 minutes. Ambiguous or active ownership is left untouched.
- Native process matching requires the executable/command line to point into this checkout; a generic `go`, `node`, or `bun` process is never stopped by name alone.
- After every source or build-input change, use `docker compose ... up -d --build --force-recreate`; plain `restart` is not sufficient for the baked-in application image.
- Every start/restart must verify `/api/status`, `/api/status/latest-release`, the embedded frontend root, the current workspace commit, image revision label, ports, and absence of a native process.
- If a port, container, or process cannot be attributed to this checkout, leave it running and report the owner instead of stopping it.
- Only the task's runtime-owner session may start, stop, rebuild, or switch the runtime; other sessions perform read-only checks.
- Treat stale processes and browser caches as runtime evidence issues: inspect ownership and loaded image revision before changing application code.

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
| Database bootstrap | Each start compares the latest valid SQLite backup with `data/one-api.db`; a newer backup is restored after preserving the current file under `data/runtime-backups`, while a newer/current database is kept. MySQL is used only when no usable SQLite database is available |
| Runtime lock | `.git/new-api-dev/runtime-lock.json` |
| Build identity | `org.opencontainers.image.revision` label and `git rev-parse HEAD` |

### Mode switch contract

To switch from native to Docker, stop only the project-owned native process group, verify ports are free, then run `local-start.ps1`. To use a native exception, stop the `newapi-dev` Compose application group first, record the reason and owner in the board, and restore Docker before review/release. Do not use `docker compose down -v`; named data volumes are preserved.

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
