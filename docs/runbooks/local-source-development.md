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

首次启动时，脚本按修改时间选择 `formal-backups/`、`backups/` 和仓库根目录中最新的有效 SQLite 数据库快照。仅当 `data/one-api.db` 不存在且 MySQL 数据库没有表时才复制快照；已有 SQLite 或 MySQL 数据会原样保留，不会被新快照覆盖。没有有效快照且数据库为空时启动会中止，避免静默创建全新实例。

## 2. 会话和运行锁

一个任务只有一个主写入会话和一个 `runtime_owner`。其他 Codex、WorkBuddy、测试或
审查会话只读检查，不得启动、停止、重建或切换运行时。启动前必须读取运行锁：

```json
{
  "runtime_mode": "docker",
  "runtime_owner": "SESSION_ID",
  "runtime_id": "newapi-dev",
  "runtime_commit": "GIT_COMMIT",
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

该命令会依次检查 Docker、Compose 配置、项目端口和原生进程归属，然后执行：

```powershell
docker compose -p newapi-dev -f .\docker-compose.dev.yml up -d --build --force-recreate
powershell -ExecutionPolicy Bypass -File .\scripts\local-check.ps1 -ExpectedCommit (git rev-parse HEAD)
```

源码或 Docker 构建输入（`Dockerfile`、Compose、`web/package.json`、锁文件、配置等）
发生变化后，必须再次 `build + force-recreate`。只执行 `restart` 不会更新镜像中的
嵌入式后端和前端，不作为验收依据。

## 4. 验收证据

```powershell
docker compose -p newapi-dev -f .\docker-compose.dev.yml ps
powershell -ExecutionPolicy Bypass -File .\scripts\local-check.ps1 -ExpectedCommit (git rev-parse HEAD)
```

验收必须同时证明：

1. `/api/status` 返回成功；
2. `/api/status/latest-release` 可访问；
3. `/` 返回 HTTP 200；
4. 应用容器 label `com.newapi.runtime.commit` 等于当前 `git rev-parse HEAD`；
5. 应用容器 label 的运行模式为 `docker`；
6. 5200 没有 Windows 原生 `new-api`、`go run`、Bun 或 Node 应用监听；
7. Compose project、容器名称和端口均属于本 checkout。

## 5. 模式切换

### 原生进程切换到 Docker

先确认监听 5200 的 PID、可执行路径和命令行都属于本仓库；只停止该进程组，确认
端口释放后再执行 `local-start.ps1`。不得仅凭进程名 `go` 或 `node` 停止进程。

### Docker 例外切换到 Windows-native

只有任务卡明确记录原因、owner、端口和回切步骤时才允许。先停止 `newapi-dev` 的
应用组，确认 5200 释放，原生启动命令和日志路径写入工作板；审查、发布或线上同步
前必须回到 Docker 并完成当前 commit 的重建验收。

## 6. WorkBuddy 使用方式

Codex 先建立任务卡、分支、基线 commit、允许修改路径和验收标准，再把单一边界任务
交给 WorkBuddy。WorkBuddy 必须先读本手册、项目 skill、`AGENTS.md`、工作板和运行锁；
只有任务卡将其列为 `runtime_owner` 时才可控制 Docker。WorkBuddy 返回文件清单、精确
命令、通过/失败结果、commit 候选和未决风险，由 Codex 进行审查、整合、发布或线上
版本同步。

## 7. 停止与数据保留

```powershell
docker compose -p newapi-dev -f .\docker-compose.dev.yml stop
```

需要释放资源时停止容器即可；不要删除命名卷。任何归属不明的容器、端口或进程都保留
现状并记录，待确认后处理。

## 8. 线上版本同步边界

线上服务器只更新已验证的 commit、镜像或发布制品时，归类为 `ONLINE_SYNC`，不因为
服务器版本变化而触发源代码发布或 Gitee 操作。它必须单独记录目标、备份、健康检查和
回滚制品；代码发布、GitHub 推送和线上同步是三个独立决策。
