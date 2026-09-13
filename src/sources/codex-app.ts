import type { Release } from "./types.ts";

const CHANGELOG_URL = "https://developers.openai.com/codex/changelog";

/** Tip-only (newest). Used for seed. */
export async function fetchLatestCodexApp(): Promise<Release | null> {
  const list = await fetchCodexAppSince(null);
  return list[0] ?? null;
}

/**
 * Codex App entries from developers.openai.com/codex/changelog.
 * Only `data-codex-topics` that include `codex-app` (comma-separated OK).
 * Pass `null` to get only the tip (for seeding).
 */
export async function fetchCodexAppSince(
  afterVersion: string | null,
): Promise<Release[]> {
  const html = await fetchChangelogHtml();
  // Document order from the page (newest first). Do not sort by slug.
  const all = parseCodexAppEntries(html);
  if (all.length === 0) {
    throw new Error("[codex_app] could not parse any Codex App changelog entries");
  }

  if (afterVersion === null) return [all[0]!];

  const cursorIndex = all.findIndex((release) => release.version === afterVersion);
  if (cursorIndex < 0) {
    throw new Error(`Codex App changelog history does not reach ${afterVersion}`);
  }

  // Entries before the cursor in document order are newer; walk oldest-first.
  const newer = all.slice(0, cursorIndex).reverse();
  console.log(
    `[codex_app] parsed ${all.length} app entries; ${newer.length} newer than ${afterVersion}`,
  );
  return newer;
}

async function fetchChangelogHtml(): Promise<string> {
  const res = await fetch(CHANGELOG_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; agent-releases/0.1; +https://github.com/majiayu000/agent-releases)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Codex App changelog HTTP ${res.status}`);
  const html = await res.text();
  if (
    /cf-error|Attention Required|just a moment|cloudflare/i.test(html) &&
    !/data-codex-topics/i.test(html)
  ) {
    throw new Error(
      "[codex_app] changelog HTML looks blocked or missing Codex topic markers",
    );
  }
  return html;
}

/** Exported for tests. Newest-first document order does not matter; ids are sorted by caller. */
export function parseCodexAppEntries(html: string): Release[] {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");

  const releases: Release[] = [];
  const openRe = /<li\b([^>]*)>/gi;
  let om: RegExpExecArray | null;
  while ((om = openRe.exec(cleaned)) !== null) {
    const attrs = om[1] ?? "";
    const id = attr(attrs, "id");
    const topicsRaw = attr(attrs, "data-codex-topics");
    if (!id || !topicsRaw) continue;
    if (!/^codex-\d{4}-\d{2}-\d{2}/.test(id)) continue;
    const topics = topicsRaw.split(",").map((t) => t.trim()).filter(Boolean);
    if (!topics.includes("codex-app")) continue;

    const innerStart = om.index + om[0].length;
    const innerEnd = findMatchingLiEnd(cleaned, innerStart);
    if (innerEnd < 0) throw new Error(`[codex_app] unclosed li for ${id}`);
    const inner = cleaned.slice(innerStart, innerEnd);
    // Advance search past this li to avoid re-scanning nested opens unnecessarily
    openRe.lastIndex = innerEnd + 5;

    const date = textBetween(inner, /<time\b[^>]*>/i, /<\/time>/i) ??
      id.match(/codex-(\d{4}-\d{2}-\d{2})/)?.[1] ??
      "";
    const titleHtml = textBetween(inner, /<h3\b[^>]*>/i, /<\/h3>/i) ?? "";
    const articleHtml = textBetween(inner, /<article\b[^>]*>/i, /<\/article>/i) ?? inner;
    const titleText = htmlToText(titleHtml).trim();
    const { title, version: titleVersion } = parseTitle(titleText);
    const notes = articleToNotes(articleHtml);
    if (!notes.trim()) {
      throw new Error(`[codex_app] empty notes for ${id}`);
    }

    releases.push({
      product: "codex_app",
      version: id,
      displayVersion: titleVersion ?? (date || id),
      title: title || titleText || id,
      notes,
      url: `${CHANGELOG_URL}#${id}`,
    });
  }

  const seen = new Set<string>();
  const unique: Release[] = [];
  for (const r of releases) {
    if (seen.has(r.version)) continue;
    seen.add(r.version);
    unique.push(r);
  }
  return unique;
}

/** Depth-aware </li> finder starting after an opening <li...>. */
function findMatchingLiEnd(html: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < html.length) {
    const nextOpen = html.toLowerCase().indexOf("<li", i);
    const nextClose = html.toLowerCase().indexOf("</li>", i);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 3;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    i = nextClose + 5;
  }
  return -1;
}

/** Best-effort id ordering for tests; live walks use document order instead. */
export function compareChangelogIds(a: string, b: string): number {
  return a.localeCompare(b);
}

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  return m?.[1] ?? null;
}

function textBetween(html: string, open: RegExp, close: RegExp): string | null {
  const om = open.exec(html);
  if (!om) return null;
  const start = om.index + om[0].length;
  close.lastIndex = start;
  const cm = close.exec(html);
  if (!cm) return null;
  return html.slice(start, cm.index);
}

function parseTitle(text: string): { title: string; version: string | null } {
  const match = text.match(/\b(\d+\.\d+(?:\.\d+)?)\s*$/);
  if (!match) return { title: text, version: null };
  return { title: text.slice(0, -match[0].length).trim(), version: match[1]! };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, codePoint: string) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    );
}

function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\/(p|h1|h2|h3|h4|h5|h6|div|section|article|ul|ol|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Turn article prose into filter-friendly markdown:
 * feature h3 → `- Title: first paragraph`
 * bug-fix heading → `## Bug Fixes` then list items.
 */
export function articleToNotes(articleHtml: string): string {
  const parts: string[] = [];
  const sectionRe = /<h3\b[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3\b|$)/gi;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = sectionRe.exec(articleHtml)) !== null) {
    matched = true;
    const heading = htmlToText(m[1] ?? "").trim();
    const body = m[2] ?? "";
    if (/bug\s*fix|other improvements/i.test(heading)) {
      parts.push(`## Bug Fixes`);
      const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((x) =>
        htmlToText(x[1] ?? "").trim()
      ).filter(Boolean);
      for (const item of items) parts.push(`- Fixed ${item.replace(/^\s*Fixed\s+/i, "")}`);
      continue;
    }
    const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((x) =>
      htmlToText(x[1] ?? "").trim()
    ).filter(Boolean);
    const summary = paras[0] ?? htmlToText(body).split("\n").find(Boolean) ?? "";
    if (!heading && !summary) continue;
    parts.push(summary ? `- ${heading}: ${summary}` : `- ${heading}`);
  }
  if (!matched) {
    // Fallback: keep every nonempty line as a bullet (not only the first).
    for (const line of htmlToText(articleHtml).split("\n")) {
      const trimmed = line.trim();
      if (trimmed) parts.push(`- ${trimmed}`);
    }
  }
  return parts.join("\n");
}
