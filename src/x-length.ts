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

/**
 * Trim bullet lines so the post fits ~280 weighted units.
 * Keeps header + URL; drops/shortens trailing bullets.
 */
export function trimPostToWeightedLimit(
  post: string,
  limit = X_WEIGHTED_LIMIT,
): string {
  if (weightedXLength(post) <= limit) return post;

  const raw = post.replace(/\r\n/g, "\n").trimEnd();
  const lines = raw.split("\n");

  let url = "";
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  if (lines.length && /^https?:\/\//i.test(lines[lines.length - 1]!.trim())) {
    url = lines.pop()!.trim();
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  }

  const header: string[] = [];
  let i = 0;
  for (; i < lines.length; i++) {
    if (lines[i]!.trim() === "") {
      i += 1;
      break;
    }
    header.push(lines[i]!);
  }
  let bullets = lines.slice(i).filter((l) => l.trim().startsWith("•"));

  const rebuild = (): string => {
    const body =
      bullets.length > 0
        ? `${header.join("\n")}\n\n${bullets.join("\n")}`
        : header.join("\n");
    return url ? `${body}\n\n${url}` : body;
  };

  while (bullets.length > 1 && weightedXLength(rebuild()) > limit) {
    bullets = bullets.slice(0, -1);
  }

  if (bullets.length >= 1 && weightedXLength(rebuild()) > limit) {
    let b = bullets[0]!;
    while (b.length > 4 && weightedXLength(rebuild()) > limit) {
      const core = b.replace(/…$/, "").slice(0, -1);
      b = core + "…";
      bullets = [b, ...bullets.slice(1)];
    }
  }

  // Last resort: drop all bullets
  if (weightedXLength(rebuild()) > limit) {
    bullets = [];
  }

  return rebuild();
}
