# 生产任务制品对象存储上线手册

本手册用于将 v0.13.2 的任务插件、视频制品持久化和对象存储能力上线到
生产环境。适用的对象存储是 MinIO 或任何兼容 S3 Signature V4 的服务。

本手册不保存生产主机、密钥、数据库密码、对象存储凭据或测试令牌。这些值
只能存在于服务器受限权限的环境文件或密钥管理系统中。

## 1. 上线范围与关键行为

新版会在成功的视频任务完成后，把可获取的制品保存到对象存储，并在数据库
的 `task_artifact_objects` 表保存非敏感对象引用。任务详情和制品接口始终由
NewAPI 代理读取对象，浏览器不需要也不应取得供应商的原始签名 URL。

对象存储由以下启动环境变量控制：

| 变量                                | 生产要求                                                                            |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `TASK_ARTIFACT_STORE_MODE`          | 必须为 `s3` 才启用持久制品；未设置时为 `upstream`。                                 |
| `TASK_ARTIFACT_STORE_S3_ENDPOINT`   | NewAPI 容器可访问的 S3 端点；同一 Compose 网络中的 MinIO 使用 `http://minio:9000`。 |
| `TASK_ARTIFACT_STORE_S3_BUCKET`     | 已预先创建的专用桶，例如 `new-api-task-artifacts`。                                 |
| `TASK_ARTIFACT_STORE_S3_REGION`     | MinIO 可使用 `us-east-1`；外部 S3 使用实际 region。                                 |
| `TASK_ARTIFACT_STORE_S3_ACCESS_KEY` | 仅对该桶授权的应用访问密钥。                                                        |
| `TASK_ARTIFACT_STORE_S3_SECRET_KEY` | 上述访问密钥对应的私密值。                                                          |
| `TASK_ARTIFACT_STORE_S3_PREFIX`     | 可选；用于按环境隔离对象，例如 `production`。                                       |

应用启动时会自动创建 `task_artifact_objects` 表，不需要手工执行 SQL 迁移。
配置缺失或校验失败时，应用不会因对象存储而停止，但会退回旧的上游制品模式。
这种回退不满足“视频长期预览和下载”的上线目标。

## 2. 发布前边界

1. 先将当前代码提交并推送到目标分支。私有发布脚本要求工作区干净，且本地
   `HEAD` 与远端同分支一致。
2. 生产首发前单独完成对象存储基础设施部署；不要把它混入一次普通镜像切换。
3. 已有的 MySQL、Redis、Nginx 和 NewAPI 数据卷保持原样。不要执行
   `docker compose down`、不要删除 MinIO 卷、不要在发布时重建数据库容器。
4. 普通镜像发布只重建 `new-api`。MinIO 是持久状态服务，后续发布不应重启或
   重建它。
5. 当前私有 `deploy/release.sh` 只检查和备份 NewAPI、MySQL、Redis。对象存储
   首次接入前以及每次发布前，必须按本手册补充对象存储检查和备份；在脚本完成
   这些能力前，不要把它称为对象存储的完整一键发布。

## 3. 一次性部署对象存储

### 3.1 准备私有环境文件

在服务器创建两个权限为 `0600` 的环境文件，位置应在应用仓库和 Git 工作树
之外，例如 `/etc/newapi/minio.env` 与 `/etc/newapi/task-artifacts.env`。

- `minio.env` 只供 MinIO 管理服务读取，保存其管理员账号。
- `task-artifacts.env` 只供 `new-api` 服务读取，保存上表所列
  `TASK_ARTIFACT_STORE_*` 变量。
- 应用访问密钥应为 MinIO/S3 的专用受限账号，仅可读写目标桶；不要将 MinIO
  管理员账号交给 `new-api` 容器。

在启动前验证文件权限和变量名，不输出变量值：

```bash
sudo stat -f '%Sp %N' /etc/newapi/minio.env /etc/newapi/task-artifacts.env
sudo awk -F= 'NF && $1 !~ /^#/ { print $1 }' /etc/newapi/task-artifacts.env
```

Linux 主机没有 `stat -f` 时使用：

```bash
sudo stat -c '%A %n' /etc/newapi/minio.env /etc/newapi/task-artifacts.env
```

### 3.2 更新生产 Compose

在生产机现有 `docker-compose.yml` 中增加以下概念，不要用示例覆盖现有文件：

1. `minio` 服务使用固定镜像版本、`server /data --console-address ":9001"`、
   `restart: unless-stopped`，并挂载独立命名卷或受管磁盘到 `/data`。
2. `minio` 和 `new-api` 位于同一内部 Compose 网络。S3 API 和 Console 不要直接
   暴露到公网；确有运维需求时只绑定回环地址并由受控反向代理或 SSH 隧道访问。
3. `new-api` 服务通过 `env_file: /etc/newapi/task-artifacts.env` 注入对象存储变量。
4. 为 MinIO 增加健康检查，并加一个一次性初始化任务或等效运维步骤，确保桶在
   NewAPI 首次写入前已经存在。
5. 将 MinIO 数据卷纳入服务器备份策略，命名与 MySQL/Redis 卷分开。

先做 Compose 静态验证，再启动对象存储，避免改动应用容器：

```bash
APP_DIR=/path/to/newapi
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" config -q
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" up -d minio
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" ps
```

### 3.3 创建桶和应用账号

使用受控管理员终端或 MinIO Console 完成以下操作：

1. 创建专用桶，名称与 `TASK_ARTIFACT_STORE_S3_BUCKET` 完全一致。
2. 创建仅供 NewAPI 使用的访问账号。
3. 给该账号授予目标桶的 `ListBucket`、`GetObject`、`PutObject` 权限；不授予
   其他桶权限和管理员权限。
4. 在管理端执行一次列桶与最小对象读写检查，然后删除测试对象。

可使用 `mc` 执行这些操作；所有账号和密钥通过受限 shell 变量或密钥管理系统
传入，禁止粘贴到终端历史、Git、部署日志或截图中。

### 3.4 首次启用应用配置

对象存储已健康且桶已存在后，先仅重建 NewAPI：

```bash
APP_DIR=/path/to/newapi
MYSQL_CONTAINER=newapi-mysql
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" \
  up -d --no-deps --force-recreate new-api
```

验证应用启动、数据库迁移和对象存储配置：

```bash
curl -fsS http://127.0.0.1:3000/api/status

docker exec "$MYSQL_CONTAINER" sh -ec \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -e "SHOW TABLES LIKE '\''task_artifact_objects'\''" "$MYSQL_DATABASE"'

docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" ps new-api minio
```

最后使用管理员的低成本测试渠道提交一次视频任务，并在任务日志中确认：

1. 任务完成后出现独立的“制品”操作；
2. 视频可预览和下载；
3. 对象存储桶出现对应对象；
4. 浏览器地址和任务 API 响应中未出现上游签名媒体 URL。

## 4. 每次镜像发布前的检查

以下检查必须在旧 `deploy/release.sh` 的 `preflight` 前完成。它们不打印密钥：

```bash
APP_DIR=/path/to/newapi
NEWAPI_CONTAINER=newapi

docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" ps new-api mysql redis minio
docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" config -q
curl -fsS http://127.0.0.1:3000/api/status >/dev/null

docker exec "$NEWAPI_CONTAINER" sh -ec '
  test "$TASK_ARTIFACT_STORE_MODE" = s3
  test -n "$TASK_ARTIFACT_STORE_S3_ENDPOINT"
  test -n "$TASK_ARTIFACT_STORE_S3_BUCKET"
  test -n "$TASK_ARTIFACT_STORE_S3_REGION"
  test -n "$TASK_ARTIFACT_STORE_S3_ACCESS_KEY"
  test -n "$TASK_ARTIFACT_STORE_S3_SECRET_KEY"
'
```

然后用对象存储管理工具确认目标桶可列出。对外部 S3，使用云平台健康检查和桶权限
审计；对 MinIO，确认容器健康、卷挂载存在、桶存在且应用账号可读写目标桶。

## 5. 数据备份要求

任务制品由两部分组成，必须一起备份：

| 数据                                          | 原因                                 |
| --------------------------------------------- | ------------------------------------ |
| MySQL 中的 `tasks` 与 `task_artifact_objects` | 保存任务状态、制品类型、桶和对象键。 |
| S3/MinIO 桶中对应对象                         | 保存实际视频和其他制品字节。         |

每次发布前按以下顺序执行：

1. 延续现有发布脚本的 MySQL 一致性导出。
2. 对 MinIO 卷创建存储快照，或通过 `mc mirror` 将目标桶镜像到受控备份位置。
3. 保存对象数量、总大小、备份时间和校验结果到同一发布备份目录。
4. 验证数据库导出可解压，验证对象备份可列举，并在发布记录中写入二者的路径。

普通应用镜像回滚不恢复数据库或对象桶，因为它们在镜像切换中没有变更。只有发生
数据损坏或灾难恢复时，才按同一时间点恢复数据库与对象桶；单独恢复其中一方会让
任务制品引用失配。

## 6. 常规代码发布

对象存储基础设施已经就绪后，原有私有发布脚本继续用于镜像交付。当前开发分支
为 `integration/task-plugins` 时，须显式传入该分支或在私有环境文件中设置
`BRANCH=integration/task-plugins`：

```bash
cd /path/to/new-api-v0.13.2
git status --short
git fetch origin --prune
git status -sb

BRANCH=integration/task-plugins ./deploy/release.sh --env aliyun preflight
BRANCH=integration/task-plugins ./deploy/release.sh --env aliyun release
```

脚本的 `--no-deps --force-recreate new-api` 在这一阶段是正确行为：它只替换应用
镜像，不重启 MySQL、Redis 或 MinIO。发布完成后仍需做第 7 节验收。

## 7. 发布后验收与回滚

发布成功至少同时满足以下条件：

1. `/api/status` 返回成功且版本为本次镜像版本。
2. `new-api`、MySQL、Redis、MinIO 均为预期运行状态。
3. 管理员能打开任务插件页、模型价格页、任务日志详情和制品操作。
4. 用批准的低成本测试请求产生一个新制品，确认预览、下载和对象持久化。
5. 使用日志能看到此次任务的计费用量事实、命中档位和最终额度。

若应用启动或浏览器验收失败，使用现有发布脚本回滚 **应用镜像**：

```bash
BRANCH=integration/task-plugins ./deploy/release.sh --env aliyun rollback BACKUP_DIR
```

回滚时不要执行 `docker compose down`，不要删除 MinIO 卷，也不要为了应用回滚而
恢复 MySQL 或对象桶。数据恢复仅按第 5 节的成对恢复流程处理。

## 8. 发布脚本改造清单

在将对象存储纳入完全自动化的一键发布前，私有 `deploy/release.sh` 还需要补齐：

1. 将 MinIO/S3 可达性、桶存在性和应用对象存储配置加入 `preflight`。
2. 记录并验证 MinIO 容器或外部 S3 健康状态，但普通发布仍不重建它。
3. 将对象桶快照或镜像备份加入发布备份阶段，并与 MySQL 备份共同记录。
4. 在发布后执行一次无敏感信息的制品上传、读取和下载烟雾测试。
5. 在发布报告中记录对象存储备份位置、桶检查结果和制品验收结果。

在上述五项完成前，本手册的对象存储检查和备份步骤是上线必需步骤。
