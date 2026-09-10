# @agentreleases 运营计划

> 更新：2026-09-09（Asia/Shanghai）  
> 账号：https://x.com/agentreleases  
> 管道：https://github.com/majiayu000/agent-releases  
> 定位：中文开发者的 AI Agent 发版雷达（Claude Code / Codex / Grok Build；Grok Bot 待接）

## 一句话
非官方、只报有料的 Added/Changed；正常情况下 Cloudflare Worker 发布；生成失败或发布结果不明时由人核对，禁止自动重复试发。

## 分工
| 角色 | 职责 |
| --- | --- |
| Cloudflare Worker（每小时） | 监控三源 → 筛 Fixed-only → 完整中文 → 持久化意图 → 发 X → 保存结果 |
| Felix（每周 ≤30 分钟） | 置顶/简介、大号带 1～2 次、回评论、偶尔小红书改编 |
| star（助手） | 起稿、周报、大版本对比帖、改管道 |

## 第 0 天清单
- [ ] 发并置顶介绍帖
- [ ] 简介含三产品名 + 非官方；Website = 仓库 URL
- [ ] 时间线只留真更新（测试帖已删）
- [ ] 大号关注本号；简介不写「我的小号」

### 置顶文案
```
这里是 Agent Releases（非官方）
自动追踪 Claude Code / Codex / Grok Build 发版
只整理值得看的 Added / Changed，不刷纯 bugfix
标签：【Claude】【Codex】【Grok Build】
Not affiliated with Anthropic / OpenAI / xAI
```

## 第 1–2 周：冷静期（活着 + 被看见）
**发帖**：只靠 Worker；空窗不硬发。

**每周至少做 2 件曝光**
1. 大号转 1 条最好的（附一句人话）
2. 英文 changelog 下用中文补一句 + 链接
3. 搜「Claude Code 更新」认真回 2～3 条

**中文盘**：每周 1 条小红书（同一更新讲「对开发者意味着什么」+ 出处）。

**禁止**：买粉、互赞群、大小号对刷、一天 >5 条、Fixed-only。

## 第 3–4 周：记忆点
大版本时加 1 条人工帖：`本周 Agent 雷达` 或 `【对比】Claude vs Codex…`  
可选：接入 Grok Bot（粗糙源）。

## 第 2 个月：常态
| 频率 | 内容 |
| --- | --- |
| 自动 | 有料就发 |
| 每周日 | 「本周 3 条值得看」（可空窗跳过） |
| 每月 | 「本月 Agent 变化」（可同步小红书） |
| 随时 | 前 100 粉阶段每条认真评论都回 |

## 指标
- 第 2 周末：置顶清晰；≥1 次大号带来的互动
- 第 4 周末：出现非本人转/评
- 第 8 周末：≥1 条较高展现或圈外转发  
粉丝数次要。4 周仍 0 互动 → 加小红书/即刻 + 对比帖，管道不停。

## 差异化与风险
- 差异：中文 + 多源 + 严筛
- 风险：发太勤像 spam；与英文大号比信息不「更深」，靠筛选与中文可读性

## 管道备忘
- Secrets：`X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`
- 草稿模型：`DRAFT_MODEL=glm-5.3-flash`（BigModel Anthropic 网关）；超时默认 120s；失败停发，不使用规则替换兜底
- 状态：Cloudflare D1 的 `cursors` + `publications`；`publication-state` 分支只保留迁移前历史；先持久化意图再发帖，未决意图必须核对，不盲目重试
- 手动只预览：本地 `bun run dev:cloudflare` 强制 DRY_RUN=true；线上维护预览须将 Worker 配置 DRY_RUN=true 后重新部署
- 删帖：workflow `delete X post` + tweet id
- 源：Claude GitHub/CHANGELOG；Codex rust releases；Grok Build changelog；Grok Bot 未接

## 待办候选
1. 大号转发模板 + 小红书首发
2. 接入 Grok Bot 粗糙源
3. 每周日「本周雷达」草稿 routine（只审不发）

修复后的恢复步骤与上线核对见 [README](../README.md)。每日最多 5 个版本、每次每产品最多 1 条；Cloudflare 定时配置传播可能延迟。
