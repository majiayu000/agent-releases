import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  articleToNotes,
  compareChangelogIds,
  parseCodexAppEntries,
} from "./sources/codex-app.ts";
import { isNotable, pickBullets } from "./filter.ts";
import { postHeader, TWEET_VERSION_KEY } from "./sources/types.ts";

const fixture = readFileSync("tests/fixtures/codex-changelog-app-sample.html", "utf8");

describe("codex app changelog", () => {
  test("parses only topics that include codex-app", () => {
    const entries = parseCodexAppEntries(fixture);
    expect(entries.map((e) => e.version)).toEqual([
      "codex-2026-09-11-app",
      "codex-2026-08-25-browser",
    ]);
    expect(entries[0]!.displayVersion).toBe("26.908");
    expect(entries[0]!.url).toContain("#codex-2026-09-11-app");
  });

  test("feature notes are notable; bug-fix bullets excluded from picks", () => {
    const entry = parseCodexAppEntries(fixture)[0]!;
    expect(isNotable(entry.notes)).toBe(true);
    const picks = pickBullets(entry.notes, 5);
    expect(picks.some((p) => /Chat while you work/i.test(p))).toBe(true);
    expect(picks.some((p) => /crash when opening Pets/i.test(p))).toBe(false);
  });

  test("compareChangelogIds orders by full id", () => {
    expect(compareChangelogIds("codex-2026-08-25-browser", "codex-2026-09-11-app")).toBeLessThan(0);
    expect(compareChangelogIds("codex-2026-09-11-app", "codex-2026-08-13-app")).toBeGreaterThan(0);
  });

  test("header + version key accept two-part app builds", () => {
    const release = parseCodexAppEntries(fixture)[0]!;
    const header = postHeader(release);
    expect(header).toContain("【Codex App】");
    expect(header).toContain("26.908");
    const m = header.match(TWEET_VERSION_KEY);
    expect(m?.[1]).toBe("Codex App");
    expect(m?.[2]).toBe("26.908");
  });

  test("articleToNotes falls back for unstructured article", () => {
    const notes = articleToNotes("<p>Only a paragraph about a new panel.</p><p>Second change arrives later.</p>");
    expect(notes.split("\n")).toEqual([
      "- Only a paragraph about a new panel.",
      "- Second change arrives later.",
    ]);
  });

  test("date-only displayVersion matches tweet version key", () => {
    const entry = parseCodexAppEntries(fixture).find((e) => e.version === "codex-2026-08-25-browser")!;
    expect(entry.displayVersion).toBe("2026-08-25");
    const header = postHeader(entry);
    const m = header.match(TWEET_VERSION_KEY);
    expect(m?.[1]).toBe("Codex App");
    expect(m?.[2]).toBe("2026-08-25");
  });
});
