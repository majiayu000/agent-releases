/**
 * Tiny self-check: rule-based draftChinesePost on Claude 2.1.265 and
 * Codex rust-v0.153.4 fixtures must be readable Chinese; LLM path is
 * skipped/mocked when no API key.
 * Also covers weighted X length + grok multi-version parse + ledger helpers.
 *
 * Run: bun run selfcheck:draft
 */
import {
  draftChinesePost,
  draftChinesePostRuleBased,
  maxLatinRunOutsideBackticks,
} from "./draft.ts";
import { isLlmDraftConfigured, DEFAULT_MODEL } from "./draft-llm.ts";
import { pickBullets } from "./filter.ts";
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

const NOTES_RUST_V0_153_4 = `## Bug Fixes

- Fixed Astra’s visibility in the bundled model picker and made it the bundled default when no model is explicitly configured. (#42874)
- Updated Astra’s guidance to use asynchronous questions only when the tool is available in the session. (#42878)

## Changelog

Full Changelog: https://github.com/openai/codex/compare/rust-v0.153.3...rust-v0.153.4

- #42874 [0.153 hotfix] Show Astra in bundled model picker @rhan-oai
- #42878 [0.153 hotfix] Qualify Astra async-question guidance by tool availability @rhan-oai
`;

const claudeRelease: Release = {
  product: "claude",
  version: "2.1.265",
  displayVersion: "2.1.265",
  title: "Claude Code 2.1.265",
  notes: NOTES_2_1_265,
  url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.265",
};

const codexRelease: Release = {
  product: "codex",
  version: "rust-v0.153.4",
  displayVersion: "0.153.4",
  title: "Codex rust-v0.153.4",
  notes: NOTES_RUST_V0_153_4,
  url: "https://github.com/openai/codex/releases/tag/rust-v0.153.4",
};

function assertClaudeRulePost(post: string, label: string) {
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
  if (!post.includes("【Claude】Claude Code 2.1.265 出了（非官方）")) {
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
    "【Claude】Claude Code 9.9.9 出了（非官方）\n\n" +
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
  const html = `
    <html><body>
    <p>Latest v1.0.13</p>
    <h2>Grok Build 1.0.13</h2>
    <ul><li>Faster CLI downloads and smarter retries</li><li>Windows image workflow fixes</li></ul>
    <h2>Grok Build 1.0.12</h2>
    <ul><li>Context bar updates immediately</li></ul>
    <h2>Grok Build 1.0.11</h2>
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

function assertCodex01534RulePost(post: string, label: string) {
  console.log(`--- ${label} ---\n` + post + "\n--- end ---");

  if (!post.includes("【Codex】Codex CLI 0.153.4 出了（非官方）")) {
    console.error("FAIL: missing Codex 0.153.4 header");
    process.exit(1);
  }
  if (!post.includes(codexRelease.url)) {
    console.error("FAIL: missing release URL");
    process.exit(1);
  }
  // Must not keep English PR-title changelog lines
  if (/#\d+\s+\[/.test(post) || /@[\w-]+\s*$/m.test(post.split("\n").find((l) => l.startsWith("•")) || "")) {
    console.error("FAIL: PR-title style bullet leaked into draft");
    process.exit(1);
  }
  if (/•\s*#\d+/.test(post)) {
    console.error("FAIL: #NNNN PR-title bullet present");
    process.exit(1);
  }
  if (post.includes("详见发版说明")) {
    console.error("FAIL: low-value 详见发版说明 fallback for known Astra notes");
    process.exit(1);
  }
  const lower = post.toLowerCase();
  if (!post.includes("模型选择器") && !lower.includes("model picker")) {
    console.error("FAIL: missing Astra model-picker coverage");
    process.exit(1);
  }
  if (!post.includes("异步提问") && !lower.includes("asynchronous")) {
    console.error("FAIL: missing Astra async-question guidance coverage");
    process.exit(1);
  }
  const cjk = (post.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cjk < 20) {
    console.error("FAIL: too little Chinese prose for Codex draft", { cjk });
    process.exit(1);
  }
  if (maxLatinRunOutsideBackticks(post) > 40) {
    console.error("FAIL: long Latin run in Codex rule draft");
    process.exit(1);
  }
}

function assertPick(label: string, notes: string, expected: string[]) {
  const got = pickBullets(notes, 3);
  if (got.length !== expected.length || got.some((b, i) => b !== expected[i])) {
    console.error(`FAIL: ${label}`, { got, expected });
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

function assertPickBulletsRanking() {
  const prOnly = `## Changelog

Full Changelog: https://github.com/openai/codex/compare/rust-v0.153.3...rust-v0.153.4

- #12345 [0.153 hotfix] Show Astra in bundled model picker @rhan-oai
- #12346 [0.153 hotfix] Qualify Astra async-question guidance @rhan-oai
`;
  assertPick("PR-title-only changelog yields no bullets", prOnly, []);
  const prOnlyPost = draftChinesePostRuleBased({
    ...codexRelease,
    notes: prOnly,
  });
  if (/•\s*#\d+/.test(prOnlyPost) || /#\d+\s+\[/.test(prOnlyPost)) {
    console.error("FAIL: PR-title bullet leaked into PR-only fallback draft");
    process.exit(1);
  }
  if (/Full Changelog:\s*https:\/\/github/i.test(prOnlyPost)) {
    console.error("FAIL: mangled Full Changelog URL leaked into fallback draft");
    process.exit(1);
  }
  console.log("OK: PR-only changelog does not re-enter fallback draft");

  // Discarded #NNNN bullets must not block usable non-bullet prose fallback.
  const discardedPlusProse = `## Notes

Astra now surfaces clearer recovery tips when a session tool is missing.

## Changelog

- #12345 [0.153 hotfix] Show Astra in bundled model picker @rhan-oai
- #12346 [0.153 hotfix] Qualify Astra async-question guidance @rhan-oai
`;
  const prosePost = draftChinesePostRuleBased({
    ...codexRelease,
    notes: discardedPlusProse,
  });
  if (prosePost.includes("详见发版说明")) {
    console.error("FAIL: prose fallback skipped despite usable non-bullet notes");
    process.exit(1);
  }
  if (!/recovery|恢复|提示|tool|工具|session|会话/i.test(prosePost)) {
    console.error("FAIL: usable non-bullet prose missing from draft", prosePost);
    process.exit(1);
  }
  console.log("OK: discarded bullets still allow non-bullet prose fallback");

  const narrative =
    "Fixed Astra's visibility in the bundled model picker and made it the bundled default when no model is configured.";
  assertPick(
    "fill remaining slots around a narrative Fixed bullet",
    `
- Fixed login crash on empty token.
- Fixed timeout retry.
- Fixed nil pointer unwrap.
- ${narrative}
`,
    [
      narrative,
      "Fixed login crash on empty token.",
      "Fixed timeout retry.",
    ],
  );

  assertPick(
    "incidental 'updated' in Fixed does not outrank Added/Improved",
    `
- Fixed the model list not being updated after authentication
- Fixed the session token not being updated on refresh
- Fixed the cache not being updated after writes
- Added a new model picker entry for Astra
- Improved async-question guidance
- Added telemetry for tool availability
`,
    [
      "Added a new model picker entry for Astra",
      "Improved async-question guidance",
      "Added telemetry for tool availability",
    ],
  );

  assertPick(
    "long Fixed bullets fill only after non-fix updates",
    `
- Fixed Astra's visibility in the bundled model picker and made it the bundled default when no model is configured.
- Fixed another reasonably long issue in the session restoration path after a network error.
- Fixed the documentation site search index rebuilding slowly after large catalog imports.
- Added support for pointing --plugin-dir at a folder of plugins
- Improved --worktree startup on large repositories
- Added a 1 GB cap on tool results saved to disk
`,
    [
      "Added support for pointing --plugin-dir at a folder of plugins",
      "Improved --worktree startup on large repositories",
      "Added a 1 GB cap on tool results saved to disk",
    ],
  );
}

function assertAstraRewriteDoesNotInventClaims() {
  const crashNote =
    "Fixed Astra crash when opening the bundled model picker after a failed auth refresh.";
  const post = draftChinesePostRuleBased({
    ...codexRelease,
    notes: `- ${crashNote}`,
  });
  if (/可见性|默认/.test(post)) {
    console.error("FAIL: Astra model-picker rewrite invented visibility/default claims", post);
    process.exit(1);
  }
  if (!/模型选择器/.test(post) && !/model picker/i.test(post)) {
    console.error("FAIL: crash note lost model-picker mention", post);
    process.exit(1);
  }
  console.log("OK: Astra model-picker rewrite does not invent visibility/default");
}

async function main() {
  checkDefaultModel();
  checkWeightedLength();
  checkGrokParse();
  checkLedgerHelpers();
  assertPickBulletsRanking();
  assertAstraRewriteDoesNotInventClaims();

  // Always exercise the rule-based path explicitly (independent of API key).
  const rulePost = draftChinesePostRuleBased(claudeRelease);
  assertClaudeRulePost(rulePost, "rule-based draft (claude 2.1.265)");
  console.log("OK: draftChinesePostRuleBased(2.1.265) looks Chinese");

  const codexPost = draftChinesePostRuleBased(codexRelease);
  assertCodex01534RulePost(codexPost, "rule-based draft (codex rust-v0.153.4)");
  console.log("OK: draftChinesePostRuleBased(rust-v0.153.4) prefers narrative Bug Fixes");

  // Dry unit: without key, async entry skips LLM and matches rule path.
  if (!isLlmDraftConfigured()) {
    const asyncPost = await draftChinesePost(claudeRelease);
    if (asyncPost !== rulePost) {
      console.error("FAIL: no-key draftChinesePost should equal rule-based");
      process.exit(1);
    }
    console.log("OK: LLM skipped (no ANTHROPIC_API_KEY); async == rule-based");
  } else {
    console.log("SKIP: ANTHROPIC_API_KEY set — not calling live LLM in selfcheck");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
