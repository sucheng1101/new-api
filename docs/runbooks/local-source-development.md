# 本地源码开发启动手册

本文档用于 `new-api-v0.13.2` 的日常开发。开发运行态由三个独立
进程组成：Docker Desktop 中的 MySQL、Redis 和 MinIO 对象存储、从 Go 源码
启动的后端、以及从 Vite 源码启动的前端。

不要在日常开发中使用当前的 `make` / `make dev`。它仍会构建后端，且
默认端口与本手册的本地开发端口不同。嵌入前端的一体化二进制仅用于
发布或生产化验收。

## 本地端口与数据

| 组件          | 地址或端口               | 用途                                      |
| ------------- | ------------------------ | ----------------------------------------- |
| MySQL         | `127.0.0.1:13306`        | Docker 服务，数据库为 `new-api-local-dev` |
| Redis         | `127.0.0.1:16379`        | Docker 服务                               |
| MinIO API     | `127.0.0.1:19000`        | Docker 服务，保存成功视频等任务制品       |
| MinIO Console | `http://127.0.0.1:19001` | 本地对象存储管理界面                      |
| Go 后端       | `http://127.0.0.1:5200`  | API、任务处理和管理端 API                 |
| Vite 前端     | `http://127.0.0.1:5173`  | 日常开发页面，代理 API 到 5200            |

MySQL、Redis 和 MinIO 的 Docker 卷会保留已导入的本地数据快照和任务制品。
停止容器不会删除数据；不要执行 `docker compose down -v`。

## 首次准备

`main.go` 使用 `//go:embed web/dist`。即使日常页面由 Vite 直接从
`web/src` 提供，Go 首次编译仍要求 `web/dist` 存在。因此仅在以下场景
执行一次前端生产构建：首次拉取、手动清理了 `web/dist`、前端依赖变更，
或需要制作一体化验收包。

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2

cd "$ROOT/web"
bun install
bun run build
```

日常修改 React 页面后不需要再次执行 `bun run build`。

## 日常启动

### 1. 启动数据库容器

在 Docker Desktop 已运行的前提下执行：

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2
cd "$ROOT"

docker compose -f docker-compose.local.yml up -d mysql redis minio minio-init
docker compose -f docker-compose.local.yml ps
```

预期 `new-api-mysql` 和 `new-api-redis` 显示为 `healthy`，`new-api-minio`
显示为 `running`，`new-api-minio-init` 成功退出（`Exited (0)`）。

### 2. 启动 Go 后端源码

在一个独立终端执行。命令从 Docker 容器读取本地 MySQL 密码到当前 shell
变量，不会输出该值。显式设置的 `SQL_DSN` 和 `REDIS_CONN_STRING` 会覆盖
仓库 `.env` 或 shell 中遗留的连接配置。

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2
cd "$ROOT"

MYSQL_ROOT_PASSWORD="$(
  docker inspect new-api-mysql \
    --format '{{range .Config.Env}}{{println .}}{{end}}' |
    sed -n 's/^MYSQL_ROOT_PASSWORD=//p'
)"

env -u SQL_DSN -u REDIS_CONN_STRING \
  PORT=5200 \
  SQL_DSN="root:${MYSQL_ROOT_PASSWORD}@tcp(127.0.0.1:13306)/new-api-local-dev?charset=utf8mb4&parseTime=true&loc=Local" \
  REDIS_CONN_STRING='redis://127.0.0.1:16379/0' \
  TASK_ARTIFACT_STORE_MODE=s3 \
  TASK_ARTIFACT_STORE_S3_ENDPOINT=http://127.0.0.1:19000 \
  TASK_ARTIFACT_STORE_S3_BUCKET=new-api-task-artifacts \
  TASK_ARTIFACT_STORE_S3_REGION=us-east-1 \
  TASK_ARTIFACT_STORE_S3_ACCESS_KEY=new-api-local \
  TASK_ARTIFACT_STORE_S3_SECRET_KEY=new-api-local-artifacts \
  go run . --log-dir .git/new-api-dev/source-logs
```

`go run .` 直接运行当前源码。它会使用 Go 的临时构建缓存，但不会生成或
替换发布二进制。修改 Go 代码后，在此终端按 `Ctrl+C`，再重复本节命令即可。

### 3. 启动 Vite 前端源码

在另一个独立终端执行：

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2
cd "$ROOT/web"

VITE_PROXY_TARGET=http://127.0.0.1:5200 \
  bun run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

开发时访问 `http://127.0.0.1:5173`。Vite 会将 `/api`、`/mj` 和 `/pg`
代理到 5200；修改前端源码后由 HMR 自动刷新，不需要重启后端或重新构建
`web/dist`。

## 启动验证

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2
docker compose -f "$ROOT/docker-compose.local.yml" ps
curl -fsS -o /dev/null -w 'backend: %{http_code}\n' http://127.0.0.1:5200/api/status
curl -fsS -o /dev/null -w 'frontend: %{http_code}\n' http://127.0.0.1:5173/
```

预期两个 HTTP 检查均返回 `200`。后端日志位于
`.git/new-api-dev/source-logs`，可用以下命令跟踪：

```bash
tail -F .git/new-api-dev/source-logs/oneapi-*.log
```

## 停止

1. 分别在 Go 和 Vite 终端按 `Ctrl+C`。
2. 下班或需要释放 Docker 资源时再停止数据库容器：

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2
cd "$ROOT"
docker compose -f docker-compose.local.yml stop mysql redis minio
```

停止容器会保留数据卷。重新执行“日常启动”即可恢复。

## 发布或一体化验收

只有需要由单个后端端口提供嵌入式前端时，才执行生产构建。顺序必须是先
构建前端，再构建 Go 二进制：

```bash
ROOT=/Users/Zhuanz1/Desktop/privateProjects/ssh/workspace/new-api-v0.13.2

cd "$ROOT/web"
bun run build

cd "$ROOT"
go build -o bin/new-api-local .
```

该模式与日常 Vite 开发模式分开使用，不要同时启动同端口的旧版二进制或
`launchd` 任务。
