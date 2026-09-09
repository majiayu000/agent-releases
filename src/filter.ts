/** Strip Anthropic-style boilerplate that looks like feature language but isn't. */
function stripBoilerplate(notes: string): string {
  return notes
    .replace(/^#+\s*what'?s\s+changed\s*$/gim, "")
    .replace(/^#+\s*what\s+has\s+changed\s*$/gim, "")
    .trim();
}

/** Returns true if notes look feature-worthy (not Fixed-only). */
export function isNotable(notes: string): boolean {
  const text = stripBoilerplate(notes || "");

  // Word hints: do NOT include bare "change(d)" — it matches "What's changed"
  // and incidental phrases like "no configuration change is needed" in Fixed notes.
  const featureHints =
    /\b(added|add|new feature|new features|improved|improve|removed|remove|introduc|support for|supports)\b/i.test(
      text,
    ) ||
    /新增|支持|改进|优化|变更|移除|推出/.test(text) ||
    /^[-*]\s*(added|changed|improved|removed)\b/im.test(text) ||
    // Keep a Changelog section titles only (## Changed), not "## What's changed"
    /^#{1,3}\s*(new features|features|added|changed|improved|removed)\s*$/im.test(text);

  const onlyBugfix =
    /bug fixes? and reliability improvements/i.test(text.trim()) ||
    (/^\s*[-*]\s*(fixed|fix|bug)\b/im.test(text) &&
      !featureHints &&
      text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*")).length <= 3 &&
      !/\b(added|improved|removed)\b/i.test(text) &&
      !/^[-*]\s*changed\b/im.test(text));

  if (onlyBugfix) return false;
  if (featureHints) return true;

  // Heuristic: many bullet lines that aren't all "Fixed"
  const bullets = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*]/.test(l) || /^\d+\./.test(l));
  if (bullets.length === 0) return false;
  const fixedOnly = bullets.every((b) => /^[-*]\s*fix(ed)?\b/i.test(b) || /bug fix/i.test(b));
  return !fixedOnly && bullets.length > 0;
}

/** Drop changelog noise: compare URLs, section labels, GitHub PR-title lines. */
export function isDiscardedChangelogLine(text: string): boolean {
  const l = text.trim();
  return (
    l.length <= 8 ||
    /^full changelog\b/i.test(l) ||
    /^changelog:/i.test(l) ||
    /^#\d+\b/.test(l)
  );
}

function extractChangelogBullets(notes: string): { kept: string[]; hadCandidates: boolean } {
  const lines = stripBoilerplate(notes)
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

  const candidates = lines
    .filter((l) => /^[-*]/.test(l) || /^\d+\./.test(l))
    .map((l) => l.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);

  return {
    kept: candidates.filter((l) => !isDiscardedChangelogLine(l)),
    hadCandidates: candidates.length > 0,
  };
}

/** True when notes had bullet lines but every one was discarded as noise. */
export function changelogHadOnlyDiscardedBullets(notes: string): boolean {
  const { kept, hadCandidates } = extractChangelogBullets(notes);
  return hadCandidates && kept.length === 0;
}

/** Strip PR-title / changelog-compare lines from notes (LLM fallback input). */
export function stripDiscardedChangelogLines(notes: string): string {
  return stripBoilerplate(notes)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return false;
      const body = t
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+\.\s*/, "")
        .replace(/^#+\s*/, "")
        .trim();
      return !isDiscardedChangelogLine(body);
    })
    .join("\n")
    .trim();
}

function isNonFixBullet(b: string): boolean {
  // Leading Updated/Added/Improved already count as non-fix.
  // Do not treat incidental "updated" inside a Fixed sentence as a feature.
  return !/^(fixed|fix|bug)\b/i.test(b) || /\b(added|improved|changed|new)\b/i.test(b);
}

function isNarrativeFix(b: string): boolean {
  return /^fixed\b/i.test(b) && b.length >= 60;
}

export function pickBullets(notes: string, max = 3): string[] {
  const { kept: bullets } = extractChangelogBullets(notes);
  if (max <= 0) return [];

  const selected: string[] = [];
  const take = (pool: string[]) => {
    for (const b of pool) {
      if (selected.length >= max) return;
      if (!selected.includes(b)) selected.push(b);
    }
  };

  // Non-fix first; fill leftover slots with long narrative Fixed lines, then
  // any remaining bullets so a lone preferred item is not dropped.
  take(bullets.filter(isNonFixBullet));
  take(bullets.filter(isNarrativeFix));
  take(bullets);
  return selected;
}
