# Task Plugin Parity Acceptance Matrix

This document is the runtime acceptance record for the v0.13.2 task-plugin
parity work. A source change, a green build, or an API response alone does not
change a row to accepted: the row needs both focused automated evidence and a
matching local-5200 browser result.

## Automated Refresh — 2026-09-17

| Requirement | Fixture / role | API or runtime evidence | Focused test | Browser evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Current frontend assets are buildable and local sources are reachable | Anonymous local requests | Source backend on 5200 and Vite on 5173 both returned HTTP 200; Docker MySQL, Redis, and MinIO were healthy. | `bun run build` exited 0 | Authenticated page check pending; in-app browser timed out | Automated verified; browser pending |
| Task detail is always available | Successful plugin task, administrator | `details` is independent of artifact URL; task timing and billing DTO fields are projected by the server. | `taskLogDetails.test.js` passed in `bun test` | Administrator detail check pending | Automated verified; browser pending |
| Plugin artifact is separate | Successful plugin task with no public `result_url` | Artifact list/content resolves durable storage before plugin fallback and keeps the upstream media URL private. | Controller and service artifact regression tests passed | Preview and download check pending | Automated verified; browser pending |
| Task detail role projection | User / administrator / root | Task DTO supplies basic, administrator, and root projections separately. | `taskLogDetails.test.js` role tests passed | Three-role check pending | Automated verified; browser pending |
| Usage-log diagnostic projection | User / administrator / root | Adapter exposes request, conversion, plugin, root, billing, and content sections only from projected fields. | `usageLogDetailAdapter.test.js` passed in `bun test` | Three-role check pending | Automated verified; browser pending |
| Plugin page shell | Administrator | Task-plugin page uses the management-page layout below the fixed navigation and keeps one primary plugin shell. | `taskPluginJsxBindings.test.js` passed in `bun test` | 375/768/1024/1440 px check pending | Automated verified; browser pending |
| Marketplace source isolation | Administrator, valid and invalid local source fixtures | Selection, validation, retry state, and source isolation are handled in the page view model. | `pluginViewModel.test.js` passed in `bun test` | Selected-source/retry check pending | Automated verified; browser pending |
| Plugin lifecycle and six-tab details | Factory / third-party / override fixtures | Detail, icon, versions, activation, dry-run, and deletion endpoints are present; Prompt Hubs remains `third_party`. | Targeted controller lifecycle and ownership tests passed | Menu, six tabs, and blockers pending | Automated verified; browser pending |
| Task-plugin channel binding | Prompt Hubs-style local fixture | The channel keeps public `MiniMax-H3`, `task_plugin_key`, and its upstream mapping separately. | Targeted controller and jsplugin tests passed | Save/reopen check pending | Automated verified; browser pending |
| MiniMax-H3 price matrix | `MiniMax-H3` public / `minimax_h3` upstream fixture | Snapshot/profile identity remains public `MiniMax-H3`; upstream identity remains `minimax_h3`. | Targeted model and jsplugin H3/billing tests passed; task-expression matrix tests passed | Configure, preview, conflict, and audit check pending | Automated verified; browser pending |

## Fresh automated evidence

- `go test ./... -count=1`: passed.
- Targeted controller, service, model, and task-jsplugin regression suites: passed.
- `cd web && bun test`: `93 pass`, `0 fail`.
- Changed task-plugin, task-detail, and pricing files: ESLint and Prettier checks passed.
- `cd web && bun run build`: exited 0; Vite completed in about 66 seconds.

The remaining Hailuo reference-media addon-price configuration is intentionally
outside this refresh. Prompt Hubs is covered as a third-party plugin, never a
factory plugin.

## Current runtime ownership

- Local backend: source-mode `go run .`, listening on `127.0.0.1:5200`.
- Local frontend: Vite source-mode server on `127.0.0.1:5173`, proxying API
  requests to 5200.
- Database services: local Docker MySQL, Redis, and MinIO on the ports in
  `docker-compose.local.yml`.
- The current development session does not depend on the old `launchd`
  one-binary runtime. Startup and shutdown are documented in
  `docs/runbooks/local-source-development.md`.

## Validation rules

1. Do not use a production provider, a provider credential, or an externally
   signed media URL to complete a row.
2. Do not record a normal-user screenshot as proof of administrator/root-only
   fields.
3. Do not regard a Vite build as proof of JSX runtime correctness; inspect the
   actual authenticated local 5173 page after each frontend change and the
   local 5200 page before a one-binary release.
4. Preserve unrelated dirty files and use explicit paths for every later
   commit.
