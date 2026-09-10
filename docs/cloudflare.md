# Cloudflare 发布器

一个定时 Worker + 一个 D1 数据库，复用现有版本解析、过滤、中文生成和 X OAuth 客户端。没有公开 HTTP 发帖接口、队列或自动重发。`wrangler.toml` 默认 `DRY_RUN="true"`；本分支不自动部署、不改变当前 Actions。

## 状态与并发

- `cursors` 记录各产品处理进度；纯修复也可推进进度，因此游标不是发布凭证。
- `publications` 以 `(product, version)` 为主键，保存正文、时间、北京时间日期和 tweet ID。
- 发布前原子插入 `pending`。数据库唯一索引只允许整个账号存在一条 pending，插入同时检查当天最多 5 条及读取时的游标，防止并发运行重复占用。
- X 返回 ID 后，在 D1 事务里同时标记 `posted` 和推进游标。超时、HTTP 错误、回写失败均抛错；pending 保留，后续任务停发。
- 先完成全部来源读取和草稿生成再写数据库。每次每产品最多发一条。没有初始化游标时只记录最新版本，不补发历史。
- 预览不写表、不调用 X。每日限额同样影响预览选题。

Cloudflare 的 Node 兼容模式把绑定的变量与 Secrets 提供给 `process.env`，因此现有源、LLM 和 X 客户端无需另一套配置接口。[官方说明](https://developers.cloudflare.com/workers/runtime-apis/nodejs/process/#processenv)

## 本地验证

需要 Bun 和 Node.js 22 以上；CI 使用 Node.js 24。

```sh
bun install --frozen-lockfile
bun run check
bunx wrangler d1 migrations apply DB --local
bun run dev:cloudflare
```

另一个终端调用 Wrangler 显示的本地地址下的 `/cdn-cgi/local/scheduled` 触发预览。生成草稿需要本地凭据；测试套件使用假凭据和封闭的网络替身，不会调用真实 X 或 LLM。测试使用真正的 workerd 和 D1，覆盖并发、判重、预览、来源/草稿失败、X 失败、回写失败、每日限额和初始化。

## 创建与预览部署（需要另行执行）

1. 登录 Cloudflare，执行 `bunx wrangler d1 create agent-releases`，将返回的真实 ID 写入 `wrangler.toml`，替换全零占位值。
2. 执行 `bunx wrangler d1 migrations apply DB --remote` 创建表。
3. 用 `bunx wrangler secret put NAME` 配置现有凭据：`ANTHROPIC_API_KEY`、`X_API_KEY`、`X_API_SECRET`、`X_ACCESS_TOKEN`、`X_ACCESS_TOKEN_SECRET`。按现有线上值配置 `ANTHROPIC_BASE_URL`、`DRAFT_MODEL`、`DRAFT_MAX_TOKENS`、`DRAFT_TIMEOUT_MS`、`DRAFT_THINKING`，不要在迁移时同时更换模型。GitHub API 可使用只读公共仓库的 `GITHUB_TOKEN`，不需要代码写入权限。
4. 保持 `DRY_RUN="true"`，执行 `bunx wrangler deploy`。用 `bunx wrangler tail` 查看每小时预览结果。不要把 Secrets 写入仓库或 SQL 文件。

## 切换现有账号

停止旧发布器和人工发帖后才取最终快照；否则两个账本无法互相判重。

```sh
gh workflow disable hourly.yml
# 检查并等待已有任务结束；有 pending 时先按旧流程核对。
gh run list --workflow hourly.yml --limit 5
git fetch origin publication-state
git restore --source=origin/publication-state --worktree -- .state
bun run scripts/export-d1.ts > /tmp/agent-releases-import.sql
bunx wrangler d1 execute DB --remote --file /tmp/agent-releases-import.sql
```

导入目标必须是只有表结构的空数据库；工具拒绝未决发布，不覆盖已有行。预览模式不写数据库，所以允许先部署预览再导入。逐一核对 `cursors` 与旧游标、`publications` 与旧账本里的不同产品/版本数、tweet ID。旧预览条目不导入；同一版本的重复历史收敛到最后一条确认记录，原始 Git 历史仍保留。

确认后把 `DRY_RUN` 改为 `"false"` 并重新部署。保持旧 Actions 关闭，等待一次新版本完成发布和回写验收。若切换失败，可以在 Worker 仍是预览、D1 尚未新增正式发布的情况下恢复旧 Actions；一旦 Worker 已发送新帖，必须先对齐账本，不能直接恢复旧发布器。

## 复查和解除停发

```sh
bunx wrangler d1 execute DB --remote --command "SELECT product,version,status,tweet_id,reserved_at,posted_at FROM publications ORDER BY reserved_at DESC LIMIT 30"
bunx wrangler d1 execute DB --remote --command "SELECT product,version,text,reserved_at FROM publications WHERE status='pending'"
```

`posted` 表示曾经发出，不代表帖子目前仍存在。打开 `https://x.com/i/status/ID` 或使用现有 `list X timeline` 工作流核对完整正文、版本及时间。不要仅凭最近一页没找到就认定未发送。

核对期间先将 Worker 设为预览并等待正在运行的任务结束。确认已发：将该 pending 行的 `status` 改为 `posted`，填写真实 `tweet_id` 和 `posted_at`；下轮会依据账本跳过该版本并推进游标。确认未发：删除对应 pending 行，保持游标不变，让新运行重新生成。无法确认时保留 pending。人工发帖也必须记录到同一张表后再恢复自动发布。

D1 事务无法与 X 请求组成一个原子事务；该方案优先避免重复，结果未知时仍需人工核对。[D1 事务说明](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)
