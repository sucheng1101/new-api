# Work Board — newapi

This board is the project-level coordination entry point for Codex and WorkBuddy. It does not replace the project skill or AGENTS.md.

## Project profile

- Class: product/application + service/api
- Operational profile: hosted-service, data-sensitive
- Primary write rule: one task, one primary write session, one task branch.
- Docker rule: use the verified project Docker/Compose workflow for software run, test, build, and health checks.
- Release rule: GitHub publication and online version sync are separate operations; Gitee is not part of the release path.

## Active tasks

| Task ID | Status | Mode | Branch | Base commit | Primary writer/session | Review session | Owned paths | Docker evidence | Next action |
|---|---|---|---|---|---|---|---|---|---|
| OPS-2026-10-13-newapi-sop-runtime | DONE | governance + local-runtime + release-scenario-separation | `codex/token-endpoint-bar` | `d3df271abf7f161d0ed4848e78bc0b158e016f55` | Codex `/root` | Codex `/root` | `Dockerfile`, `docker-compose.dev.yml`, `scripts/local-start.ps1`, `scripts/local-check.ps1`, `docs/runbooks/local-source-development.md`, `docs/runbooks/release-update.md`, `scripts/release.ps1`, `scripts/update-local.ps1`, `controller/release.go`, `controller/release_test.go`, `skills/project-newapi/SKILL.md`, `.github/workflows/sync-to-gitee.yml` removal | Docker healthy at `127.0.0.1:5200`; current commit label `364eda7bca61836d1215ced8b6fb22e82591b0f1`; native runtime absent; Compose/static/PowerShell checks passed; focused Go test passed in Docker | Local governance commit `74ccb4308`; no release/push/deploy; formal publication waits for legacy AGENTS Gitee conflict reconciliation |

## Current repository baseline (discovery only)

- Observed branch: `codex/token-endpoint-bar`
- Observed HEAD: `364eda7bca61836d1215ced8b6fb22e82591b0f1`
- Board initialized: 2026-10-12
- Existing working-tree changes are reviewed and assigned only to the paths listed above; unrelated paths remain untouched.

## Runtime handoff

- Canonical mode: `docker`
- Runtime owner: Codex `/root` while this task is in VERIFYING
- Runtime lock: `.git/new-api-dev/runtime-lock.json`
- Native Windows process: must be absent before Docker acceptance
- Docker rebuild rule: source/build-input changes require `up -d --build --force-recreate`
- Lock takeover: different sessions wait; stale takeover requires no active runtime and lock age > 30 minutes

## Acceptance checklist

- [x] `docker compose -p newapi-dev -f docker-compose.dev.yml config -q`
- [x] PowerShell parser checks for `scripts/local-start.ps1` and `scripts/local-check.ps1`
- [x] Current commit equals application image label `com.newapi.runtime.commit`
- [x] `/api/status`, `/api/status/latest-release`, and `/` pass
- [x] No project-owned native process listens on port 5200
- [x] Focused controller test passes in Docker Go container
- [x] Codex review complete; only then create the scoped governance commit
- [x] GitHub-only release path verified; server-only online sync remains separate and does not push or tag

## Release instruction conflict

- The repository-level `AGENTS.md` still contains a legacy requirement to push both GitHub and Gitee.
- The confirmed project SOP, project skill, and release scripts now define GitHub-only publication and no Gitee workflow.
- Formal production publication remains paused until the repository instruction is reconciled with the confirmed SOP; this local governance task does not push, tag, release, or deploy.

## Latest verification evidence

- Docker rebuild completed from workspace commit `364eda7bca61836d1215ced8b6fb22e82591b0f1` with `up -d --build --force-recreate`.
- `local-check.ps1 -ExpectedCommit 364eda7bca61836d1215ced8b6fb22e82591b0f1 -AllowUnavailableReleaseService` passed application, version, image-label, runtime-mode, port, and native-process checks.
- GitHub latest-release endpoint was `unavailable-allowed` because the external service was temporarily rate-limited; application health and release endpoint reachability still passed.
- Focused Docker test passed: `go test ./controller -run TestProjectReleaseSourcesUseGitHubOnly -count=1`.
- Local governance commit created: `74ccb4308 chore: consolidate project operating SOP`.
- Existing unrelated working-tree changes remain untouched: `.dockerignore`, `VERSION`.

## Handoff reminders

- WorkBuddy returns implementation/test evidence to Codex.
- Codex performs review, integration, GitHub publication, release, online sync, rollback, and closure.
- When two task branches reach REVIEW or RELEASE_READY, create an integration session before starting another writer on the same paths.
