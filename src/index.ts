import { fetchLatestClaude, fetchClaudeSince } from "./sources/claude.ts";
import { fetchLatestCodex, fetchCodexSince } from "./sources/codex.ts";
import { fetchLatestGrokBuild, fetchGrokBuildSince } from "./sources/grok-build.ts";
import type { Product, Release } from "./sources/types.ts";
import { readState, writeState, listChangedStateFiles } from "./state.ts";
import { isNotable } from "./filter.ts";
import { draftChinesePost } from "./draft.ts";
import { openDraftIssue } from "./github-issue.ts";
import { postTweet } from "./twitter.ts";
import { writeFileSync } from "fs";

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";

type FetchLatest = () => Promise<Release | null>;
type FetchSince = (afterVersion: string) => Promise<Release[]>;

const FETCHERS: {
  product: Product;
  fetchLatest: FetchLatest;
  fetchSince: FetchSince;
}[] = [
  {
    product: "claude",
    fetchLatest: fetchLatestClaude,
    fetchSince: (after) => fetchClaudeSince(after),
  },
  {
    product: "codex",
    fetchLatest: fetchLatestCodex,
    fetchSince: (after) => fetchCodexSince(after),
  },
  {
    product: "grok_build",
    fetchLatest: fetchLatestGrokBuild,
    fetchSince: (after) => fetchGrokBuildSince(after),
  },
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

  const text = await draftChinesePost(release);
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

async function processProduct(
  product: Product,
  fetchLatest: FetchLatest,
  fetchSince: FetchSince,
): Promise<boolean> {
  const prev = readState(product);

  // Seed (no state): still seed latest without posting
  if (prev === null) {
    const tip = await fetchLatest();
    if (!tip) {
      console.log(`[warn] no release for ${product}`);
      return false;
    }
    return handleOne(product, tip);
  }

  const range = await fetchSince(prev);
  const tipVer = range.length > 0 ? range[range.length - 1].version : prev;
  console.log(`[walk] ${product} ${prev}..${tipVer} (${range.length})`);

  let changed = false;
  for (const release of range) {
    const did = await handleOne(product, release);
    changed = changed || did;
  }
  return changed;
}

async function main() {
  console.log(`agent-releases start DRY_RUN=${DRY_RUN}`);
  let changed = false;
  for (const { product, fetchLatest, fetchSince } of FETCHERS) {
    try {
      const did = await processProduct(product, fetchLatest, fetchSince);
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
