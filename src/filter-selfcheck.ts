/**
 * Regression self-check for isNotable Fixed-only filtering.
 *
 * Guards against treating "## What's changed" / incidental "change" in Fixed
 * notes (e.g. Claude Code 2.1.266) as feature hints.
 *
 * Run: bun run selfcheck:filter
 */
import { isNotable } from "./filter.ts";

/** Real Anthropic Claude Code v2.1.266 release body (Fixed-only). */
const NOTES_2_1_266 = `## What's changed

- Fixed a 2.1.265 regression affecting LLM-gateway and proxy setups: the undocumented \`CLAUDE_CODE_USE_GATEWAY\` environment variable, previously ignored unless \`ANTHROPIC_BASE_URL\` and \`ANTHROPIC_AUTH_TOKEN\` were both set, began forcing Cloud-gateway sign-in on its own in 2.1.265, so configurations that set it alongside an API key, \`apiKeyHelper\`, or custom auth headers failed every request with "Not signed in to the Cloud gateway". The variable on its own is ignored again; no configuration change is needed
`;

/** Minimal Fixed-only fixture that still contains the incidental "change" phrase. */
const FIXED_ONLY_WITH_CHANGE_PHRASE = `## What's changed

- Fixed a gateway regression; no configuration change is needed
`;

function assertFalse(actual: boolean, label: string) {
  if (actual !== false) {
    console.error(`FAIL: ${label}: expected isNotable===false, got ${actual}`);
    process.exit(1);
  }
  console.log(`OK: ${label} → isNotable===false`);
}

function main() {
  assertFalse(isNotable(NOTES_2_1_266), "Claude Code 2.1.266 real Fixed notes");
  assertFalse(
    isNotable(FIXED_ONLY_WITH_CHANGE_PHRASE),
    'Fixed-only + "no configuration change is needed"',
  );
  console.log("OK: filter selfcheck passed");
}

main();
