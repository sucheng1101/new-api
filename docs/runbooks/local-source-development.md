# 本地源码开发运行手册（Docker 唯一运行时）

本手册是 `newapi` 本地开发、测试和调试的唯一运行入口。Windows 仅作为 Docker
编排主机；同一 checkout 同一时间只允许一个运行时组：`docker`、经记录批准的
`windows-native` 例外，或 `none`。不得同时启动 Docker 和 Windows 原生版本，也
不得为同一 checkout 启动第二个 Compose project。

## 1. 运行边界

| 项目 | 值 |
|---|---|
| Compose 文件 | `docker-compose.dev.yml` |
| Compose project | `newapi-dev` |
| 应用 | `http://127.0.0.1:5200` |
| MySQL | `127.0.0.1:13306` |
| Redis | `127.0.0.1:16379` |
| MinIO | `127.0.0.1:19000`，控制台 `19001` |
| 运行锁 | `.git/new-api-dev/runtime-lock.json` |
| 数据卷 | `new-api-dev-mysql-data`、`new-api-dev-redis-data`、`new-api-dev-minio-data`（版本切换时保持稳定） |
| 容器名 | `new-api-${VERSION}-app`、`new-api-${VERSION}-mysql`、`new-api-${VERSION}-redis`、`new-api-${VERSION}-minio` |

启动脚本读取根目录 `VERSION`，并将版本号写入容器名、镜像名和运行时 label。数据卷属于本地开发数据。停止或重建应用不得删除数据卷；禁止使用
`docker compose down -v`。

每次启动时，脚本按修改时间选择 `formal-backups/`、`backups/` 和仓库根目录中最新的有效 SQLite 数据库快照。若快照比 `data/one-api.db` 更新，脚本先停止本项目应用容器，将当前数据库保存到 `data/runtime-backups/one-api.db.before-restore-*.db`，再恢复快照；当前数据库更新或没有快照时继续使用当前数据库。只有在没有可用 SQLite 数据时才回退到已有 MySQL 数据；没有有效快照且数据库为空时启动会中止，避免静默创建全新实例。

### 1.1 数据库备份门禁（所有状态变更必需）

重启、重建、重新创建、Docker/native 模式切换、发布、部署和回滚之前，必须先备份并验证**实际运行中的数据库实例**，不能只备份或恢复 SQLite 文件。脚本必须根据运行时配置识别 SQLite、MySQL 或 PostgreSQL，并将备份绑定到引擎、实例和数据库名。

本次遗漏的根因已经固定为两点：旧版 `local-start.ps1` 只处理 SQLite 快照，没有对实际运行的 MySQL 执行转储；随后直接执行 Compose `up --build --force-recreate` 绕过了启动脚本，因此没有任何数据库备份证据。以后 SQLite 快照不能替代 MySQL/PostgreSQL 的实例级备份，任何绕过统一入口的状态变更都视为违规。

- `scripts/local-start.ps1` 是本 checkout 唯一允许触发状态变更的入口，负责在 Compose 变更前执行备份门禁。禁止手工绕过它执行 `docker compose up`、`restart`、`stop`、`down`、`rm` 或同类状态变更命令；`ps`、`config`、`logs`、`inspect` 仅用于只读检查。
- `scripts/production-update-compose.sh` 和 `scripts/production-update.sh` 同样必须先调用 `DB_BACKUP_COMMAND`（或等效统一数据库备份脚本），验证实例匹配、SHA-256 和完整性证据，再执行 `pull`/`up` 或 `systemctl stop/start`；直接执行 Compose/systemctl 状态变更不合规，无法提供证据时必须中止发布。
- 备份缺失、为空、损坏、过期、实例不匹配或未完成完整性/恢复可读校验时，门禁必须立即中止后续停止、重建、切换、发布或部署。
- 运行锁/发布记录必须写入引擎和实例、备份文件路径、UTC 时间、SHA-256、完整性或恢复可读结果以及明确的回滚路径。备份和转储不进入 Git 提交，且不得包含凭据、token、cookie 或私密配置。
- 严禁 `docker compose down -v`、`docker volume rm` 或任何删除命名数据卷的操作；运行时切换只允许保留现有卷和应用数据。

## 2. 会话和运行锁

一个任务只有一个主写入会话和一个 `runtime_owner`。其他 Codex、WorkBuddy、测试或
审查会话只读检查，不得启动、停止、重建或切换运行时。启动前必须读取运行锁：

```json
{
  "runtime_mode": "docker",
  "runtime_owner": "SESSION_ID",
  "runtime_id": "newapi-dev",
  "runtime_commit": "GIT_COMMIT",
  "database_source": "PATH_OR_MYSQL_DATABASE",
  "database_restored": false,
  "database_preserved": null,
  "database_backup": {
    "engine": "sqlite|mysql|postgresql",
    "instance": "RUNTIME_INSTANCE",
    "path": "BACKUP_PATH",
    "sha256": "SHA256",
    "verified": true,
    "rollback_path": "ROLLBACK_PATH"
  },
  "database_comparison": {
    "latest_backup_path": "PATH_OR_NULL",
    "backup_newer": false,
    "decision": "keep-current-database"
  },
  "runtime_ports": [5200, 13306, 16379, 19000, 19001],
  "updated_at": "UTC_ISO_TIMESTAMP"
}
```

- 锁的 owner 与当前会话相同：可以继续并刷新锁。
- owner 不同且 Compose 应用、依赖容器或项目端口仍在运行：保持现状，通知锁持有者。
- owner 不同但运行组已经不存在：只有锁超过 30 分钟且没有项目进程/端口占用时才视为
  `stale`，接管前记录旧 owner、旧 commit 和接管原因。
- 运行组归属不明确时，不停止进程或容器。
- 任务结束或切换到 `none` 时释放锁；若运行时继续给另一任务使用，交接 owner 并写入
  `docs/WORK-BOARD.md`。

`scripts/local-start.ps1` 负责检查和获取锁，`scripts/local-check.ps1` 只做验收，
不会替其他会话接管运行时。

## 3. 日常启动、修改和重建

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-start.ps1 -Owner SESSION_ID
```

该命令会依次检查 Docker、Compose 配置、项目端口和原生进程归属，先通过数据库备份门禁，再由脚本内部执行：

```text
[受控脚本内部流程，不是可执行命令]
1. 创建并校验实际数据库备份，写入 runtime lock。
2. 通过备份门禁后，由 local-start.ps1 执行 Compose build/recreate。
3. 写入待验收状态，运行 local-check.ps1 完成健康、版本、端口、进程与备份证据验收。
4. 验收通过后将 runtime lock 标记为 passed；失败则不得宣称运行时已就绪。
```

源码或 Docker 构建输入（`Dockerfile`、Compose、`web/package.json`、锁文件、配置等）
发生变化后，必须再次 `build + force-recreate`。只执行 `restart` 不会更新镜像中的
嵌入式后端和前端，不作为验收依据。

## 4. 验收证据

```powershell
docker compose -p newapi-dev -f .\docker-compose.dev.yml ps
powershell -ExecutionPolicy Bypass -File .\scripts\local-check.ps1 -ExpectedCommit (git rev-parse HEAD)
```

若外部 GitHub Release API 暂时返回 403 或限流，可在确认本地应用检查均正常后使用
`-AllowUnavailableReleaseService` 重跑本地验收；该开关只放宽外部发布服务检查，不放宽
应用、前端、容器版本、端口或原生进程检查。

验收必须同时证明：

1. `/api/status` 返回成功；
2. `/api/status/latest-release` 可访问；
3. `/` 返回 HTTP 200；
4. 应用容器 label `com.newapi.runtime.commit` 等于当前 `git rev-parse HEAD`；
5. 应用容器 label 的运行模式为 `docker`；
6. 5200 没有 Windows 原生 `new-api`、`go run`、Bun 或 Node 应用监听；
7. Compose project、容器名称和端口均属于本 checkout；
8. 备份文件存在且绑定到实际运行数据库的引擎、实例和数据库名；
9. 备份 SHA-256、完整性/恢复可读校验均通过，并记录在运行锁或发布证据中；
10. 已记录可执行的回滚路径，且备份未进入 Git 提交、未携带凭据或私密配置。

## 5. 模式切换

### 原生进程切换到 Docker

先通过 `local-start.ps1` 的数据库备份门禁，确认备份证据和回滚路径已写入运行锁；再确认监听 5200 的 PID、可执行路径和命令行都属于本仓库；只停止该进程组，确认
端口释放后再执行 `local-start.ps1`。不得仅凭进程名 `go` 或 `node` 停止进程。

### Docker 例外切换到 Windows-native

只有任务卡明确记录原因、owner、端口和回切步骤，并完成实际数据库备份门禁时才允许。先停止 `newapi-dev` 的
应用组，确认 5200 释放，原生启动命令和日志路径写入工作板；审查、发布或线上同步
前必须回到 Docker 并完成当前 commit 的重建验收。

## 6. WorkBuddy 使用方式

Codex 先建立任务卡、分支、基线 commit、允许修改路径和验收标准，再把单一边界任务
交给 WorkBuddy。WorkBuddy 必须先读本手册、项目 skill、`AGENTS.md`、工作板和运行锁；
只有任务卡将其列为 `runtime_owner` 时才可控制 Docker。WorkBuddy 返回文件清单、精确
命令、通过/失败结果、commit 候选和未决风险，由 Codex 进行审查、整合、发布或线上
版本同步。

## 7. 停止与数据保留

释放资源或停止运行时也必须由 `runtime_owner` 通过受控脚本执行，并先满足数据库备份门禁；不得手工运行绕过门禁的 Compose `stop`/`down`/`rm` 命令。需要释放资源时只停止属于本 checkout 的容器，不删除命名卷。任何归属不明的容器、端口或进程都保留
现状并记录，待确认后处理。

## 8. 线上版本同步边界

线上服务器只更新已验证的 commit、镜像或发布制品时，归类为 `ONLINE_SYNC`，不因为
服务器版本变化而触发源代码发布或仓库操作。它必须在任何服务重启/替换前完成实际数据库备份，单独记录目标、引擎/实例、备份文件、SHA-256、完整性校验、健康检查和
回滚制品；代码发布、GitHub 推送和线上同步是三个独立决策。
