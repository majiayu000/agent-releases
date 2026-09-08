export type Product = "claude" | "codex" | "grok_build";

export type Release = {
  product: Product;
  /** Tag used for state / de-dupe, e.g. 2.1.261 or rust-v0.153.0 or 1.0.13 */
  version: string;
  /** Human version shown in tweet */
  displayVersion: string;
  title: string;
  notes: string;
  url: string;
};

export const PRODUCT_TAG: Record<Product, string> = {
  claude: "【Claude】",
  codex: "【Codex】",
  grok_build: "【Grok Build】",
};

export const PRODUCT_NAME: Record<Product, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  grok_build: "Grok Build",
};

export const STATE_FILE: Record<Product, string> = {
  claude: ".state/last_posted_claude.txt",
  codex: ".state/last_posted_codex.txt",
  grok_build: ".state/last_posted_grok_build.txt",
};
