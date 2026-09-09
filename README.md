# agent-releases

Unofficial Chinese release drafts for [@agentreleases](https://x.com/agentreleases) — Claude Code / Codex / Grok Build.

非官方 · 与 Anthropic / OpenAI / xAI 无关。

## What it does

Hourly GitHub Action (`DRY_RUN=false` by default on schedule):

1. Poll Claude Code GitHub Releases (paginated) + CHANGELOG fallback
2. Poll OpenAI Codex GitHub Releases (`rust-v*`, paginated; HTML tip only for seed)
3. Parse [Grok Build changelog](https://x.ai/build/changelog) (multi-version, oldest-first)
4. Skip Fixed-only versions
5. Draft a short Chinese post (`【Claude】` / `【Codex】` / `【Grok Build】`) via **GLM-5.3-Flash** (BigModel Anthropic gateway) with rule-based fallback
6. Post to X when `DRY_RUN=false` + X secrets; otherwise open a GitHub Issue
7. Append `.state/posted.jsonl` ledger, then advance `.state/last_posted_*.txt`
8. Commit all of `.state/` (including ledger). Fail-loud: any product error → exit 1

First run **seeds** `.state/*` without posting.

> TODO: Grok Bot — no stable versioned feed yet.

## Secrets (repo Settings → Secrets)

Live posting:

- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET`

LLM drafting (optional but recommended):

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL` (default `https://open.bigmodel.cn/api/anthropic`)
- `DRAFT_MODEL` (default / recommended: `glm-5.3-flash`)

## Local

```bash
bun install
bun run selfcheck:draft
DRY_RUN=true bun run start
```

## Enable / disable X posting

- **Schedule**: always `DRY_RUN=false` (live).
- **Manual**: Actions → **agent-releases hourly** → Run workflow → `dry_run` true|false.

## State & ledger

- `.state/last_posted_*.txt` — last processed version per product
- `.state/posted.jsonl` — append-only `{ts, product, version, tweetId|issueUrl, dryRun}`; skips re-post if a live tweetId already exists for that product+version
- Commit step must keep `.state/` in git (rebase-retry on push race)
