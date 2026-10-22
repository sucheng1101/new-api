# Task Card: NA-20261022-PROMOTION-CENTER

## Objective

Remove the standalone Domain Management item from the administrator sidebar while retaining the Domain Management tab under Security and Access. Restore Promotion Center tabs in this order: Reward Ledger, Users I Invited, and User Promotion Details. Show complete usernames and accounting fields in promotion detail rows.

## Execution

- Executor: Codex direct execution, explicitly requested by the user instead of CLI.
- Branch: `codex/promotion-center-audit-tabs`
- Base commit: `997042c2c467e051db1beb45888f27f7716aec62`
- Runtime owner: `CODEX-NA-RUNTIME-01`
- Runtime: Windows-native `http://127.0.0.1:5200`
- Database: `data/one-api.db`; runtime replacement only through `scripts/local-native-start.ps1` and its online backup, integrity, and SHA-256 gate.

## Scope

- `web/src/components/layout/SiderBar.jsx`
- `web/src/pages/Promotion/index.jsx`
- `model/promotion.go`
- `model/promotion_test.go`
- Promotion-related keys in all seven frontend locale files.
- Work board and active-session records for this task.

## Preserved Behavior And Non-Goals

- Keep domain management available inside Security and Access.
- Keep reward rows scoped to the authenticated beneficiary; expose no order references or internal user IDs.
- Keep database schema and reward settlement unchanged.
- No CLI, Docker, production release, remote publication, or unrelated billing changes.

## Acceptance

- Sidebar has no standalone Domain Management item, while Security and Access retains its domain tab.
- Promotion tabs are ordered Reward Ledger, Users I Invited, User Promotion Details.
- Detail rows contain time, full payer and upline usernames, base quota, reward amount, level, source, and status.
- Focused Go tests verify direct/second-level relation names, accounting fields, and user isolation.
- Frontend i18n lint, Prettier check, production build, and Windows-native 5200 acceptance pass.
- Before runtime replacement, the actual SQLite instance has a fresh, integrity-checked, SHA-256-verified backup and a recorded executable rollback.
