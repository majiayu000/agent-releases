# agent-releases

为 [@agentreleases](https://x.com/agentreleases) 整理 Claude Code、Codex CLI 和 Grok Build 的中文版本更新。非官方，与 Anthropic / OpenAI / xAI 无关。

## Cloudflare 分支

本分支提供 Workers + D1 发布实现，部署与切换见 [Cloudflare 操作说明](docs/cloudflare.md)。默认只预览，尚未切换线上发布器。下文保留当前 GitHub Actions 的操作方式，切换时必须停用其定时任务，避免两个发布器同时运行。

## 发布流程

定时任务每小时第 17 分钟请求运行；GitHub Actions 可能延迟，不承诺每小时准点送达。手动运行默认只预览。

1. **prepare**：读取最新主分支的状态，检查源是否完整，过滤纯修复、生成完整中文草稿。任一源或草稿失败，整个批次不进入发帖阶段。
2. **reserve**：独立任务将发布意图提交到 `publication-state`，此时尚未调用 X。该任务不安装依赖或执行应用代码。
3. **publish**：使用已持久化的意图发帖；任务只有仓库读取权限。每条成功后立即在本地记录 tweet ID，失败结果保持待核对。
4. **persist-results**：即使部分帖子失败，也保存成功结果。状态基线不一致或推送失败时明确报错，不自动 rebase 覆盖账本。

正式发布每天最多 5 个版本，按北京时间计算；每次每产品最多发 1 条，积压留待下一次。预览、生成失败、未发出的版本不推进正式进度。没有初始版本状态时只记录最新版本，不补发历史。

`posted.jsonl` 中正式条目没有 `tweetId` 表示发布结果待核对；有 `tweetId` 才表示已确认发出。同一版本先记意图、再追加成功记录。发布意图中保留正文和 run ID，便于在响应丢失后核对。预览不会创建发布意图或修改任何 `.state` 文件；草稿存于日志和 `prepared` artifact，不再自动创建 Issue。

## 本地检查与预览

```bash
bun install --frozen-lockfile
bun run check
git fetch origin publication-state
git restore --source=origin/publication-state --worktree -- .state
bun run start
```

`check` 只做类型检查和离线回归测试，不调用 X 或真实 LLM，也不修改仓库发布状态。`start` 始终预览，忽略旧的 `DRY_RUN` 环境变量；需要配置 LLM 才能生成新版本草稿。正式 prepare/publish 只允许在首次运行的 Actions 中执行。

`preview X text` 工作流也只展示输入正文，不再拥有 X 凭据或发帖能力。

## LLM 与凭据

仓库 Secrets：

- X：`X_API_KEY`、`X_API_SECRET`、`X_ACCESS_TOKEN`、`X_ACCESS_TOKEN_SECRET`。
- 草稿：`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`DRAFT_MODEL`。
- 现有调节项：`DRAFT_MAX_TOKENS`、`DRAFT_TIMEOUT_MS`、`DRAFT_THINKING`。

代码默认模型仍为 `glm-5.3-flash`，端点默认 BigModel Anthropic gateway；请求使用兼容协议的 `output_config.effort`，代码生成标题与链接，模型只翻译要点；未替换线上模型或凭据。LLM 请求失败、只返回 thinking、达到 token 上限或正文不合格都明确失败；不再使用逐词替换或英文正文兜底，长度超限时减少完整要点，不截断句子凑长度。正文检查是基本质量门槛，不能证明所有技术描述准确。

`smoke LLM draft` 从三个真实发版源读取最新版本，使用与正式生成相同的参数及正文检查，只生成草稿，不发 X。2026-09-10 的线上模型链路曾连续失败；代码检查通过不能替代真实凭据下的 smoke 验证。

## 发布结果不确定时

不要点击 **Re-run jobs** 重放发帖，也不要回退版本文件后试发。Live 阶段拒绝 Actions rerun；已有未决意图时，新运行也会停止。

1. 查看失败运行的 `results` artifact、发布日志和 `list X timeline` 输出；按产品、版本、完整正文核对 X。最近十条查不到不能证明帖子从未发出，必要时继续翻页核对。
2. 已确认发出：将实际 tweet ID 追加到对应版本的账本，保持 `dryRun:false`，并核对版本进度。若只是结果提交失败，可审阅 artifact 与 `publication-state` 的差异后保存成功记录。
3. 已明确未发出：人工审阅后移除该条未决意图，再开启一个新 workflow run。无法确认时保留意图并停发，避免猜测重试。
4. 删帖不会重置“曾发布”记录，不应通过删帖自动开启重发。

该机制优先防止重复，不宣称 X 与 Git 之间存在原子事务：持久化意图后中断可能导致一次漏发，但会留下可核对记录，不会自动重复发帖。

## 上线核对

本次仅依据 [2026-09-10 15:41 的账号查询](https://github.com/majiayu000/agent-releases/actions/runs/34451172407) 追加确认的 4 条现存版本帖记录（Claude 2.1.261/265/267、Codex 0.154.0），保留原账本作为历史。未回退版本进度、补发或删除帖子，Grok 的历史跳过也未改变。部署前若账号又有人工操作，应重新核对对应记录。

启用修复后的正式发布前，应先通过 CI、真实 LLM smoke 和手动预览，审阅四阶段 workflow 的权限与中断恢复行为。代码保存在 `main`，发布账本只保存在 `publication-state`，机器人不再写入代码分支。`main` 要求 PR 与 `check` 通过，并禁止强推和删除；单人仓库不强制第二人批准。
