import type { Release } from "./sources/types.ts";
import { postHeader } from "./sources/types.ts";
import { draftChinesePostWithLlm } from "./draft-llm.ts";
import { weightedXLength, X_WEIGHTED_LIMIT } from "./x-length.ts";

/** Hollow / placeholder Chinese bullets that must never go live on X. */
const HOLLOW_BULLET =
  /详见发版说明|见\s*changelog|见发版说明|无实质|暂无细节|省略|稍后补充|(?:^|\s)(更新|改进|修复|调整)(?:「[^」]*」)?(?:。|\.|!|！)?\s*$/u;

/** One emoji grapheme cluster (Extended_Pictographic + optional VS16 / ZWJ joins). */
const EMOJI_RUN =
  /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u;

/**
 * Collapse stacked leading emojis (`🔧 🛠️ 新增` → `🔧 新增`) so live posts
 * keep shipping when the model doubles up. Exported for selfcheck.
 */
export function normalizeBulletEmoji(line: string): string {
  let rest = line.trim();
  const leading: string[] = [];
  while (rest.length) {
    const m = rest.match(new RegExp(`^(${EMOJI_RUN.source})\\s*`, "u"));
    if (!m) break;
    leading.push(m[1]);
    rest = rest.slice(m[0].length);
  }
  if (!leading.length || !rest) return line.trim();
  return `${leading[0]} ${rest.trim()}`;
}

/** Exactly one semantic emoji, then space, then non-emoji text — not •/-/*. */
export function isSemanticEmojiBullet(line: string): boolean {
  if (line.startsWith("• ") || line.startsWith("- ") || line.startsWith("* ")) return false;
  const m = line.match(new RegExp(`^(${EMOJI_RUN.source})\\s+(\\S.*)$`, "u"));
  if (!m) return false;
  // Second token must not be another emoji (rejects un-normalized doubles).
  return !new RegExp(`^${EMOJI_RUN.source}`, "u").test(m[2]);
}

/** Check the final payload once, without truncating sentences or rewriting source facts. */
export function validateChinesePost(text: string, release: Release): string {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = postHeader(release);
  if (lines[0] !== header || lines.at(-1) !== release.url) {
    throw new Error("Draft must have the exact product/version heading and release URL");
  }
  const bullets = lines.slice(1, -1).map(normalizeBulletEmoji);
  if (
    bullets.length < 1 ||
    bullets.length > 3 ||
    bullets.some((line) => !isSemanticEmojiBullet(line))
  ) {
    throw new Error("Draft requires one to three single-emoji bullet sentences");
  }
  for (const bullet of bullets) {
    if ((bullet.match(/`/g)?.length ?? 0) % 2) throw new Error("Draft contains an incomplete code token");
    // Drop the leading emoji when scoring Chinese/Latin so the icon does not count as Latin.
    const prose = bullet.replace(new RegExp(`^${EMOJI_RUN.source}\\s+`, "u"), "").replace(/`[^`]+`/g, "");
    const chinese = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
    const latin = prose.match(/[A-Za-z]/g)?.length ?? 0;
    if (chinese < 6 || latin > chinese * 2 || /…|\.\.\./.test(prose) || HOLLOW_BULLET.test(prose)) {
      throw new Error("Draft has untranslated, empty or truncated bullet content; review required");
    }
  }
  const result = `${lines[0]}\n\n${bullets.join("\n")}\n\n${release.url}`;
  if (weightedXLength(result) > X_WEIGHTED_LIMIT) {
    throw new Error("Draft exceeds X length limit; regenerate a shorter complete draft");
  }
  return result;
}

/** No key, provider failure or unusable draft is a hard failure. Never substitute a template. */
export async function draftChinesePost(release: Release): Promise<string> {
  const text = await draftChinesePostWithLlm(release);
  const bullets = text
    .split(/\r?\n/)
    .map((line) => normalizeBulletEmoji(line.trim()))
    .filter(Boolean)
    // LLM may accidentally include header/url; keep only bullet-like lines.
    .filter((line) => isSemanticEmojiBullet(line) || line.startsWith("• "));
  const header = postHeader(release);
  const assemble = () => `${header}\n\n${bullets.join("\n")}\n\n${release.url}`;
  // Prefer fewer complete changes over cutting sentences or code tokens mid-way.
  while (bullets.length > 1 && weightedXLength(assemble()) > X_WEIGHTED_LIMIT) bullets.pop();
  return validateChinesePost(assemble(), release);
}
