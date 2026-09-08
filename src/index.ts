import { fetchLatestClaude } from "./sources/claude.ts";
import { fetchLatestCodex } from "./sources/codex.ts";
import { fetchLatestGrokBuild } from "./sources/grok-build.ts";
import type { Product, Release } from "./sources/types.ts";
import { readState, writeState, listChangedStateFiles } from "./state.ts";
import { isNotable } from "./filter.ts";
import { draftChinesePost } from "./draft.ts";
import { openDraftIssue } from "./github-issue.ts";
import { postTweet } from "./twitter.ts";
import { writeFileSync } from "fs";

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

type FetchFn = () => Promise<Release | null>;

const FETCHERS: { product: Product; fetch: FetchFn }[] = [
  { product: "claude", fetch: fetchLatestClaude },
  { product: "codex", fetch: fetchLatestCodex },
  { product: "grok_build", fetch: fetchLatestGrokBuild },
];

async function handleOne(product: Product, release: Release): Promise<boolean> {
  const prev = readState(product);
  if (prev === null) {
    writeState(product, release.version);
    console.log(`[seed] ${product} -> ${release.version} (no post)`);
    return true;
  }
  if (prev === release.version) {
    console.log(`[skip] ${product} ${release.version} already seen`);
    return false;
  }
  if (!isNotable(release.notes)) {
    writeState(product, release.version);
    console.log(`[skip-fixed] ${product} ${release.version} not notable; advanced state`);
    return true;
  }

  const text = draftChinesePost(release);
  console.log(`\n=== draft ${product} ${release.version} ===\n${text}\n`);

  if (DRY_RUN) {
    const url = await openDraftIssue(release, text);
    console.log(`[dry-run] issue: ${url}`);
  } else {
    const id = await postTweet(text);
    console.log(`[posted] tweet id ${id}`);
  }
  writeState(product, release.version);
  return true;
}

async function main() {
  console.log(`agent-releases start DRY_RUN=${DRY_RUN}`);
  let changed = false;
  for (const { product, fetch } of FETCHERS) {
    try {
      const release = await fetch();
      if (!release) {
        console.log(`[warn] no release for ${product}`);
        continue;
      }
      const did = await handleOne(product, release);
      changed = changed || did;
    } catch (e) {
      console.error(`[error] ${product}`, e);
    }
  }
  // Hint for workflow commit step
  writeFileSync(
    "/tmp/agent-releases-changed.txt",
    changed ? "1" : "0",
    "utf8",
  );
  console.log("state files:", listChangedStateFiles().join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
