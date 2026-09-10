/** Live generation check for all three sources. Never calls X or changes publication state. */
import { draftModelId } from "./draft-llm.ts";
import { draftChinesePost } from "./draft.ts";
import { fetchLatestClaude } from "./sources/claude.ts";
import { fetchLatestCodex } from "./sources/codex.ts";
import { fetchLatestGrokBuild } from "./sources/grok-build.ts";

console.log(`smoke-llm model=${draftModelId()}`);
for (const fetchLatest of [fetchLatestClaude, fetchLatestCodex, fetchLatestGrokBuild]) {
  const t0 = Date.now();
  try {
    const release = await fetchLatest();
    if (!release) throw new Error("Source returned no release");
    const text = await draftChinesePost(release);
    console.log(`SMOKE_OK product=${release.product} version=${release.version} ms=${Date.now() - t0}`);
    console.log(text);
  } catch (error) {
    console.error(`SMOKE_FAIL source=${fetchLatest.name} ms=${Date.now() - t0} err=${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
