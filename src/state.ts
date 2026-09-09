import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Product } from "./sources/types.ts";
import { STATE_FILE } from "./sources/types.ts";
import { LEDGER_PATH } from "./ledger.ts";

export function readState(product: Product): string | null {
  const path = STATE_FILE[product];
  if (!existsSync(path)) return null;
  const v = readFileSync(path, "utf8").trim();
  return v || null;
}

export function writeState(product: Product, version: string): void {
  const path = STATE_FILE[product];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, version + "\n", "utf8");
}

export function listChangedStateFiles(): string[] {
  return [...Object.values(STATE_FILE), LEDGER_PATH];
}
