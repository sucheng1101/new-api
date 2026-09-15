# Task Plugin Parity Acceptance Matrix

This document is the runtime acceptance record for the v0.13.2 task-plugin
parity work. A source change, a green build, or an API response alone does not
change a row to accepted: the row needs both focused automated evidence and a
matching local-5200 browser result.

## Baseline — 2026-09-15

| Requirement | Fixture / role | API or runtime evidence | Focused test | Browser evidence | Status |
| --- | --- | --- | --- | --- | --- |
| Current frontend assets are served by 5200 | Anonymous shell request | Before restart, 5200 served `index-DRdxgwN0.js` while `web/dist` declared `index-DU_VSow9.js`; the stale embedded binary was replaced through `launchd` job `new-api-taskplugins-5200`. Afterwards both lists match `index-DU_VSow9.js`. | N/A — runtime asset comparison recorded | In-app browser reached `/login?expired=true`; authenticated visual check pending | Runtime fixed; browser pending |
| Task detail is always available | Successful plugin task, administrator | Source maps `getTaskLogActions(task).details` to `details` independently of artifact URL. | `taskLogDetails.test.js` passes | Previous screenshot showed `详情: 无`; fresh authenticated check pending | Not accepted |
| Plugin artifact is separate | Successful plugin task with no public `result_url` | `/api/task/:task_id/artifacts` is called only by artifact modal. | `taskLogDetails.test.js` passes | Fresh authenticated media preview/download check pending | Not accepted |
| Task detail role projection | User / administrator / root | Task DTO supplies basic, admin, and root fields separately. | `taskLogDetails.test.js` passes | Three-role check pending | Not accepted |
| Usage-log diagnostic projection | User / administrator / root | Adapter has request, conversion, plugin, root, billing, and content sections. | Existing adapter tests need full rerun after Task 2 | Three-role check pending | Not accepted |
| Plugin page shell | Administrator | 5200 sidebar config enables `taskPlugin`; source contains one `task-plugin-shell` card. | TaskPlugin tests pending | Page and narrow-width check pending | Not accepted |
| Marketplace source isolation | Administrator, one valid and one invalid local index fixture | Source selection/error behavior has not been accepted. | Marketplace tests pending | Selected-source/retry check pending | Not accepted |
| Plugin lifecycle and six-tab details | Factory / third-party / override fixtures | API endpoints for detail, icon, versions, activation, dry-run, delete exist. | Lifecycle tests pending | Menu, six tabs, and blockers pending | Not accepted |
| Task-plugin channel binding | Prompt Hubs-style local fixture | Channel binding tests are present but not rerun in this baseline. | Controller test pending | Save/reopen check pending | Not accepted |
| MiniMax-H3 price matrix | `MiniMax-H3` public / `minimax_h3` upstream fixture | Snapshot APIs and H3 usage code exist. | Pricing/H3 suite pending | Configure, preview, conflict, and audit check pending | Not accepted |

## Current runtime ownership

- Local application listener: `127.0.0.1:5200` / `*:5200`.
- Supervisor: local `launchd` submitted job `new-api-taskplugins-5200`.
- Database services: the named local Docker MySQL and Redis containers on the
  ports configured by `docker-compose.local.yml`.
- Rollback artifact: the pre-rebuild executable is retained under
  `.git/new-api-dev/new-api.previous-20260915-002745`.

## Validation rules

1. Do not use a production provider, a provider credential, or an externally
   signed media URL to complete a row.
2. Do not record a normal-user screenshot as proof of administrator/root-only
   fields.
3. Do not regard a Vite build as proof of JSX runtime correctness; inspect the
   actual local 5200 page after each frontend rebuild/restart.
4. Preserve unrelated dirty files and use explicit paths for every later
   commit.
