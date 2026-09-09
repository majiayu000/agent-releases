/**
 * Tiny self-check: draftChinesePost on 2.1.265 fixture must be readable Chinese
 * (no leftover English fragments like "to the telemetry" / "pointing").
 *
 * Run: bun run src/draft-selfcheck.ts
 */
import { draftChinesePost } from "./draft.ts";
import type { Release } from "./sources/types.ts";

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

const post = draftChinesePost(release);
console.log("--- draft ---\n" + post + "\n--- end ---");

const forbidden = ["to the telemetry", "pointing", "matching terminal", "folder of plugins", "saved to disk"];
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
// Should not be mostly Latin letters
const latin = (post.match(/[A-Za-z]/g) || []).length;
const cjk = (post.match(/[\u4e00-\u9fff]/g) || []).length;
if (cjk < 20) {
  console.error("FAIL: too little Chinese prose", { cjk, latin });
  process.exit(1);
}
console.log("OK: draftChinesePost(2.1.265) looks Chinese");
