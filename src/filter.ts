/** Select narrative changes, respecting release-note sections and bullet prefixes. */
const EXCLUDED_HEADING = /^(?:bug\s*fix(?:es)?|fix(?:ed|es)?|contributors|documentation)\b/i;
const FIX_PREFIX = /^(?:fix(?:ed|es)?|bug\s*fix(?:es)?|修复)\b/i;
const META_BULLET = /^(?:full changelog|changelog:|#\d+\b|\[?#\d+\]?\()/i;
/** Regression phrasing from real Grok notes. Do not treat every "no longer" as a bugfix. */
const REGRESSION = /\bunexpectedly\b|\bno longer\s+(?:jumps?|fail(?:s|ed|ing)?|crash(?:es|ed|ing)?|hangs?|freez(?:e|es|ed|ing))\b|不再意外跳动|意外跳动/i;

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
