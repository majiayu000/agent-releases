/**
 * One-shot LLM smoke using the same path as live drafting.
 * Logs only status/latency/block meta + whether Chinese text looks usable.
 * Never prints API keys.
 */
import { draftChinesePostWithLlm, isLlmDraftConfigured, draftModelId } from "./draft-llm.ts";
import type { Release } from "./sources/types.ts";

if (!isLlmDraftConfigured()) {
  console.error("NO_KEY: ANTHROPIC_API_KEY missing");
  process.exit(2);
}

const release: Release = {
  product: "claude",
  version: "2.1.267",
  displayVersion: "2.1.267",
  title: "Claude Code 2.1.267",
  notes: `## What's changed
- Added \`maxEffortLevel\` setting (top-level or per model under \`modelSettings\`): caps the effort level on every provider, including Bedrock, Vertex and Foundry; users can still pick a lower level
- Added \`--system-prompt-snapshot off\` to render the system prompt fresh on every request instead of reusing the conversation's recorded prompt (for iterating on prompt text)
- Improved the \`/diff\` panel: it no longer flashes "0 files changed" and a spinner before settling, and its empty state is centered in the panel
`,
  url: "https://github.com/anthropics/claude-code/releases/tag/v2.1.267",
};

console.log(`smoke-llm model=${draftModelId()} base=${process.env.ANTHROPIC_BASE_URL || "(default)"}`);
const t0 = Date.now();
try {
  const text = await draftChinesePostWithLlm(release);
  const ms = Date.now() - t0;
  const hasHeader = text.includes("【Claude】Claude Code 2.1.267 发布");
  const hasUrl = text.includes(release.url);
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  console.log(`SMOKE_OK ms=${ms} chars=${text.length} cjk=${cjk} header=${hasHeader} url=${hasUrl}`);
  console.log("--- draft ---");
  console.log(text);
  console.log("--- end ---");
} catch (e) {
  const ms = Date.now() - t0;
  console.error(`SMOKE_FAIL ms=${ms} err=${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
