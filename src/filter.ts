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

export function pickBullets(notes: string, max = 3): string[] {
  const lines = stripBoilerplate(notes)
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

  const bullets = lines
    .filter((l) => /^[-*]/.test(l) || /^\d+\./.test(l))
    .map((l) => l.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, "").trim())
    .filter((l) => l.length > 8)
    .filter((l) => !/^full changelog/i.test(l))
    .filter((l) => !/^changelog:/i.test(l));

  const preferred = bullets.filter(
    (b) => !/^(fixed|fix|bug)\b/i.test(b) || /\b(added|improved|changed|new)\b/i.test(b),
  );
  const pool = preferred.length >= max ? preferred : bullets;
  return pool.slice(0, max);
}
