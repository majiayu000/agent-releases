import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchLatestClaude, fetchClaudeSince } from "./sources/claude.ts";
import { fetchLatestCodex, fetchCodexSince } from "./sources/codex.ts";
import { fetchLatestGrokBuild, fetchGrokBuildSince } from "./sources/grok-build.ts";
import type { Product, Release } from "./sources/types.ts";
import { readState, writeState } from "./state.ts";
import { appendLedger, dailyPostCount, hasPostedLive, pendingPosts, postingDay } from "./ledger.ts";
import { isNotable } from "./filter.ts";
import { draftChinesePost } from "./draft.ts";
import { postTweet } from "./twitter.ts";

export type Source = {
  product: Product;
  fetchLatest: () => Promise<Release | null>;
  fetchSince: (version: string) => Promise<Release[]>;
};
const SOURCES: Source[] = [
  { product: "claude", fetchLatest: fetchLatestClaude, fetchSince: fetchClaudeSince },
  { product: "codex", fetchLatest: fetchLatestCodex, fetchSince: fetchCodexSince },
  { product: "grok_build", fetchLatest: fetchLatestGrokBuild, fetchSince: fetchGrokBuildSince },
];
export type Plan = {
  runId: string;
  day: string;
  posts: { release: Release; text: string }[];
};

/** Preparation has no X side effects. Only the workflow can persist reservations. */
export async function prepare(
  live: boolean,
  runId: string,
  sources = SOURCES,
  draft = draftChinesePost,
  now = new Date(),
): Promise<Plan> {
  const pending = pendingPosts();
  if (live && pending.length) {
    throw new Error(`Unresolved X publication; reconcile before retry: ${pending.map(p => `${p.product} ${p.version}`).join(", ")}`);
  }
  const plan: Plan = { runId, day: postingDay(now), posts: [] };
  const remaining = Math.max(0, 5 - dailyPostCount(now));
  const updates: { product: Product; version: string }[] = [];
  const errors: string[] = [];
  for (const source of sources) {
    try {
      const prev = readState(source.product);
      if (prev === null) {
        const tip = await source.fetchLatest();
        if (!tip) throw new Error("Source returned no release for initial state");
        updates.push({ product: source.product, version: tip.version });
        console.log(`[seed] ${source.product} ${tip.version}${live ? "" : " (preview only)"}`);
        continue;
      }
      const releases = await source.fetchSince(prev);
      console.log(`[walk] ${source.product}: ${releases.length} new releases`);
      for (const release of releases) {
        if (hasPostedLive(source.product, release.version) || !isNotable(release.notes)) {
          updates.push({ product: source.product, version: release.version });
          continue;
        }
        if (live && plan.posts.length >= remaining) {
          console.log(`[deferred] daily limit reached: ${source.product} ${release.version}`);
          break;
        }
        const text = await draft(release);
        plan.posts.push({ release, text });
        console.log(`=== ${source.product} ${release.version} ===\n${text}`);
        // At most one new post per product per run. Never advance past an unposted version.
        break;
      }
    } catch (error) {
      errors.push(`${source.product}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (live) {
    for (const update of updates) writeState(update.product, update.version);
    for (const { release, text } of plan.posts) {
      appendLedger({ ts: now.toISOString(), product: release.product, version: release.version, dryRun: false, runId, text });
    }
  }
  return plan;
}

/** Runs only after reservations are committed remotely. Failed outcomes remain pending. */
export async function publish(plan: Plan, send = postTweet, now = () => new Date()): Promise<void> {
  if (plan.posts.length && plan.day !== postingDay(now())) {
    throw new Error("Reservation crossed the daily boundary; reconcile it before publishing");
  }
  const pending = pendingPosts();
  for (const { release, text } of plan.posts) {
    if (!pending.some(p => p.product === release.product && p.version === release.version && p.runId === plan.runId && p.text === text)) {
      throw new Error(`Missing pending reservation: ${release.product} ${release.version}`);
    }
  }
  const errors: string[] = [];
  for (const { release, text } of plan.posts) {
    try {
      if (plan.day !== postingDay(now())) throw new Error("Daily boundary reached; publication stopped");
      const tweetId = await send(text);
      if (!/^\d+$/.test(tweetId)) throw new Error("X returned no valid tweet ID; outcome unknown");
      appendLedger({ ts: now().toISOString(), product: release.product, version: release.version, dryRun: false, runId: plan.runId, tweetId });
      writeState(release.product, release.version);
      console.log(`[posted] ${release.product} ${release.version}: ${tweetId}`);
    } catch (error) {
      errors.push(`${release.product} ${release.version}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(`Reconcile pending outcomes before retry:\n${errors.join("\n")}`);
}

if (import.meta.main) {
  try {
    const mode = process.argv[2] ?? "preview";
    if (!["preview", "prepare", "publish"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
    if (mode !== "preview" && (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_RUN_ATTEMPT !== "1")) {
      throw new Error("Live phases require a fresh Actions run. Never rerun a publication job; reconcile first.");
    }
    if (mode === "publish") {
      const plan = JSON.parse(readFileSync(".run/plan.json", "utf8")) as Plan;
      if (plan.runId !== process.env.GITHUB_RUN_ID) throw new Error("Publication plan belongs to another run");
      await publish(plan);
    } else {
      const plan = await prepare(mode === "prepare", process.env.GITHUB_RUN_ID ?? "local");
      mkdirSync(".run", { recursive: true });
      writeFileSync(".run/plan.json", JSON.stringify(plan, null, 2) + "\n");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
