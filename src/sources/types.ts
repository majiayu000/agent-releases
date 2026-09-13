export type Product = "claude" | "codex" | "codex_app" | "grok_build";

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
  codex_app: "【Codex App】",
  grok_build: "【Grok Build】",
};

/** Stable product color mark for multi-product timeline scanning. */
export const PRODUCT_EMOJI: Record<Product, string> = {
  claude: "🟣",
  codex: "🟢",
  codex_app: "🩵",
  grok_build: "⚫",
};

const PRODUCT_TAG_ALT = Object.values(PRODUCT_TAG)
  .map(tag => tag.slice(1, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Matches the live tweet heading, including 【Grok Build】, two-part app builds like 26.908, and date-only App posts. */
export const TWEET_VERSION_KEY = new RegExp(
  `【(${PRODUCT_TAG_ALT})】` + String.raw`[\s\S]*?(\d+\.\d+(?:\.\d+)?|\d{4}-\d{2}-\d{2}|rust-v[\d.]+|codex-\d{4}-\d{2}-\d{2}[\w-]*)`,
);

export const PRODUCT_NAME: Record<Product, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  codex_app: "Codex App",
  grok_build: "Grok Build",
};

export const STATE_FILE: Record<Product, string> = {
  claude: ".state/last_posted_claude.txt",
  codex: ".state/last_posted_codex.txt",
  codex_app: ".state/last_posted_codex_app.txt",
  grok_build: ".state/last_posted_grok_build.txt",
};

/** Live X heading: product emoji + rocket + tag + name + version + 发布. */
export function postHeader(release: Release): string {
  return `${PRODUCT_EMOJI[release.product]}🚀 ${PRODUCT_TAG[release.product]}${PRODUCT_NAME[release.product]} ${release.displayVersion} 发布`;
}
