#!/usr/bin/env bash
set -euo pipefail
# This job never installs dependencies or executes generated application code.
expected=$(cat .incoming/.run/base-tree)
actual=$(git rev-parse HEAD:.state)
if [ "$actual" != "$expected" ]; then
  echo 'State changed since preparation. Refusing to overwrite or rebase publication history.' >&2
  exit 1
fi
for name in last_posted_claude.txt last_posted_codex.txt last_posted_grok_build.txt posted.jsonl; do
  cp ".incoming/.state/$name" ".state/$name"
done
git add .state/last_posted_claude.txt .state/last_posted_codex.txt .state/last_posted_grok_build.txt .state/posted.jsonl
if ! git diff --cached --quiet; then
  git -c user.name=agent-releases-bot -c user.email=41898282+github-actions\[bot\]@users.noreply.github.com commit -m 'chore: persist publication state'
  git push origin HEAD:main
fi
# The next persistence step must compare against this exact reservation tree.
git rev-parse HEAD:.state > .incoming/.run/base-tree
