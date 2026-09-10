import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { Product } from "./sources/types.ts";
import { STATE_FILE } from "./sources/types.ts";

export function readState(product: Product): string | null {
  const path = STATE_FILE[product];
  if (!existsSync(path)) return null;
  const v = readFileSync(path, "utf8").trim();
  if (!v) throw new Error(`Empty state file: ${path}`);
  return v;
}

export function writeState(product: Product, version: string): void {
  const path = STATE_FILE[product];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, version + "\n", "utf8");
}
