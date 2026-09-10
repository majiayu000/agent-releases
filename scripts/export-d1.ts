/** Run from a checkout with a freshly restored publication-state/.state snapshot. */
import { readLedger, pendingPosts, postingDay } from "../src/ledger.ts";
import { readState } from "../src/state.ts";

if (pendingPosts().length) throw new Error("Reconcile pending X outcomes before switching publishers");
const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const statements: string[] = [];
for (const product of ["claude", "codex", "grok_build"] as const) {
  const version = readState(product);
  if (!version) throw new Error(`Missing cursor: ${product}`);
  statements.push(`INSERT INTO cursors (product, version) VALUES (${quote(product)}, ${quote(version)});`);
}
// Retain one confirmed success per product/version, including deleted posts.
const posted = new Map<string, ReturnType<typeof readLedger>[number]>();
for (const entry of readLedger()) if (!entry.dryRun && entry.tweetId) posted.set(`${entry.product}:${entry.version}`, entry);
for (const entry of posted.values()) {
  const values = [entry.product, entry.version, "posted", entry.text ?? "", entry.tweetId!, entry.ts, postingDay(new Date(entry.ts)), entry.ts];
  statements.push(`INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day,posted_at) VALUES (${values.map(quote).join(",")});`);
}
console.log(statements.join("\n"));
