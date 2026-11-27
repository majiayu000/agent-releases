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
  /^(?:chore|refactor)\b|^(?:deps?|bump|ci|build|internal|style|docs?(?:umentation)?)(?:\([^)]+\))?!?:|^(?:bump|update[sd]?)\s+(?:(?:dependencies|dependency|deps|lockfile|ci)\b|@?[\w.-]+\/[\w.-]+\s+from\s+v?\d+(?:\.\S+)?\s+to\s+v?\d+(?:\.\S+)?(?=\s|[.!]?$)|[\w.-]+\s+from\s+v?\d+\.\d+\.\S+\s+to\s+v?\d+\.\d+\.\S+)|^(?:docs?|documentation|ci)\s+(?:updates?|improvements?)[.!]?$|^internal\s+(?:improvements?|changes?)[.!]?$|依赖升级|内部重构|文档(?:更新|修正)/i;
const FLUFF_BULLET =
  /^(?:minor|small|various|misc(?:ellaneous)?)(?:(?:\([^)]+\))?!?:|\s+(?:bug\s+)?fix(?:es)?\b|\s+improvements?[.!]?$)|改进可靠性|小幅(?:优化|改进)|miscellaneous\b|maintenance\b/i;

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
    const bullet = raw.replace(/^\s*(?:[-*]|\d+\.)\s+(?:-\s+)?/, "").trim();
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
  // Classification must consider every change, independent of display limits.
  const bullets = pickBullets(notes, Number.POSITIVE_INFINITY);
  if (!bullets.length) return true;
  return bullets.every((bullet) => {
    const labeled = bullet.replace(/^(?:\[[^\]]+\]\s*)+/, "");
    const prose = featureProse(bullet);
    return CHORE_BULLET.test(labeled) || FLUFF_BULLET.test(labeled) ||
      CHORE_BULLET.test(prose) || FLUFF_BULLET.test(prose);
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

/**
 * A change a reader can try today: a new slash command, CLI subcommand or flag, mode, model,
 * plugin/skill surface, or editor/desktop integration. Config knobs (env vars, dotted
 * settings keys) and admin/plumbing (gateway, telemetry, managed policy, SDK) do not count.
 */
const ADDITION = /^(?:add(?:ed|s)?\b|new\b|introduc\w*|now\s+(?:supports?|available)\b|support(?:s|ed)?\s+for\b|enabled?\b|launch\w*|新增|支持|引入|推出|上线)/i;
const USER_SURFACE = new RegExp([
  String.raw`(?:^|[\s\`(“"])\/[a-z][\w:-]*`, // slash command
  String.raw`\`(?:claude|codex|grok)\s+[a-z][\w-]*`, // CLI subcommand
  String.raw`(?:^|[\s\`])--[a-z][\w-]+`, // CLI flag
  String.raw`\bsupport for\b`,
  String.raw`\b(?:mode|command|shortcut|keybinding|plugin|marketplace|skill|subagent|model|panel|picker|theme)s?\b`,
  String.raw`\b(?:in|to) (?:the terminal|VS Code|JetBrains|Claude Desktop|the desktop app|fullscreen)\b`,
  "斜杠命令|命令|模式|插件|快捷键|模型",
].join("|"), "i");
/** Plugin/mod author APIs: useful to extension authors, not something most readers will try. */
const AUTHOR_API = /\bfor mods\b|\ba mod's\b|\bmods installed\b|\bhook events?\b|\bevent of plugin hooks\b/i;
const ADMIN_ONLY = /\b(?:gateway|OpenTelemetry|OTel|telemetry|managed settings|managed polic(?:y|ies)|organization policy|admins?|administrators?|enterprise|proxy|certificates?|SDK|spend limits?|IdP)\b/i;
const CONFIG_KNOB_LEAD = /^(?:[Aa]dd(?:ed|s)?\s+)?(?:the\s+|an?\s+)?(?:optional\s+)?`(?:[A-Z][A-Z0-9_]{4,}|[\w$]+(?:\.[\w$()]+)+)`/;
/** Headline-grade news. Grok Build daily patches post only when one of these appears. */
const HEADLINE = /\b(?:introduc(?:e|ed|es|ing)|generally available|now available|public beta|research preview|plugin marketplace)\b|^(?:new|add(?:ed|s)?)\s+(?:[\w.-]+\s+){0,3}models?\b|\bnow the default\b[^.;]{0,40}\bmodel\b|正式发布|公测/i;

function isReaderFacing(prose: string): boolean {
  return !ADMIN_ONLY.test(prose) && !AUTHOR_API.test(prose) && !CONFIG_KNOB_LEAD.test(prose);
}

export function isUserFacingBullet(bullet: string): boolean {
  const prose = featureProse(bullet);
  return ADDITION.test(prose) && USER_SURFACE.test(prose) && isReaderFacing(prose);
}

function featureBullets(notes: string): string[] {
  return pickBullets(notes, Number.POSITIVE_INFINITY).filter((bullet) => {
    const labeled = bullet.replace(/^(?:\[[^\]]+\]\s*)+/, "");
    const prose = featureProse(bullet);
    return !(CHORE_BULLET.test(labeled) || FLUFF_BULLET.test(labeled) || CHORE_BULLET.test(prose) || FLUFF_BULLET.test(prose));
  });
}

/** True when the notes contain at least one change a reader can see or use. */
export function hasUserFacingChange(notes: string): boolean {
  return featureBullets(notes).some(isUserFacingBullet);
}

/** True when the notes carry headline-grade news (new model, GA, beta, marketplace). */
export function hasHeadlineChange(notes: string): boolean {
  return featureBullets(notes).some((bullet) => {
    const prose = featureProse(bullet);
    return HEADLINE.test(prose) && isReaderFacing(prose);
  });
}

/**
 * Patch-level gate per product. Grok Build ships near-daily patch builds of small UX
 * tweaks, so it needs headline news; Claude Code / Codex CLI need one user-facing change.
 */
export function isPatchWorthy(release: Release): boolean {
  if (release.product === "grok_build") return hasHeadlineChange(release.notes);
  // Codex App entries are titled prose announcements (e.g. "Quick chats 26.908"), not
  // Added/Fixed lists, and post rarely; keep the existing bundle/clearly-valuable rule.
  if (release.product === "codex_app") return true;
  return hasUserFacingChange(release.notes);
}

/** Hours after a product's last radar post during which small patches are held and merged. */
export const PATCH_COOLDOWN_HOURS = 48;
/** A held run never grows past this many releases before it posts (if worthy) or is skipped. */
export const PATCH_HOLD_MAX = 8;

export type PatchBufferState = "post" | "hold" | "skip";
export type RadarOptions = {
  /** True while the product is inside PATCH_COOLDOWN_HOURS of its last radar post. */
  holdPatches?: boolean;
};

/**
 * - skip: nothing a reader would notice; advance the cursor past it
 * - post: headline news; or (outside cooldown) a 2+ bundle / clearly valuable lone patch
 * - hold: worthy but small and inside cooldown; keep the cursor before it so later
 *   patches merge into one post once cooldown ends (or PATCH_HOLD_MAX releases pile up)
 */
export function patchBufferState(buffer: Release[], options: RadarOptions = {}): PatchBufferState {
  if (!buffer.length) return "skip";
  if (buffer[0]!.product !== "codex_app") {
    if (buffer.some(r => hasHeadlineChange(r.notes))) return "post";
    if (!buffer.some(isPatchWorthy)) return "skip";
    if (options.holdPatches) return buffer.length >= PATCH_HOLD_MAX ? "post" : "hold";
  }
  return buffer.length >= 2 || isClearlyValuable(buffer[0]!.notes) ? "post" : "skip";
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
    coveredVersions: releases.map(r => r.version),
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
 * - patches need a user-facing change (Grok Build: headline news) or they are skipped.
 *   Headline patches post at once. Otherwise 2+ bundle into one tip post and a lone patch must
 *   be clearly valuable; inside the product's cooldown they are held (cursor stays put) and merge
 *   with later patches instead of posting
 * - prefer a major/minor in the same window over flushing a prior patch bundle
 */
export function selectRadarCandidate(
  releases: Release[],
  previousVersion: string | null,
  posted = new Set<string>(),
  options: RadarOptions = {},
): RadarSelection {
  const skip: Release[] = [];
  const patchBuffer: Release[] = [];
  let prior = previousVersion;
  let priorAppBuild = releases[0]?.previousAppBuild ??
    (previousVersion && /^\d+\.\d+$/.test(previousVersion) ? previousVersion : null);
  let candidate: Release | null = null;

  const absorbPatches = () => {
    skip.push(...patchBuffer);
    patchBuffer.length = 0;
  };

  for (const release of releases) {
    if (options.holdPatches && patchBuffer.length === PATCH_HOLD_MAX && patchBuffer[0]!.product !== "codex_app") {
      // Flush at eight, or clear an entirely unworthy buffer before reading more releases.
      if (patchBufferState(patchBuffer, options) === "post") break;
      absorbPatches();
    }
    if (posted.has(release.version)) {
      // A posted release separates patch bundles but still supplies the next
      // release's predecessor. Keep an earlier buffer that is postable or still held.
      if (patchBufferState(patchBuffer, options) !== "skip") break;
      absorbPatches();
      skip.push(release);
      prior = release.version;
      if (release.product === "codex_app" && /^\d+\.\d+$/.test(release.displayVersion)) priorAppBuild = release.displayVersion;
      continue;
    }
    const notable = isNotable(release.notes);
    const appBuild = release.product === "codex_app" && /^\d+\.\d+$/.test(release.displayVersion)
      ? release.displayVersion : null;
    // App cursors are date slugs; the feed supplies their prior build. With none, apply
    // the two-part build patch policy instead of inferring a date-based bump.
    const bump = appBuild
      ? priorAppBuild ? versionBumpKind(appBuild, priorAppBuild) : "patch"
      : versionBumpKind(release.version, prior);
    if (appBuild) priorAppBuild = appBuild;
    prior = release.version;
    if (!notable || isEmptyChore(release.notes)) {
      const state = patchBufferState(patchBuffer, options);
      // Flush a postable buffer below; leave the interrupting release for the next run.
      if (state === "post") break;
      // A held run cannot let the cursor pass it, so the fix-only release rides along.
      if (state === "hold") {
        patchBuffer.push(release);
        continue;
      }
      absorbPatches();
      skip.push(release);
      continue;
    }

    // Distinct same-day App ids (or equal builds) are not major/minor wins.
    if (bump === "patch" || (release.product === "codex_app" && bump === "unknown")) {
      patchBuffer.push(release);
      continue;
    }

    // Major / minor / unknown: one postable release wins this run.
    absorbPatches();
    candidate = release;
    break;
  }

  if (!candidate) {
    const state = patchBufferState(patchBuffer, options);
    if (state === "post") {
      candidate = coalescePatchReleases(patchBuffer);
    } else if (state === "skip") {
      absorbPatches();
    }
    // hold: neither skipped nor posted; the next run re-reads these releases.
  }

  return { skip, candidate };
}
