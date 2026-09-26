import type { Release } from "./sources/types.ts";
import { versionBumpKind } from "./versions.ts";

/** Select narrative changes, respecting release-note sections and bullet prefixes. */
const EXCLUDED_HEADING = /^(?:bug\s*fix(?:es)?|fix(?:ed|es)?|contributors|documentation)\b/i;
const FIX_PREFIX = /^(?:fix(?:ed|es)?|bug\s*fix(?:es)?|修复)\b/i;
const META_BULLET = /^(?:full changelog|changelog:|#\d+\b|\[?#\d+\]?\()/i;
/** Regression phrasing from real Grok notes. Do not treat every "no longer" or "unexpectedly" as a bugfix. */
const REGRESSION = /\bno longer\s+(?:jumps?|fail(?:s|ed|ing)?|crash(?:es|ed|ing)?|hangs?|freez(?:e|es|ed|ing))\b|不再意外跳动/i;
/** Dependency / CI / internal chores that should not become radar posts. */
const CHORE_BULLET =
  /^(?:chore|deps?|bump|ci|build|internal|refactor|style|docs?(?:umentation)?)\b|^(?:chore|deps?|bump|ci|build|docs?)[:\s]|^(?:bump|update[sd]?)\s+(?:dependencies|dependency|deps|lockfile|ci)\b|依赖升级|内部重构|文档(?:更新|修正)/i;
const FLUFF_BULLET =
  /^(?:minor|small|various|misc(?:ellaneous)?)\b|改进可靠性|小幅(?:优化|改进)|miscellaneous\b|maintenance\b/i;

function featureProse(bullet: string): string {
  const withoutTag = bullet.replace(/^(?:\[[^\]]+\]\s*)+/, "");
  // Keep fix:/fixed: so prefix semantics survive; only strip unrelated labels like Windows:
  return withoutTag.replace(/^(?!(?:fix(?:ed|es)?|bug\s*fix(?:es)?|修复)\b)[A-Za-z]+:\s*/i, "");
}

function isFixBullet(bullet: string): boolean {
  const prose = featureProse(bullet);
  return FIX_PREFIX.test(prose) || /^修复/.test(prose) || REGRESSION.test(prose);
}

export function pickBullets(notes: string, max = 3): string[] {
  const features: string[] = [];
  let excludedDepth: number | null = null;
  for (const raw of notes.split("\n")) {
    const heading = raw.match(/^(#{1,6})\s+(.+)/);
    if (heading) {
      const level = heading[1]!.length;
      const title = heading[2]!.trim();
      if (excludedDepth !== null && level > excludedDepth) continue;
      excludedDepth = EXCLUDED_HEADING.test(title) ? level : null;
      continue;
    }
    if (excludedDepth !== null || !/^\s*(?:[-*]|\d+\.)\s+/.test(raw)) continue;
    const bullet = raw.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
    if (!bullet || isFixBullet(bullet) || META_BULLET.test(featureProse(bullet))) continue;
    features.push(bullet);
  }
  return features.slice(0, max);
}

export function isNotable(notes: string): boolean {
  if (!notes.trim()) throw new Error("Empty release notes: cannot decide whether to skip");
  if (!/^\s*(?:[-*]|\d+\.)\s+/m.test(notes)) throw new Error("No structured release changes: review before skipping");
  return pickBullets(notes, 1).length > 0;
}

/** True when every picked feature bullet is chore/fluff (or none remain). */
export function isEmptyChore(notes: string): boolean {
  const bullets = pickBullets(notes, 10);
  if (!bullets.length) return true;
  return bullets.every((bullet) => {
    const prose = featureProse(bullet);
    return CHORE_BULLET.test(prose) || FLUFF_BULLET.test(prose);
  });
}

/**
 * Patch-level posts need a stronger signal than "any Added line".
 * Major/minor use isNotable + !isEmptyChore instead.
 */
export function isClearlyValuable(notes: string): boolean {
  if (!isNotable(notes) || isEmptyChore(notes)) return false;
  const bullets = pickBullets(notes, 5);
  if (bullets.length >= 2) return true;
  const prose = featureProse(bullets[0]!).replace(/`[^`]+`/g, "CODE");
  if (prose.length >= 48) return true;
  return (
    /\b(?:add(?:ed|s)?|introduc(?:e|ed|es)|new\b|support for|enable[sd]?)\b|新增|支持|引入/i.test(prose) &&
    prose.length >= 28
  );
}

/** Merge consecutive patch releases into one tip release for a single radar post. */
export function coalescePatchReleases(releases: Release[]): Release {
  if (!releases.length) throw new Error("Cannot coalesce an empty release list");
  const tip = releases[releases.length - 1]!;
  if (releases.length === 1) return tip;
  const first = releases[0]!;
  const range = `${first.displayVersion}→${tip.displayVersion}`;
  return {
    ...tip,
    displayVersion: range,
    title: `${tip.title} (${range})`,
    notes: releases.map((r) => `## ${r.displayVersion}\n${r.notes.trim()}`).join("\n\n"),
  };
}

export type RadarSelection = {
  /** Releases safe to advance the cursor past without posting. */
  skip: Release[];
  /** At most one post candidate (may be a coalesced patch tip). */
  candidate: Release | null;
};

/**
 * De-noise the oldest-first walk for one product:
 * - skip fix-only / empty-chore
 * - major/minor (or unknown shapes) post when notable and not chore
 * - consecutive patches bundle into one tip post when 2+; a lone patch posts only if clearly valuable
 * - prefer a major/minor in the same window over flushing a prior patch bundle
 */
export function selectRadarCandidate(releases: Release[], previousVersion: string | null): RadarSelection {
  const skip: Release[] = [];
  const patchBuffer: Release[] = [];
  let prior = previousVersion;
  let candidate: Release | null = null;

  const absorbPatches = () => {
    skip.push(...patchBuffer);
    patchBuffer.length = 0;
  };

  for (const release of releases) {
    const notable = isNotable(release.notes);
    if (!notable || isEmptyChore(release.notes)) {
      absorbPatches();
      skip.push(release);
      prior = release.version;
      continue;
    }

    const bump = versionBumpKind(release.version, prior);
    prior = release.version;

    if (bump === "patch") {
      patchBuffer.push(release);
      continue;
    }

    // Major / minor / unknown: one postable release wins this run.
    absorbPatches();
    candidate = release;
    break;
  }

  if (!candidate) {
    if (patchBuffer.length >= 2) {
      candidate = coalescePatchReleases(patchBuffer);
    } else if (patchBuffer.length === 1 && isClearlyValuable(patchBuffer[0]!.notes)) {
      candidate = patchBuffer[0]!;
    } else {
      absorbPatches();
    }
  }

  return { skip, candidate };
}
