import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  articleToNotes,
  compareChangelogIds,
  parseCodexAppEntries,
} from "./sources/codex-app.ts";
import { isNotable, pickBullets, selectRadarCandidate } from "./filter.ts";
import { postHeader, TWEET_VERSION_KEY } from "./sources/types.ts";
import type { Release } from "./sources/types.ts";

const fixture = readFileSync("tests/fixtures/codex-changelog-app-sample.html", "utf8");

const appRelease = (version: string, displayVersion: string, notes = "- Added tiny tweak"): Release => ({
  product: "codex_app", version, displayVersion, title: "Codex app",
  notes, url: `https://developers.openai.com/codex/changelog#${version}`,
});

describe("codex app radar", () => {
  test("month-boundary slugs coalesce by build and keep the tip slug", () => {
    const releases = [
      appRelease("codex-2026-09-28-app", "26.928"),
      appRelease("codex-2026-09-29-app", "26.929"),
      appRelease("codex-2026-10-01-app", "26.1001"),
    ];
    const result = selectRadarCandidate(releases, "codex-2026-09-27-app");
    expect(result.skip).toEqual([]);
    expect(result.candidate?.version).toBe(releases[2]!.version);
    expect(result.candidate?.displayVersion).toBe("26.928→26.1001");
    for (const release of releases) expect(result.candidate?.notes).toContain(`## ${release.displayVersion}`);
    expect(result.candidate?.url).toBe(releases[2]!.url);
  });

  test("a lone thin build is skipped even when its cursor is a date slug", () => {
    const release = appRelease("codex-2026-10-01-app", "26.1001");
    expect(selectRadarCandidate([release], "codex-2026-09-30-app")).toEqual({ skip: [release], candidate: null });
  });

  test("same-day app and browser ids with builds coalesce", () => {
    for (const build of ["26.909", "26.908"]) {
      const releases = [
        appRelease("codex-2026-09-11-app", "26.908"),
        appRelease("codex-2026-09-11-browser", build),
      ];
      const result = selectRadarCandidate(releases, "codex-2026-09-10-app");
      expect(result.skip).toEqual([]);
      expect(result.candidate?.version).toBe(releases[1]!.version);
      expect(result.candidate?.displayVersion).toBe(`26.908→${build}`);
    }
  });

  test("equal date-only ids cannot discard a preceding patch buffer", () => {
    const releases = [
      appRelease("codex-2026-09-10-app", "26.908"),
      appRelease("codex-2026-09-11-app", "26.909"),
      appRelease("codex-2026-09-11-browser", "2026-09-11"),
    ];
    const result = selectRadarCandidate(releases, "codex-2026-09-09-app");
    expect(result.skip).toEqual([]);
    expect(result.candidate?.displayVersion).toBe("26.908→2026-09-11");
    expect(result.candidate?.notes).toContain("## 26.908");
  });

  test("skipped build notes still establish the next build comparison", () => {
    const skipped = appRelease("codex-2026-09-30-app", "26.930", "- Fixed a crash");
    const thin = appRelease("codex-2026-10-01-app", "26.1001");
    expect(selectRadarCandidate([skipped, thin], "codex-2026-09-29-app")).toEqual({ skip: [skipped, thin], candidate: null });
  });

  test("date-only announcements and build-major changes remain postable", () => {
    const announcement = parseCodexAppEntries(fixture)[1]!;
    expect(selectRadarCandidate([announcement], "codex-2026-08-24-app").candidate).toBe(announcement);
    const patch = appRelease("codex-2026-12-31-app", "26.1231");
    const major = appRelease("codex-2027-01-01-app", "27.101");
    expect(selectRadarCandidate([patch, major], "codex-2026-12-30-app")).toEqual({ skip: [patch], candidate: major });
  });

  test("skipped date-only notes preserve the last build for a major transition", () => {
    const patch = appRelease("codex-2026-12-30-app", "26.1230");
    const major = appRelease("codex-2027-01-01-app", "27.101");
    for (const notes of ["- Fixed a crash", "- chore: bump dependencies"]) {
      const dateOnly = appRelease("codex-2026-12-31-app", "2026-12-31", notes);
      expect(selectRadarCandidate([patch, dateOnly, major], "codex-2026-12-29-app")).toEqual({
        skip: [patch, dateOnly], candidate: major,
      });
    }
  });
});

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
