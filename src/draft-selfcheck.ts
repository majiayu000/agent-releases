import { strict as assert } from "node:assert";
import { validateChinesePost, normalizeBulletEmoji } from "./draft.ts";
import { weightedXLength, X_WEIGHTED_LIMIT } from "./x-length.ts";
import { parseVersionBlocks } from "./sources/grok-build.ts";
import { postHeader } from "./sources/types.ts";
import type { Release } from "./sources/types.ts";

const release: Release = {
  product: "claude",
  version: "2.1.267",
  displayVersion: "2.1.267",
  title: "Claude Code 2.1.267",
  notes: "- Added `maxEffortLevel` setting",
  url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.267",
};

const good = `${postHeader(release)}\n\n🔧 新增 \`maxEffortLevel\` 设置，可按模型限制努力等级上限\n\n${release.url}`;
const post = validateChinesePost(good, release);
assert.ok(weightedXLength(post) <= X_WEIGHTED_LIMIT);
assert.ok(post.startsWith("🟣🚀 【Claude】"));
assert.equal(weightedXLength("a".repeat(10)), 10);
assert.equal(weightedXLength("中".repeat(10)), 20);
assert.equal(weightedXLength("hello https://example.com/path?x=1 world"), 35);

assert.throws(() =>
  validateChinesePost(
    `${postHeader(release)}\n\n🔧 新增 \`maxEffortLevel\` setting (top-level or per model under \`modelSettings\`): caps the effort level…\n\n${release.url}`,
    release,
  ),
);
assert.throws(() =>
  validateChinesePost(`${postHeader(release)}\n\n🔧 更新「详见发版说明」\n\n${release.url}`, release),
);
assert.throws(() =>
  validateChinesePost(
    `${postHeader(release)}\n\n• 新增 \`maxEffortLevel\` 设置，可按模型限制努力等级上限\n\n${release.url}`,
    release,
  ),
);


assert.equal(
  normalizeBulletEmoji("🔧 🛠️ 新增 `claude plugin eval`，可对插件评测并输出报告。"),
  "🔧 新增 `claude plugin eval`，可对插件评测并输出报告。",
);
const doubled = validateChinesePost(
  `${postHeader(release)}\n\n🔧 🛠️ 新增 \`maxEffortLevel\` 设置，可按模型限制努力等级上限\n\n${release.url}`,
  release,
);
assert.ok(doubled.includes("🔧 新增"));
assert.ok(!doubled.includes("🛠️"));

const blocks = parseVersionBlocks(`<p>Latest <span>v<!-- -->1.0.13</span></p>
<h2>Grok Build <!-- -->1.0.13</h2><ul><li>Faster CLI downloads and smarter retries</li></ul>
<h2>Grok Build <!-- -->1.0.12</h2><ul><li>Context bar updates immediately</li></ul>
<h2>Grok Build <!-- -->1.0.11</h2><ul><li>Smarter resume browsing</li></ul>`);
assert.deepEqual(
  blocks.map((block) => block.version),
  ["1.0.13", "1.0.12", "1.0.11"],
);
console.log("OK: single-emoji bullets, double-emoji collapse, hollow/• rejection, X length and Grok parse");
