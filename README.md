# agent-releases

为 [@agentreleases](https://x.com/agentreleases) 整理 Claude Code、Codex CLI 和 Grok Build 的中文版本更新。非官方，与 Anthropic / OpenAI / xAI 无关。

## 当前运行方式

Cloudflare Worker `agent-releases` 每小时第 17 分钟检查更新；D1 的 `cursors` 保存处理进度，`publications` 保存发布状态。2026-09-10 已从 GitHub Actions 迁移；旧 `publication-state` 分支是迁移前历史，不再是实时账本。

1. 读取三个版本源，跳过已发版本和纯修复，生成完整中文草稿。
2. 在 D1 原子写入 `pending` 后才调用 X。产品＋版本唯一，整个账号只允许一条未决发布；每天最多 5 个不同版本，每次每产品最多 1 条。
3. X 返回 tweet ID 后，事务保存成功状态并推进游标。发送或回写结果不确定时保留 pending，后续任务停发，等待人工核对。

删除 X 帖子不会允许自动重发。人工发布需要同步 D1，不能只改游标。线上配置为 `DRY_RUN=false`；维护预览须改为 true 后重新部署。没有公开 HTTP 发帖入口。

## 验证与维护

```sh
bun install --frozen-lockfile
bun run check
```

检查包括类型检查、原有回归测试、真实 workerd/D1 的本地集成测试和部署包构建，使用网络替身，不发真实推文。

`bun run start` 启动本地开发并强制预览，不直接运行正式发布。数据库初始化、凭据配置、查看日志、查询账本及解除停发，见 [Cloudflare 操作说明](docs/cloudflare.md)。现有 `list X timeline` 和 `delete X post` 工作流仍可供人工核对与维护。

## 模型与凭据

Worker Secrets 使用现有 X OAuth 和 LLM 凭据；模型与端点保持迁移前配置。`nodejs_compat` 将绑定提供给现有客户端的 `process.env`。正文不完整、只有 thinking、超时或长度超限都明确失败，不用英文或规则模板代替中文。

当前已验证账本导入和 Cloudflare 远程预览。新版本真实发帖与其结果回写，仍须在首次更新时验收；数据库事务不能消除 X 响应丢失造成的不确定性。
