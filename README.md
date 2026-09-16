# agent-releases

为 [@agentreleases](https://x.com/agentreleases) 整理 Claude Code、Codex CLI、Codex App 和 Grok Build 的中文版本更新。非官方，与 Anthropic / OpenAI / xAI 无关。

## 当前运行方式

AaITR VPS 上的 `agent-releases.timer` 每小时第 17 分钟检查更新；SQLite 的 `cursors` 保存处理进度，`publications` 保存发布状态。Cloudflare 定时器关闭且保持预览配置，D1 和旧 `publication-state` 分支只保留迁移历史。

1. 读取各版本源，跳过已发版本和纯修复，生成完整中文草稿。
2. 在 SQLite 原子写入 `pending` 后才调用 X。产品＋版本唯一，整个账号只允许一条未决发布；每天最多 5 个不同版本，每次每产品最多 1 条。
3. X 返回 tweet ID 后，事务保存成功状态并推进游标。发送或回写结果不确定时保留 pending，后续任务停发，等待人工核对。

删除 X 帖子不会允许自动重发。人工发布需要同步 VPS 账本，不能只改游标。VPS 入口默认只读预览，正式服务显式传入 `--publish`。没有公开 HTTP 发帖入口。

## 验证与维护

部署路径、服务管理和只读预览见 [VPS 操作说明](docs/vps.md)。

```sh
bun install --frozen-lockfile
bun run check
```

检查包括类型检查、原有回归测试、真实 workerd/D1 的本地集成测试和部署包构建，使用网络替身，不发真实推文。

`bun run start` 启动本地 Worker 开发并强制预览，不直接运行正式发布。[Cloudflare 操作说明](docs/cloudflare.md) 保留作历史参考，不能直接重新启用其中的定时器。现有 `list X timeline` 和 `delete X post` 工作流仍可供人工核对与维护。

## 模型与凭据

VPS 使用现有 GitHub Secrets 中的 X OAuth 和 LLM 凭据，通过加密传输写入 root 所有、权限 0600 的环境文件，由 systemd 加载。模型与端点保持原配置。正文不完整、只有 thinking、超时或长度超限都明确失败，不用英文或规则模板代替中文。

新版本真实发帖与其结果回写，需要在首次更新时验收；数据库事务不能消除 X 响应丢失造成的不确定性。
