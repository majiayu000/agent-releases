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
  /** Durable reservation: no tweetId means the outcome needs reconciliation. */
  runId?: string;
  text?: string;
};

export function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) throw new Error("Missing posted.jsonl: restore publication history before running");
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(LEDGER_PATH, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as LedgerEntry);
    } catch {
      throw new Error("Invalid posted.jsonl: refusing to publish with unreadable history");
    }
  }
  for (const entry of out) {
    if (!entry || !["claude", "codex", "grok_build"].includes(entry.product) ||
        typeof entry.version !== "string" || !entry.version ||
        typeof entry.dryRun !== "boolean" || typeof entry.ts !== "string" || !Number.isFinite(Date.parse(entry.ts)) ||
        (entry.tweetId !== undefined && (typeof entry.tweetId !== "string" || !/^\d+$/.test(entry.tweetId)))) {
      throw new Error("Invalid posted.jsonl entry: refusing to publish");
    }
  }
  return out;
}

export function pendingPosts(): LedgerEntry[] {
  const latest = new Map<string, LedgerEntry>();
  for (const entry of readLedger()) {
    if (!entry.dryRun) latest.set(`${entry.product}:${entry.version}`, entry);
  }
  return [...latest.values()].filter((entry) => !entry.tweetId);
}

export function postingDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
}

export function dailyPostCount(now: Date): number {
  const keys = new Set<string>();
  for (const entry of readLedger()) {
    if (!entry.dryRun && postingDay(new Date(entry.ts)) === postingDay(now)) {
      keys.add(`${entry.product}:${entry.version}`);
    }
  }
  return keys.size;
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
