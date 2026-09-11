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

/** Stable product color mark for multi-product timeline scanning. */
export const PRODUCT_EMOJI: Record<Product, string> = {
  claude: "🟣",
  codex: "🟢",
  grok_build: "⚫",
};

const PRODUCT_TAG_ALT = Object.values(PRODUCT_TAG)
  .map(tag => tag.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Matches the live tweet heading, including 【Grok Build】. */
export const TWEET_VERSION_KEY = new RegExp(`【(${PRODUCT_TAG_ALT})】[\\s\\S]*?(\\d+\\.\\d+\\.\\d+|rust-v[\\d.]+)`);

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

/** Live X heading: product emoji + rocket + tag + name + version + 发布. */
export function postHeader(release: Release): string {
  return `${PRODUCT_EMOJI[release.product]}🚀 ${PRODUCT_TAG[release.product]}${PRODUCT_NAME[release.product]} ${release.displayVersion} 发布`;
}
