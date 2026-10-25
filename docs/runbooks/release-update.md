# 发布、线上同步与回滚 SOP

本手册把本地 Docker 验证、GitHub 代码发布、线上版本同步和回滚拆成四种场景。Gitee 不属于本项目流程；`origin` 等上游远端只读。

## 1. 场景分类

| 场景 | 代码/构建输入变化 | GitHub 推送 | 线上变更 | 说明 |
|---|---:|---:|---:|---|
| 本地开发/测试 | 可能 | 否 | 否 | 只在 Docker Compose 中验证 |
| 代码发布 | 是 | 是，项目自有 GitHub | 可选 | 生成可追溯 Release 制品 |
| 线上版本同步 | 否 | 否 | 是 | 使用已验证的 Commit、镜像或制品 |
| 生产配置/数据操作 | 否 | 否 | 是 | 只改已批准的配置或数据范围 |
| 回滚 | 否 | 否 | 是 | 恢复已验证的版本或备份 |

**判断规则：**
1. 修改了源代码、依赖、Dockerfile、Compose、构建配置或其他受 Git 跟踪的构建输入：归类为“代码发布”。
2. 只把已经存在且已经验证的版本放到服务器：归类为“线上版本同步”。
3. 仅服务器版本号变化，不触发 GitHub 推送、Tag 创建或新制品构建。
4. Gitee 不参与本地、测试、发布、线上同步或回滚。

## 2. 代码发布（GitHub-only）

### 发布前

```powershell
# 在仓库根目录执行；默认使用当前分支，避免写死分支名
pwsh ./scripts/release.ps1 -Version v1.2.3 -Build -RuntimeOwner SESSION_ID
```

发布前必须满足：

- 工作区只包含本次任务已审查的变更；
- 当前分支、任务卡、基线 Commit 和拥有路径已写入 `docs/WORK-BOARD.md`；
- Docker Compose 配置通过，应用由当前 Commit 构建并完成健康检查；
- 后端测试、前端构建及项目专项验收已记录；
- 生产目标、备份位置、健康检查和回滚命令已明确。

### 创建 Tag 并推送 GitHub

```powershell
pwsh ./scripts/release.ps1 -Version v1.2.3 -CreateTag -Push
```

脚本只推送项目自有 GitHub 的当前分支和 Tag，并核对远端分支与本地 `HEAD` 一致。脚本不会访问或推送 Gitee。

GitHub Actions `release.yml` 负责构建 Linux amd64、Linux arm64、macOS、Windows 制品，并生成 SHA-256 与 `release-manifest.json`。Windows 制品只用于本地 Windows 场景；Ubuntu 服务器必须选择对应 Linux 架构制品或已验证容器镜像。

### 2.1 在线升级预检与执行器配置

管理后台的“立即升级”会先调用 `/api/status/update` 做预检。预检会返回运行模式、实际执行脚本、工作目录和失败原因；未通过预检时按钮会禁用，不会再启动一个依赖当前工作目录的错误路径。

升级进程不应从 `os.Getwd()` 推断脚本位置。请在服务启动环境中显式配置以下变量之一：

| 变量 | 说明 |
|---|---|
| `NEW_API_UPDATE_MODE` | `windows`、`docker` 或 `systemd`；不填时按运行环境探测，生产建议显式设置 |
| `NEW_API_UPDATE_SCRIPT` | 升级代理所在主机上的绝对脚本路径；适用于容器内应用调用宿主机升级代理的场景 |
| `NEW_API_UPDATE_ROOT` | 应用目录根路径；未设置 `NEW_API_UPDATE_SCRIPT` 时，从这里查找 `scripts/` |
| `DB_BACKUP_COMMAND` | 生产升级前执行并验证实际数据库备份的命令，缺失或验证失败时必须中止 |

容器化生产环境应把“应用容器”和“宿主机升级代理”分开：应用只负责调用配置好的宿主机代理，代理再执行备份、拉取与切换。应用镜像内没有宿主机 Docker/systemd 控制权时，预检会明确提示配置 `NEW_API_UPDATE_SCRIPT`，而不是尝试 `/data/scripts/...` 这类不存在的路径。

升级脚本还必须按 CPU 架构选择 Linux 制品，并在服务恢复后同时校验 `/api/status` 的 `success` 和目标 `data.version`。版本不匹配时即使端口可访问也判定升级失败并进入回滚流程。

## 3. 线上版本同步（独立于代码发布）

适用条件：服务器只需要切换到已经存在的 Release、Commit、镜像 Tag 或制品，源代码和构建输入没有新增变更。

最小记录：

- 目标版本/Commit/镜像摘要；
- 该版本已通过本地 Docker 验证的证据；
- 目标主机、服务或 Compose 项目；
- 变更前健康状态；
- 数据库和应用回滚备份位置；
- 切换命令、切换后健康检查和回滚结果；
- `GitHub push: not applicable for server-only sync`。

线上同步不创建新 Tag、不重新编译 Windows 二进制、不因版本变化触发源代码发布，也不访问 Gitee。若同步过程中发现源代码或构建输入有差异，立即停止并重新归类为“代码发布”。

### Compose 线上同步原则

1. 先核对目标 Compose 项目、服务名、镜像 Tag 和摘要。
2. 备份数据库、应用配置和当前镜像引用。
3. 只切换目标应用服务，不重启无关业务。
4. 运行 `/api/status`、业务 smoke test 和依赖服务检查。
5. 验收通过后清理临时上传目录、临时制品和缓存；保留回滚备份与应用数据。

## 4. 回滚

回滚只恢复已记录的上一版本镜像/制品或备份，不自动创建发布、不推送远端。回滚后必须重新执行健康检查、版本身份检查和关键业务 smoke test，并把事故原因与后续修复另开代码任务记录。

## 5. 发布验收清单

- [ ] 任务分类正确：代码发布 / 线上版本同步 / 配置数据 / 回滚。
- [ ] 当前分支、基线 Commit、主写会话和运行锁已记录。
- [ ] Docker Compose 使用当前工作区 Commit 构建，镜像标签/摘要可追溯。
- [ ] `/api/status`、`/api/status/latest-release`、前端根路径通过。
- [ ] 目标架构制品与服务器架构匹配。
- [ ] 备份可读，回滚命令可执行。
- [ ] 线上只影响目标服务，邻近服务保持健康。
- [ ] 临时制品和缓存已清理，回滚备份和应用数据已保留。

## 6. 失败处理

Docker 构建、测试、健康检查或制品校验失败时，保留日志并停止发布门禁。不要改用 Windows 原生编译冒充 Docker 验证；修复 Docker 工作流或等待网络/镜像依赖恢复后再继续。
