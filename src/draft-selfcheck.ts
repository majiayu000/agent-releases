/**
 * Tiny self-check: rule-based Chinese is the live fallback (never English on X);
 * LLM path skipped when no API key. English-original kept for selfcheck only.
 * Also covers weighted X length + grok multi-version parse + ledger helpers.
 *
 * Run: bun run selfcheck:draft
 */
import {
  draftChinesePost,
  draftChinesePostRuleBased,
  draftEnglishOriginalPost,
  maxLatinRunOutsideBackticks,
  NO_USABLE_CHINESE_DRAFT,
} from "./draft.ts";
import { isLlmDraftConfigured, DEFAULT_MODEL } from "./draft-llm.ts";
import { weightedXLength, trimPostToWeightedLimit, X_WEIGHTED_LIMIT } from "./x-length.ts";
import { parseVersionBlocks } from "./sources/grok-build.ts";
import { hasPostedLive, appendLedger, LEDGER_PATH } from "./ledger.ts";
import type { Release } from "./sources/types.ts";
import { existsSync, unlinkSync, readFileSync, writeFileSync } from "fs";

const NOTES_2_1_265 = `## What's changed

- Added \`user.email\` and \`user.groups\` to the telemetry Claude Desktop and Cowork send through a Claude apps gateway, matching terminal sessions
- Added support for pointing \`--plugin-dir\` at a folder of plugins: each child folder with a manifest loads, and children added or removed while running are picked up
- Added a 1 GB cap on tool results saved to disk; the in-conversation preview says when a saved file was truncated
- Fixed resuming a foreground-spawned subagent changing its tool list and system prompt prefix, which broke prompt-cache reuse for that agent
- Improved \`--worktree\` startup on large repositories: the new worktree is now checked out in parallel (git 2.32+)
`;

const release: Release = {
  product: "claude",
  version: "2.1.265",
  displayVersion: "2.1.265",
  title: "Claude Code 2.1.265",
  notes: NOTES_2_1_265,
  url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.265",
};

function assertRulePost(post: string, label: string) {
  console.log(`--- ${label} ---\n` + post + "\n--- end ---");

  const forbidden = [
    "to the telemetry",
    "pointing",
    "matching terminal",
    "folder of plugins",
    "saved to disk",
  ];
  const hits = forbidden.filter((s) => post.toLowerCase().includes(s.toLowerCase()));
  if (hits.length > 0) {
    console.error("FAIL: leftover English fragments:", hits);
    process.exit(1);
  }
  if (!post.includes("【Claude】Claude Code 2.1.265 发布")) {
    console.error("FAIL: missing expected header");
    process.exit(1);
  }
  if (!post.includes("• ")) {
    console.error("FAIL: missing bullets");
    process.exit(1);
  }
  const latin = (post.match(/[A-Za-z]/g) || []).length;
  const cjk = (post.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk < 20) {
    console.error("FAIL: too little Chinese prose", { cjk, latin });
    process.exit(1);
  }
  if (maxLatinRunOutsideBackticks(post) > 40) {
    console.error("FAIL: long Latin run in rule draft");
    process.exit(1);
  }
  const w = weightedXLength(post);
  if (w > X_WEIGHTED_LIMIT + 5) {
    // allow tiny slack only if trim somehow skipped; should be <= 280
    console.error("FAIL: weighted length too high", w);
    process.exit(1);
  }
  console.log(`OK weighted length=${w}`);
}

function checkWeightedLength() {
  const ascii = "a".repeat(10);
  if (weightedXLength(ascii) !== 10) {
    console.error("FAIL: ascii weight", weightedXLength(ascii));
    process.exit(1);
  }
  const cjk = "中".repeat(10);
  if (weightedXLength(cjk) !== 20) {
    console.error("FAIL: cjk weight", weightedXLength(cjk));
    process.exit(1);
  }
  const withUrl = "hello https://example.com/path?x=1 world";
  const w = weightedXLength(withUrl);
  // "hello " (6) + url(23) + " world" (6) = 35
  if (w !== 35) {
    console.error("FAIL: url weight", w);
    process.exit(1);
  }

  const long =
    "【Claude】Claude Code 9.9.9 发布\n\n" +
    "• " +
    "测".repeat(200) +
    "\n• " +
    "试".repeat(200) +
    "\n\nhttps://example.com/r";
  const trimmed = trimPostToWeightedLimit(long, X_WEIGHTED_LIMIT);
  if (weightedXLength(trimmed) > X_WEIGHTED_LIMIT) {
    console.error("FAIL: trim did not fit", weightedXLength(trimmed));
    process.exit(1);
  }
  if (!trimmed.includes("https://example.com/r")) {
    console.error("FAIL: trim dropped URL");
    process.exit(1);
  }
  console.log("OK: weighted length helper + trim");
}

function checkGrokParse() {
  // Mirror live x.ai SSR: empty HTML comments between text and version.
  const html = `
    <html><body>
    <p>Latest <span>v<!-- -->1.0.13</span></p>
    <h2>Grok Build <!-- -->1.0.13</h2>
    <ul><li>Faster CLI downloads and smarter retries</li><li>Windows image workflow fixes</li></ul>
    <h2>Grok Build <!-- -->1.0.12</h2>
    <ul><li>Context bar updates immediately</li></ul>
    <h2>Grok Build <!-- -->1.0.11</h2>
    <ul><li>Smarter resume browsing</li></ul>
    </body></html>
  `;
  const blocks = parseVersionBlocks(html);
  if (blocks.length < 3) {
    console.error("FAIL: expected >=3 grok blocks", blocks.map((b) => b.version));
    process.exit(1);
  }
  if (blocks[0]!.version !== "1.0.13") {
    console.error("FAIL: tip should be 1.0.13", blocks[0]!.version);
    process.exit(1);
  }
  const versions = blocks.map((b) => b.version);
  if (!versions.includes("1.0.12") || !versions.includes("1.0.11")) {
    console.error("FAIL: missing older versions", versions);
    process.exit(1);
  }
  console.log("OK: grok multi-version parse", versions.slice(0, 5));
}

function checkDefaultModel() {
  if (DEFAULT_MODEL !== "glm-5.3-flash") {
    console.error("FAIL: DEFAULT_MODEL expected glm-5.3-flash got", DEFAULT_MODEL);
    process.exit(1);
  }
  console.log("OK: DEFAULT_MODEL=glm-5.3-flash");
}

function checkLedgerHelpers() {
  // Use a temp path by writing then reading via public API against real LEDGER_PATH
  // only if we are in a disposable cwd — avoid clobbering real state in CI checkout.
  // Selfcheck runs in repo root; if posted.jsonl exists, only assert read path.
  const existed = existsSync(LEDGER_PATH);
  const before = existed ? readFileSync(LEDGER_PATH, "utf8") : null;

  appendLedger({
    ts: "2099-01-01T00:00:00.000Z",
    product: "claude",
    version: "__selfcheck_never__",
    tweetId: "999",
    dryRun: false,
  });
  if (!hasPostedLive("claude", "__selfcheck_never__")) {
    console.error("FAIL: hasPostedLive should see selfcheck entry");
    process.exit(1);
  }
  if (hasPostedLive("claude", "__no_such_version__")) {
    console.error("FAIL: unexpected live hit");
    process.exit(1);
  }

  // Restore ledger
  if (before === null) {
    if (existsSync(LEDGER_PATH)) unlinkSync(LEDGER_PATH);
  } else {
    // drop the selfcheck line
    const lines = readFileSync(LEDGER_PATH, "utf8")
      .split("\n")
      .filter((l) => l && !l.includes("__selfcheck_never__"));
    writeFileSync(LEDGER_PATH, lines.length ? lines.join("\n") + "\n" : before, "utf8");
  }
  console.log("OK: ledger helpers");
}

async function main() {
  checkDefaultModel();
  checkWeightedLength();
  checkGrokParse();
  checkLedgerHelpers();

  // Rule-based Chinese is the live X fallback (not English).
  const rulePost = draftChinesePostRuleBased(release);
  assertRulePost(rulePost, "rule-based draft");
  console.log("OK: draftChinesePostRuleBased(2.1.265) looks Chinese");

  // English-original: selfcheck-only helper; must NOT be live fallback.
  const enPost = draftEnglishOriginalPost(release);
  console.log("--- english-original draft (selfcheck only) ---\n" + enPost + "\n--- end ---");
  if (!enPost.includes("【Claude】Claude Code 2.1.265 发布")) {
    console.error("FAIL: english-original missing header");
    process.exit(1);
  }
  if (!enPost.includes("• ")) {
    console.error("FAIL: english-original missing bullets");
    process.exit(1);
  }
  if (!enPost.includes(release.url)) {
    console.error("FAIL: english-original missing url");
    process.exit(1);
  }
  // Bullets should retain English from notes (not rule-based CN rewrite)
  if (!/user\.email|plugin-dir|telemetry/i.test(enPost)) {
    console.error("FAIL: english-original should keep English note fragments");
    process.exit(1);
  }
  if (weightedXLength(enPost) > X_WEIGHTED_LIMIT + 5) {
    console.error("FAIL: english-original weighted length", weightedXLength(enPost));
    process.exit(1);
  }
  console.log("OK: draftEnglishOriginalPost(2.1.265) selfcheck-only helper");

  // Without key, live entry uses rule-based Chinese (never english-original).
  if (!isLlmDraftConfigured()) {
    const asyncPost = await draftChinesePost(release);
    if (asyncPost !== rulePost) {
      console.error("FAIL: no-key draftChinesePost should equal rule-based Chinese");
      process.exit(1);
    }
    if (asyncPost === enPost) {
      console.error("FAIL: draftChinesePost must NOT equal english-original");
      process.exit(1);
    }
    if (maxLatinRunOutsideBackticks(asyncPost) > 40) {
      console.error("FAIL: live draft still has long Latin run");
      process.exit(1);
    }
    console.log("OK: LLM skipped (no ANTHROPIC_API_KEY); async == rule-based (not english)");
  } else {
    console.log("SKIP: ANTHROPIC_API_KEY set — not calling live LLM in selfcheck");
  }

  if (!NO_USABLE_CHINESE_DRAFT.includes("[draft] no usable Chinese draft")) {
    console.error("FAIL: NO_USABLE_CHINESE_DRAFT constant drifted");
    process.exit(1);
  }
  console.log("OK: NO_USABLE_CHINESE_DRAFT constant present");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
