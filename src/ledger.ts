/**
 * Append-only post ledger (.state/posted.jsonl).
 * Commit step must include .state/ (including this ledger) so de-dupe survives across runs.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname } from "path";
import type { Product } from "./sources/types.ts";

export const LEDGER_PATH = ".state/posted.jsonl";

export type LedgerEntry = {
  ts: string;
  product: Product;
  version: string;
  tweetId?: string;
  issueUrl?: string;
  dryRun: boolean;
};

export function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerEntry);
    } catch {
      console.warn("[ledger] skip bad line");
    }
  }
  return out;
}

/** Live (non-dryRun) entry with a tweetId for this product+version. */
export function hasPostedLive(product: Product, version: string): boolean {
  return readLedger().some(
    (e) =>
      e.product === product &&
      e.version === version &&
      Boolean(e.tweetId) &&
      e.dryRun === false,
  );
}

export function appendLedger(entry: LedgerEntry): void {
  mkdirSync(dirname(LEDGER_PATH), { recursive: true });
  appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n", "utf8");
}
