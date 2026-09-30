# Git Release 更新与回滚流程

这套流程把本地开发、副本更新、GitHub/Gitee 发布和线上切换统一到同一个
版本 Tag。当前工作区已经接入查询接口和发布脚本；本轮不连接生产服务器。

## 版本契约

- 版本使用 SemVer 风格 Tag，例如 `v1.2.3` 或 `v1.2.3-promotion.1`。
- Release 的提交必须先在项目自有 GitHub 和 Gitee 的目标分支对齐。
- GitHub Release 由 `.github/workflows/release.yml` 构建 Linux amd64、Linux arm64、
  macOS 和 Windows 制品，并生成每个制品的 SHA-256 与 `release-manifest.json`。
- Gitee Release 由 `.github/workflows/sync-to-gitee.yml` 同步。启用前需要先创建
  `sucheng1101/new-api` Gitee 仓库，并在 GitHub Actions 配置 `GITEE_TOKEN`。
  当前检查显示该 Gitee 仓库尚未创建，所以暂不添加或推送 `gitee` 远程。
- `origin` 保持上游只读，项目发布远程使用 `github` 和 `gitee`。

## 本地发布预检

在仓库根目录执行：

```powershell
pwsh ./scripts/release.ps1 -Version v1.2.3 -Build
```

脚本会检查工作区干净、分支正确、GitHub 远程存在，并运行后端测试和前端构建。
它不会创建 Tag，也不会推送远程。

完成代码审查、创建 Gitee 仓库并确认两个远程可写后，再执行：

```powershell
pwsh ./scripts/release.ps1 -Version v1.2.3 -CreateTag -Push
```

脚本会推送目标分支和 Tag，并核对 GitHub/Gitee 分支哈希与本地 `HEAD` 一致。
GitHub Actions 完成后，发布页应同时存在制品、各平台 checksums 和 manifest。

## New API 更新检查

`GET /api/status/latest-release` 按 GitHub → Gitee 顺序读取项目自己的最新公开
Release，返回来源、Tag、正文、详情地址和制品清单。管理后台“检查更新”只调用
这个本机接口，不再直接请求上游仓库或在浏览器中处理跨域。

没有公开 Release 时接口返回失败信息，这是预期状态，不代表本地代码不可用。

## 本地副本更新

Windows 本地副本按 manifest 下载并校验后替换，原二进制保存在同目录的 `backups`：

```powershell
pwsh ./scripts/update-local.ps1 -Tag v1.2.3 -InstallPath .\bin\new-api.exe
```

如果副本正在运行，先由操作者停止对应进程；需要脚本停止同名进程时显式增加
`-StopProcess`。脚本校验二进制 `--version` 输出，不匹配会自动恢复备份。

## 线上切换顺序

线上使用 `scripts/production-update.sh`，脚本假设 New API 以 systemd 服务运行，
且应用二进制位于 `APP_ROOT/new-api`。实际部署若是 Docker，应先把同样的步骤接入
Compose 镜像切换脚本，不要直接套用二进制路径。

发布前准备数据库备份命令，并通过 `PRE_UPDATE_HOOK` 传入；脚本只备份应用二进制、
`.env` 和回滚目录，不猜测数据库类型或数据路径。示例：

```bash
RELEASE_TAG=v1.2.3 \
CONFIRM_RELEASE=YES \
APP_ROOT=/opt/new-api \
SERVICE_NAME=new-api \
HEALTH_URL=http://127.0.0.1:3000/api/status \
PRE_UPDATE_HOOK='mysqldump ... > /var/backups/new-api/pre-release.sql' \
bash scripts/production-update.sh
```

脚本执行顺序为：锁定更新、下载 manifest、校验 SHA-256、创建回滚备份、执行备份
Hook、停止服务、替换二进制、启动服务、健康检查。启动或健康检查失败会恢复旧
二进制并重新启动服务；成功后保留回滚备份，清理临时下载目录。

## 上线前验收清单

1. 后端 `go test -count=1 ./...` 通过，前端 `bun run build` 通过。
2. GitHub/Gitee 目标分支指向同一提交，Release Tag 指向同一提交。
3. GitHub 和 Gitee 的 manifest、制品和 SHA-256 一致。
4. 生产数据库备份可读取，应用备份目录可回滚。
5. `/api/status` 返回成功且版本等于 Release Tag。
6. 推广、抽奖、赠送、充值、减少余额和任务插件做一次回归验收。
7. 验收成功后删除临时上传目录、临时二进制和本地 Release 压缩包；保留回滚备份
   与应用数据。
