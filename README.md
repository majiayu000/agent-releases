# agent-releases

Unofficial Chinese release drafts for [@agentreleases](https://x.com/agentreleases) — Claude Code / Codex / Grok Build.

非官方 · 与 Anthropic / OpenAI / xAI 无关。

## What it does

Hourly GitHub Action:

1. Poll Claude Code GitHub Releases (+ CHANGELOG fallback)
2. Poll OpenAI Codex GitHub Releases (`rust-v*` preferred)
3. Parse [Grok Build changelog](https://x.ai/build/changelog)
4. Skip Fixed-only versions
5. Draft a short Chinese post with tags `【Claude】` / `【Codex】` / `【Grok Build】`
6. **Default `DRY_RUN=true`**: open a GitHub Issue with the draft (does **not** post to X)
7. When `DRY_RUN=false` + X secrets: post via OAuth 1.0a

First run **seeds** `.state/*` without posting.

> TODO: Grok Bot — no stable versioned feed yet.

## Secrets (repo Settings → Secrets)

Only needed for live posting:

- `X_API_KEY`
- `X_API_SECRET`
- `X_ACCESS_TOKEN`
- `X_ACCESS_TOKEN_SECRET`

## Local

```bash
bun install
DRY_RUN=true bun run start
```

## Enable X posting

1. Put the four X secrets above
2. Actions → **agent-releases hourly** → Run workflow → set dry_run to `false`

Or change the workflow default later (keep DRY_RUN true for the first week).

## Manual first tweets

Use Issues created by DRY_RUN, or paste drafts from local runs.
