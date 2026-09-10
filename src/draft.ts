import type { Release } from "./sources/types.ts";
import { PRODUCT_NAME, PRODUCT_TAG } from "./sources/types.ts";
import { draftChinesePostWithLlm } from "./draft-llm.ts";
import { weightedXLength, X_WEIGHTED_LIMIT } from "./x-length.ts";

/** Check the final payload once, without truncating sentences or rewriting source facts. */
export function validateChinesePost(text: string, release: Release): string {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const header = `${PRODUCT_TAG[release.product]}${PRODUCT_NAME[release.product]} ${release.displayVersion} 发布`;
  if (lines[0] !== header || lines.at(-1) !== release.url) {
    throw new Error("Draft must have the exact product/version heading and release URL");
  }
  const bullets = lines.slice(1, -1);
  if (bullets.length < 1 || bullets.length > 3 || bullets.some(line => !line.startsWith("• "))) {
    throw new Error("Draft requires one to three complete bullet sentences");
  }
  for (const bullet of bullets) {
    if ((bullet.match(/`/g)?.length ?? 0) % 2) throw new Error("Draft contains an incomplete code token");
    const prose = bullet.replace(/`[^`]+`/g, "");
    const chinese = prose.match(/\p{Script=Han}/gu)?.length ?? 0;
    const latin = prose.match(/[A-Za-z]/g)?.length ?? 0;
    if (chinese < 6 || latin > chinese * 2 || /详见发版说明|…|\.\.\./.test(prose)) {
      throw new Error("Draft has untranslated, empty or truncated bullet content; review required");
    }
  }
  const result = `${lines[0]}\n\n${bullets.join("\n")}\n\n${release.url}`;
  if (weightedXLength(result) > X_WEIGHTED_LIMIT) throw new Error("Draft exceeds X length limit; regenerate a shorter complete draft");
  return result;
}

/** No key, provider failure or unusable draft is a hard failure. Never substitute a template. */
export async function draftChinesePost(release: Release): Promise<string> {
  return validateChinesePost(await draftChinesePostWithLlm(release), release);
}
