/** Select narrative changes, respecting release-note sections and bullet prefixes. */
export function pickBullets(notes: string, max = 3): string[] {
  const features: string[] = [];
  let excludedSection = false;
  for (const raw of notes.split("\n")) {
    const heading = raw.match(/^#{1,6}\s+(.+)/);
    if (heading) {
      excludedSection = /^(?:bug\s*fix(?:es)?|fix(?:ed|es)?|changelog|contributors|documentation)\b/i.test(heading[1]!);
      continue;
    }
    if (excludedSection || !/^\s*(?:[-*]|\d+\.)\s+/.test(raw)) continue;
    const bullet = raw.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim();
    const prose = bullet.replace(/^(?:\[[^\]]+\]|[A-Za-z]+:)\s*/, "");
    if (/^(?:fix(?:ed|es)?|bug\s*fix(?:es)?|修复)\b/i.test(prose) || /^修复/.test(prose)) continue;
    if (/^(?:full changelog|changelog:|#\d+\b|\[?#\d+\]?\()/i.test(prose)) continue;
    if (bullet.length > 8) features.push(bullet);
  }
  return features.slice(0, max);
}

export function isNotable(notes: string): boolean {
  if (!notes.trim()) throw new Error("Empty release notes: cannot decide whether to skip");
  if (!/^\s*(?:[-*]|\d+\.)\s+/m.test(notes)) throw new Error("No structured release changes: review before skipping");
  return pickBullets(notes, 1).length > 0;
}
