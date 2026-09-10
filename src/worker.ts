import type { D1Database, ExportedHandler } from "@cloudflare/workers-types";
import { fetchLatestClaude, fetchClaudeSince } from "./sources/claude.ts";
import { fetchLatestCodex, fetchCodexSince } from "./sources/codex.ts";
import { fetchLatestGrokBuild, fetchGrokBuildSince } from "./sources/grok-build.ts";
import type { Product, Release } from "./sources/types.ts";
import { isNotable } from "./filter.ts";
import { draftChinesePost } from "./draft.ts";
import { postTweet } from "./twitter.ts";

interface Env { DB: D1Database; DRY_RUN: string }
const sources = [
  { product: "claude", latest: fetchLatestClaude, since: fetchClaudeSince },
  { product: "codex", latest: fetchLatestCodex, since: fetchCodexSince },
  { product: "grok_build", latest: fetchLatestGrokBuild, since: fetchGrokBuildSince },
] as const;
const dayOf = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
const pending = (db: D1Database) => db.prepare("SELECT product, version FROM publications WHERE status = 'pending'").first<{ product: string; version: string }>();

async function run(env: Env): Promise<void> {
  if (env.DRY_RUN !== "true" && env.DRY_RUN !== "false") throw new Error("Set DRY_RUN explicitly to true or false");
  const preview = env.DRY_RUN === "true";
  const db = env.DB;
  const unresolved = await pending(db);
  if (unresolved) throw new Error(`Reconcile pending X outcome before continuing: ${unresolved.product} ${unresolved.version}`);

  // Finish all source reads and drafts before modifying state or calling X.
  const plans: { product: Product; previous: string | null; cursor: string; release?: Release; text?: string }[] = [];
  const used = await db.prepare("SELECT count(*) AS n FROM publications WHERE day = ?").bind(dayOf(new Date())).first<number>("n");
  let remaining = Math.max(0, 5 - (used ?? 0));
  for (const source of sources) {
    const previous = await db.prepare("SELECT version FROM cursors WHERE product = ?").bind(source.product).first<string>("version");
    if (previous === null) {
      const latest = await source.latest();
      if (!latest) throw new Error(`Missing initial release: ${source.product}`);
      plans.push({ product: source.product, previous, cursor: latest.version });
      continue;
    }
    let cursor = previous;
    for (const release of await source.since(previous)) {
      const known = await db.prepare("SELECT status FROM publications WHERE product = ? AND version = ?").bind(source.product, release.version).first<string>("status");
      if (known === "pending") throw new Error(`Pending publication: ${source.product} ${release.version}`);
      if (known === "posted" || !isNotable(release.notes)) { cursor = release.version; continue; }
      if (remaining === 0) break;
      plans.push({ product: source.product, previous, cursor, release, text: await draftChinesePost(release) });
      remaining--;
      break;
    }
    if (!plans.some(plan => plan.product === source.product)) plans.push({ product: source.product, previous, cursor });
  }
  if (preview) { console.log(JSON.stringify({ mode: "preview", plans })); return; }

  for (const plan of plans) {
    if (await pending(db)) throw new Error("Another run has a pending publication; reconcile before retry");
    if (!plan.release) {
      if (plan.previous === null) {
        await db.prepare("INSERT INTO cursors (product, version) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(plan.product, plan.cursor).run();
      } else {
        await db.prepare("UPDATE cursors SET version = ? WHERE product = ? AND version = ?").bind(plan.cursor, plan.product, plan.previous).run();
      }
      continue;
    }
    const { release, text } = plan;
    const reservedAt = new Date();
    const day = dayOf(reservedAt);
    // A single SQL statement arbitrates duplicates, concurrent runs and the daily cap.
    const reservation = await db.prepare(`INSERT INTO publications (product, version, status, text, reserved_at, day)
      SELECT ?, ?, 'pending', ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM publications WHERE status = 'pending')
        AND (SELECT count(*) FROM publications WHERE day = ?) < 5
        AND EXISTS (SELECT 1 FROM cursors WHERE product = ? AND version = ?)
      ON CONFLICT (product, version) DO NOTHING`)
      .bind(plan.product, release.version, text!, reservedAt.toISOString(), day, day, plan.product, plan.previous).run();
    if (reservation.meta.changes !== 1) {
      if (await pending(db)) throw new Error("Concurrent pending publication; reconcile before retry");
      console.log(`[deferred] ${plan.product} ${release.version}: already claimed, changed cursor or daily limit`);
      return;
    }
    if (dayOf(new Date()) !== day) throw new Error("Daily boundary crossed after reservation; reconcile before retry");
    // Never retry automatically. Any exception, including lost DB acknowledgement,
    // leaves either a durable pending record or an already completed record.
    const tweetId = await postTweet(text!);
    if (!/^\d+$/.test(tweetId)) throw new Error("X returned no valid tweet ID; outcome unknown");
    await db.batch([
      db.prepare("UPDATE publications SET status = 'posted', tweet_id = ?, posted_at = ? WHERE product = ? AND version = ? AND status = 'pending'")
        .bind(tweetId, new Date().toISOString(), plan.product, release.version),
      db.prepare("UPDATE cursors SET version = ? WHERE product = ? AND version = ?")
        .bind(release.version, plan.product, plan.previous),
    ]);
    console.log(`[posted] ${plan.product} ${release.version}: ${tweetId}`);
  }
}

export default {
  async scheduled(event, env) { event.noRetry(); await run(env); },
} satisfies ExportedHandler<Env>;
