# Work Board — newapi

This board is the project-level coordination entry point for Codex and WorkBuddy. It does not replace the project skill or AGENTS.md.

## Project profile

- Class: product/application + service/api
- Operational profile: hosted-service, data-sensitive
- Primary write rule: one task, one primary write session, one task branch.
- Local runtime: Windows-native only on port 5200. Docker is excluded from local development; use `scripts/local-native-start.ps1` for runtime operations.
- Release rule: GitHub publication and online version sync are separate operations; Gitee is not part of the release path.

## Active tasks

| Task ID | Status | Mode | Branch | Base commit | Primary writer/session | Review session | Owned paths | Runtime evidence | Next action |
|---|---|---|---|---|---|---|---|---|---|
| OPS-2026-10-13-newapi-sop-runtime | DONE | governance + local-runtime + release-scenario-separation | `codex/token-endpoint-bar` | `d3df271abf7f161d0ed4848e78bc0b158e016f55` | Codex `/root` | Codex `/root` | `Dockerfile`, `docker-compose.dev.yml`, `scripts/local-start.ps1`, `scripts/local-check.ps1`, `docs/runbooks/local-source-development.md`, `docs/runbooks/release-update.md`, `scripts/release.ps1`, `scripts/update-local.ps1`, `controller/release.go`, `controller/release_test.go`, `skills/project-newapi/SKILL.md`, `.github/workflows/sync-to-gitee.yml` removal | Docker healthy at `127.0.0.1:5200`; current commit label `364eda7bca61836d1215ced8b6fb22e82591b0f1`; native runtime absent; Compose/static/PowerShell checks passed; focused Go test passed in Docker | Local governance commit `74ccb4308`; no release/push/deploy; formal publication waits for legacy AGENTS Gitee conflict reconciliation |
| NA-20261022-PROMOTION-CENTER | IN_PROGRESS | implementation + UI/API verification | `codex/promotion-center-audit-tabs` | `997042c2c` | Codex `/root` (direct execution) | Codex `/root` | `web/src/components/layout/SiderBar.jsx`, `web/src/pages/Promotion/index.jsx`, `model/promotion.go`, `model/promotion_test.go`, frontend locale files | Windows-native 5200; owner `CODEX-NA-RUNTIME-01`; backup-gated acceptance pending | Focused Go tests, i18n/format/build, then native 5200 verification |

## Current repository baseline (discovery only)

- Observed branch: `codex/token-endpoint-bar`
- Observed HEAD: `364eda7bca61836d1215ced8b6fb22e82591b0f1`
- Board initialized: 2026-10-12
- Existing working-tree changes are reviewed and assigned only to the paths listed above; unrelated paths remain untouched.

## Runtime handoff

- Canonical mode: `windows-native`
- Runtime owner: `CODEX-NA-RUNTIME-01`
- Runtime lock: `.git/new-api-dev/runtime-lock.json`
- Database: SQLite `data/one-api.db`; runtime changes go through `scripts/local-native-start.ps1` and its verified backup gate
- Local Docker startup is excluded; historical Compose scripts remain guarded and are not used for local development

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

## 新 SOP 接管记录（2026-10-14）

| Task ID | Status | Mode | Branch | Base commit | Primary writer/session | Review session | Worktree | Owned paths | Runtime owner | Progress | Elapsed | Next action |
|---|---|---|---|---|---|---|---|---|---|---|---|---:|---|---|
| NA-20261014-SECURITY-UI-CLI | PLATFORM_CHECK | implementation + UI/API review | codex/security-direct-allowlist | c1658df57 | WorkBuddy CLI CLI-NA-01（待派发） | Codex thread 01a13613-c2b4-7af1-92c8-7192ba92502c | current checkout（规划已完成，CLI 写入前保持单写入者） | web/src/pages/SecurityAccess/index.jsx, web/src/pages/DirectIPWhitelist/index.jsx, related security API/types, backend security detail endpoints/tests only when required | CLI-NA-RUNTIME-01（newapi-dev / 5200） | 0% | 0m | 将已生成提示词粘贴到 WorkBuddy；CLI 执行 8788 preflight |

- 原安全与访问需求目前只有规划结果，未进入实现；规划会话改为只读 spec/审核角色，后续实现交给 CLI-NA-01。
- CLI 只能在本分支、Docker 单运行时和任务卡列出的路径内工作；不得同时启动 Windows-native newapi。
- 安全页面、异常 IP 详情、白名单和 API 配置保持清晰边界；涉及 API、权限、数据库或运行时冲突时暂停并回报 Codex。
- 每次 CLI 汇报必须包含 progress_percent、elapsed_time、started_at、last_checkpoint、current_step、blocked_reason、next_action。
- 仓库级 AGENTS 的旧 Gitee 双推要求与新 SOP 冲突，暂不进行生产发布；本任务只做本地 CLI 实现和 Docker 验收。


- CLI 通过本任务 Docker/测试验收后，建立仅包含本任务的 scoped feature checkpoint commit；不得混入其他 dirty diff，不执行 push/release/deploy。


## SOP v2026.10.14-cli-8788 发布与新会话（2026-10-14）

- 当前生效执行器：`OpenCode CLI`；模型：`DeepSeek`；唯一代理：`http://127.0.0.1:8788/v1`。
- `8789` 已退出标准流程；旧记录只保留作历史上下文，不得使用。
- 旧Codex Docker/测试/浏览器检查不作为新版CLI验收证据；安全访问任务必须重新由OpenCode CLI接管。
- 新Codex规划/审核会话：`01a13900-1c44-77f1-8e09-139cd88c7d04`。

| Task ID | Status | Executor | Branch | Base commit | Runtime owner | CLI session | Next action |
|---|---|---|---|---|---|---|---|
| NA-20261014-SECURITY-UI-OPENCODE | PLATFORM_CHECK | OpenCode CLI / DeepSeek / 8788 | codex/security-direct-allowlist | c1658df57 | CLI-NA-RUNTIME-01 | CLI-NA-OP-01 pending | 8788 preflight, then Docker/UI/API acceptance |

NewAPI必须保持Docker单运行时；Codex只规划、派发和审核，缺少CLI证据时退回CLI_VERIFYING。
