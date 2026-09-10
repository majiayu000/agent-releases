/**
 * Approximate X/Twitter weighted length:
 * - URLs count as ~23
 * - non-ASCII (incl. CJK) ~2
 * - ASCII ~1
 */
const URL_RE = /https?:\/\/[^\s]+/gi;

export const X_WEIGHTED_LIMIT = 280;

export function weightedXLength(text: string): number {
  let urls = 0;
  const withoutUrls = text.replace(URL_RE, () => {
    urls += 1;
    return "";
  });
  let weight = urls * 23;
  for (const ch of withoutUrls) {
    const code = ch.codePointAt(0) ?? 0;
    weight += code > 0x7f ? 2 : 1;
  }
  return weight;
}
