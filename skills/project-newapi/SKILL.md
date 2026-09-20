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
- Treat upstream remotes as read-only. Releases must use project-owned GitHub and Gitee repositories as required by `AGENTS.md`.
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

- Backend run: `go run main.go` (documented, unverified in this draft).
- Backend tests: `go test ./...` (standard project gate, unverified in this draft).
- Frontend install: `cd web; bun install` (documented, unverified in this draft).
- Frontend dev: `cd web; bun run dev` (documented, unverified in this draft).
- Frontend build: `cd web; bun run build` (documented, unverified in this draft).
- Frontend format check: `cd web; bun run lint` (documented, unverified in this draft).
- Frontend ESLint: `cd web; bun run eslint` (documented, unverified in this draft).
- Frontend i18n: `bun run i18n:extract`, `bun run i18n:sync`, `bun run i18n:lint` from `web/`.

## Engineering Rules

- Use `common.Marshal`, `common.Unmarshal`, `common.UnmarshalJsonStr`, and `common.DecodeJson`; do not call JSON marshal/unmarshal functions directly in business code.
- All schemas and queries must work on SQLite, MySQL >= 5.7.8, and PostgreSQL >= 9.6. Prefer GORM and portable column types.
- Keep optional upstream relay scalar fields as pointers with `omitempty` so explicit zero values survive conversion.
- Read `pkg/billingexpr/expr.md` before changing expression-based billing.
- Preserve project identity, attribution, module paths, package metadata, and protected identifiers described in `AGENTS.md`.
- Prefer Bun for frontend work and preserve the existing Semi Design visual system and i18n conventions.

## Billing And Wallet Safety

- Before changing wallets, top-ups, redemption codes, promotion rewards, refunds, lottery, or dashboard analytics, read `docs/superpowers/specs/2026-09-20-promotion-lottery-wallet-dashboard-design.md`.
- Successful balance top-ups and redemption-code redemptions participate in two-level promotion rewards. A redemption code uses its quota face value as the reward base; subscription purchases do not participate. Redeemed quota is refundable through the admin workflow using the same promotion-cost rule as a top-up: prior rewards remain with inviters and the redeeming user bears the cost.
- Store quota and monetary calculations in integer quota units where possible; avoid floating-point settlement.
- Use database transactions, row locking or portable conditional updates, unique idempotency keys, and immutable ledgers for wallet mutations.
- Keep aggregate balances and ledger entries consistent in the same transaction.
- Payment callbacks, refunds, promotion rewards, and lottery awards require replay-safe tests.
- Any source-specific wallet deduction must restore the same source when a relay pre-consumption is partially or fully refunded.
- Wallet relay billing uses `BillingSession`/`WalletFunding` with `RelayInfo.RequestId`; every debit/refund gets a distinct idempotency key while `WalletConsumptionAllocation` records gift-first and cash-FIFO sources. Async tasks persist `BillingRequestId` in `TaskPrivateData` so polling refunds and delta settlements use the same source allocations; legacy tasks without it retain the old quota path.
- For direct non-session wallet billing (`PostConsumeQuota`), use the request ID plus an incrementing operation sequence to avoid idempotency-key collisions across repeated charges. Concurrent wallet operations use a portable upsert/no-op conflict path on the unique idempotency key before locking the user row.

## Quality Gates

- Backend/domain changes: focused tests plus `go test ./...` when feasible.
- Frontend changes: formatting, ESLint, production build, and browser checks at desktop and mobile widths.
- Schema changes: migration coverage and behavior checks on SQLite, MySQL, and PostgreSQL paths.
- Billing changes: concurrency, idempotency, partial refund, retry, and rollback tests.
- i18n changes: run the repository i18n lint/sync workflow and avoid hard-coded user-facing strings.

## Release Safety

- Do not place credentials, tokens, cookies, private configuration, or database dumps in the repository or this skill.
- During one deployment, retain supplied credentials only in process memory and reuse them for retries.
- Before production deployment, verify project-owned GitHub and Gitee release branches point to the same commit.
- After verified deployment, remove local release archives, temporary binaries, caches, and remote staging directories; preserve rollback backups and application data.
- Before packaging or sharing, scrub local secrets, logs, session files, dumps, and generated artifacts.

## Maintenance

Update this skill when durable setup commands, architecture boundaries, billing invariants, schema conventions, verification steps, or release procedures change.
