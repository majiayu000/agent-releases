import type { Release } from "./sources/types.ts";
import { PRODUCT_NAME, PRODUCT_TAG } from "./sources/types.ts";
import { pickBullets } from "./filter.ts";

const PHRASES: [RegExp, string][] = [
  [/\bAdded\b/gi, "新增"],
  [/\bImproved\b/gi, "改进"],
  [/\bFixed\b/gi, "修复"],
  [/\bChanged\b/gi, "变更"],
  [/\bRemoved\b/gi, "移除"],
  [/\bSupport for\b/gi, "支持"],
  [/\bNow supports\b/gi, "现已支持"],
  [/\byou can\b/gi, "可以"],
  [/\blets you\b/gi, "让你可以"],
  [/\bno longer\b/gi, "不再"],
  [/\binstead of\b/gi, "不再是"],
];

function toChineseish(s: string): string {
  let out = s;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);
  // Keep technical tokens; trim length
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > 90) out = out.slice(0, 87) + "…";
  return out;
}

export function draftChinesePost(release: Release): string {
  const tag = PRODUCT_TAG[release.product];
  const name = PRODUCT_NAME[release.product];
  const header = `${tag}${name} ${release.displayVersion} 出了（非官方）`;

  let bullets = pickBullets(release.notes, 3).map(toChineseish);
  if (bullets.length === 0) {
    const fallback = release.notes
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, 3)
      .map(toChineseish);
    bullets = fallback;
  }
  while (bullets.length < 3 && bullets.length > 0) {
    // keep fewer than 3 if that's all we have
    break;
  }
  if (bullets.length === 0) {
    bullets = ["详见发版说明（非官方整理）"];
  }

  const body = bullets.map((b) => `• ${b}`).join("\n");
  let post = `${header}\n\n${body}\n\n${release.url}`;
  // Soft trim toward tweet length
  if (post.length > 400) {
    bullets = bullets.map((b) => (b.length > 60 ? b.slice(0, 57) + "…" : b));
    post = `${header}\n\n${bullets.map((b) => `• ${b}`).join("\n")}\n\n${release.url}`;
  }
  return post;
}
