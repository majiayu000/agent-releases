/** Returns true if notes look feature-worthy (not Fixed-only). */
export function isNotable(notes: string): boolean {
  const text = notes || "";
  const lower = text.toLowerCase();

  const featureHints =
    /\b(added|add|new feature|new features|improved|improve|changed|change|removed|remove|introduc|support for|supports)\b/i.test(
      text,
    ) ||
    /新增|支持|改进|优化|变更|移除|推出/.test(text) ||
    /^[-*]\s*added\b/im.test(text) ||
    /###?\s*(new features|features|added|changed|improved|removed)/i.test(text);

  const onlyBugfix =
    /bug fixes? and reliability improvements/i.test(text.trim()) ||
    (/^\s*[-*]\s*(fixed|fix|bug)\b/im.test(text) &&
      !featureHints &&
      text.split("\n").filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*")).length <= 3 &&
      !/\b(added|improved|changed|removed)\b/i.test(text));

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
  const lines = notes
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
