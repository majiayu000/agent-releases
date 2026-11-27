import { describe, expect, test } from "bun:test";
import {
  coalescePatchReleases, hasHeadlineChange, hasUserFacingChange, isUserFacingBullet,
  patchBufferState, PATCH_HOLD_MAX, selectRadarCandidate,
} from "./filter.ts";
import type { Product, Release } from "./sources/types.ts";

const r = (product: Product, version: string, notes: string, displayVersion = version): Release => ({
  product, version, displayVersion, title: version, notes, url: `https://example.com/${product}/${version}`,
});

// Shapes taken from real Grok Build 1.0.47–1.0.50 notes: dense, but daily UX tweaks.
const GROK_UX = [
  "- A model switch from the agent updates the displayed model list and context window",
  "- /rewind lists only prompts you typed, and skips automatic runtime turns",
  "- Clicking the git branch in the header copies the full branch name",
].join("\n");
// Real Claude Code shapes: env vars, gateway/admin knobs, OTel, mod author APIs.
const CLAUDE_PLUMBING = [
  "- Added `CLAUDE_CODE_SUBAGENT_EFFORT` to set the effort level subagents run at when nothing else names one",
  "- Added pooled group budgets to the Claude apps gateway: one monthly budget that a group's members share",
  "- Added the `claude_code.safety_event` OpenTelemetry event for each tool call a permission rule stopped",
  "- Added `$.ui.selection()` for mods: returns the text you last selected in fullscreen mode",
  "- Fixed `/effort` settings not applying when the model name differed by letter case",
].join("\n");
const CLAUDE_COMMAND = [
  "- Added `/claude-api api-version` to move Claude API code to API version `2026-10-21`",
  "- Fixed requests failing with a model-not-found error when the model is an alias",
].join("\n");

describe("user-facing gate", () => {
  test.each([
    ["Added `/claude-api api-version` to move Claude API code to API version `2026-10-21`", true],
    ["Added `--marketplace <source>` to `claude plugin install`: adds the marketplace if needed", true],
    ["Added support for MCP tasks in the terminal: long tool calls move to the background", true],
    ["Added idle compaction to VS Code and Claude Desktop's Code tab", true],
    ["Added `CLAUDE_CODE_DISABLE_ULTRATHINK`, which turns the `ultrathink` keyword off", false],
    ["Added `permissions.blockWritesOutsideWorkingDirectories`: Write refuses outside paths", false],
    ["Added `oidc.user_id_claim` to the Claude apps gateway", false],
    ["Added a `dir` prop on a mod's `Text` for right-to-left text", false],
    ["Added tiny tweak", false],
    ["Fixed `/resume` losing turns", false],
  ] as const)("%s → %p", (bullet, expected) => {
    expect(isUserFacingBullet(bullet)).toBe(expected);
  });

  test("headline detection covers models, GA and betas but not passing mentions", () => {
    expect(hasHeadlineChange("- Added Claude Haiku 5.5 (`claude-haiku-5-5`), now the default Haiku model")).toBe(true);
    expect(hasHeadlineChange("- New Grok 5 model available in /model")).toBe(true);
    expect(hasHeadlineChange("- Plugins are now generally available")).toBe(true);
    expect(hasHeadlineChange(GROK_UX)).toBe(false);
    expect(hasHeadlineChange("- The effort level stays the same after a bare /model switch, instead of jumping to the new model default")).toBe(false);
  });

  test("plumbing-only Claude notes have no user-facing change", () => {
    expect(hasUserFacingChange(CLAUDE_PLUMBING)).toBe(false);
    expect(hasUserFacingChange(CLAUDE_COMMAND)).toBe(true);
  });
});

describe("radar selection policy", () => {
  test("Grok Build patch bundles of UX tweaks are skipped", () => {
    const run = ["1.0.47", "1.0.48", "1.0.49", "1.0.50"].map(v => r("grok_build", v, GROK_UX));
    expect(selectRadarCandidate(run, "1.0.46")).toEqual({ skip: run, candidate: null });
  });

  test("Grok Build posts a headline patch and any minor bump", () => {
    const headline = r("grok_build", "1.0.51", "- New Grok 5 model available in /model\n" + GROK_UX);
    expect(selectRadarCandidate([headline], "1.0.50").candidate).toEqual(headline);
    const minor = r("grok_build", "1.1.0", GROK_UX);
    expect(selectRadarCandidate([minor], "1.0.99")).toEqual({ skip: [], candidate: minor });
  });

  test("Claude patches with only plumbing are skipped, even as a bundle", () => {
    const run = ["2.1.316", "2.1.317"].map(v => r("claude", v, CLAUDE_PLUMBING));
    expect(selectRadarCandidate(run, "2.1.315")).toEqual({ skip: run, candidate: null });
    const thin = ["1.0.1", "1.0.2"].map(v => r("claude", v, "- Added tiny tweak"));
    expect(selectRadarCandidate(thin, "1.0.0")).toEqual({ skip: thin, candidate: null });
  });

  test("a Claude patch with a new command posts", () => {
    const patch = r("claude", "2.1.307", CLAUDE_COMMAND);
    expect(selectRadarCandidate([patch], "2.1.306")).toEqual({ skip: [], candidate: patch });
  });

  test("plumbing patches still bundle behind a user-facing one", () => {
    const run = [r("claude", "2.1.316", CLAUDE_PLUMBING), r("claude", "2.1.317", CLAUDE_COMMAND)];
    expect(selectRadarCandidate(run, "2.1.315").candidate).toEqual(coalescePatchReleases(run));
  });

  test("Codex App date-only announcements stay postable", () => {
    const note = r("codex_app", "codex-2026-08-25-browser", "- Use website tools: Website tools work across desktop and mobile.", "2026-08-25");
    expect(selectRadarCandidate([note], "codex-2026-08-24-app").candidate).toEqual(note);
  });
});

describe("cooldown hold", () => {
  const hold = { holdPatches: true };

  test("worthy patches are held without moving the cursor, then merge after cooldown", () => {
    const first = r("claude", "2.1.307", CLAUDE_COMMAND);
    expect(selectRadarCandidate([first], "2.1.306", new Set(), hold)).toEqual({ skip: [], candidate: null });
    const fix = r("claude", "2.1.308", "- Fixed a terminal crash");
    const second = r("claude", "2.1.309", CLAUDE_COMMAND);
    // Fix-only releases ride along inside a held run instead of advancing past it.
    expect(selectRadarCandidate([first, fix, second], "2.1.306", new Set(), hold)).toEqual({ skip: [], candidate: null });
    // After cooldown a held run without interruptions posts as one bundle.
    expect(selectRadarCandidate([first, second], "2.1.306", new Set(), hold)).toEqual({ skip: [], candidate: null });
    expect(selectRadarCandidate([first, second], "2.1.306").candidate).toEqual(coalescePatchReleases([first, second]));
  });

  test.each(["claude", "codex"] as const)("a %s GA announcement posts without addition wording", product => {
    const ga = r(product, "1.0.1", "- Plugins are now generally available");
    expect(selectRadarCandidate([ga], "1.0.0", new Set(), hold)).toEqual({ skip: [], candidate: ga });
  });

  test("a posted release does not advance past an earlier held patch", () => {
    const patch = r("claude", "1.0.1", "- Added support for custom commands and terminal sessions");
    const posted = r("claude", "1.0.2", CLAUDE_COMMAND);
    const seen = new Set([posted.version]);
    expect(selectRadarCandidate([patch, posted], "1.0.0", seen, hold)).toEqual({ skip: [], candidate: null });
    expect(selectRadarCandidate([patch, posted], "1.0.0", seen)).toEqual({ skip: [], candidate: patch });
  });

  test("headline patches and long held runs post during cooldown", () => {
    const model = r("claude", "2.1.321", "- Added Claude Fable 5.2 (`claude-fable-5-2`), now the default Fable model");
    expect(selectRadarCandidate([model], "2.1.320", new Set(), hold).candidate).toEqual(model);
    const run = Array.from({ length: PATCH_HOLD_MAX }, (_, i) => r("claude", `2.1.${400 + i}`, CLAUDE_COMMAND));
    expect(patchBufferState(run.slice(0, -1), hold)).toBe("hold");
    expect(selectRadarCandidate(run, "2.1.399", new Set(), hold).candidate).toEqual(coalescePatchReleases(run));
  });

  test.each([
    "- Introduced OpenTelemetry support for enterprise admins",
    "- Introduced a new event for mods",
    "- Added `settings.mode`, now generally available",
  ])("does not publish excluded content as a headline: %s", notes => {
    const patch = r("claude", "1.0.1", notes);
    expect(selectRadarCandidate([patch], "1.0.0", new Set(), hold)).toEqual({ skip: [patch], candidate: null });
  });

  test("one cooldown bundle contains at most eight patches", () => {
    const run = Array.from({ length: PATCH_HOLD_MAX + 1 }, (_, i) =>
      r("claude", `2.1.${400 + i}`, CLAUDE_COMMAND));
    expect(selectRadarCandidate(run, "2.1.399", new Set(), hold)).toEqual({
      skip: [],
      candidate: coalescePatchReleases(run.slice(0, PATCH_HOLD_MAX)),
    });
  });

  test("Codex App keeps its pre-cooldown rule for incremental builds", () => {
    const note = r("codex_app", "app-26.909",
      "- Added support for managing longer terminal sessions in the desktop app", "26.909");
    expect(selectRadarCandidate([note], "26.908", new Set(), hold)).toEqual({ skip: [], candidate: note });
  });

  test("non-worthy patches are still skipped during cooldown", () => {
    const run = ["2.1.316", "2.1.317"].map(v => r("claude", v, CLAUDE_PLUMBING));
    expect(selectRadarCandidate(run, "2.1.315", new Set(), hold)).toEqual({ skip: run, candidate: null });
  });

  test("a minor bump is not held and wins over a held run", () => {
    const patch = r("codex", "rust-v0.170.1", CLAUDE_COMMAND);
    const minor = r("codex", "rust-v0.171.0", "- Added `/rc` and `/remote` to manage remote control from the TUI");
    expect(selectRadarCandidate([patch, minor], "rust-v0.170.0", new Set(), hold)).toEqual({ skip: [patch], candidate: minor });
  });
});
