import type { Release } from "./types.ts";
import { compareVersionIds } from "../versions.ts";

/** Tip-only (newest). Used for seed. */
export async function fetchLatestGrokBuild(): Promise<Release | null> {
  const list = await fetchGrokBuildSince(null);
  return list[0] ?? null;
}

/**
 * Parse https://x.ai/build/changelog for version blocks (oldest-first walk).
 * Pass `null` to get only the tip (for seeding).
 * Throws if HTML is blocked/unparseable (fail product — no silent null forever).
 */
export async function fetchGrokBuildSince(
  afterVersion: string | null,
): Promise<Release[]> {
  const html = await fetchChangelogHtml();
  const all = parseVersionBlocks(html);
  if (all.length === 0) {
    throw new Error(
      "[grok_build] could not parse any version blocks from changelog HTML",
    );
  }

  if (afterVersion === null) return [all.reduce((latest, release) =>
    compareVersionIds(release.version, latest.version) > 0 ? release : latest)];

  if (!all.some(release => compareVersionIds(release.version, afterVersion) <= 0)) {
    throw new Error(`Grok changelog history does not reach ${afterVersion}`);
  }
  const newer = all
    .filter((r) => compareVersionIds(r.version, afterVersion) > 0)
    .sort((a, b) => compareVersionIds(a.version, b.version));

  console.log(
    `[grok_build] parsed ${all.length} blocks; ${newer.length} newer than ${afterVersion}`,
  );
  return newer;
}

async function fetchChangelogHtml(): Promise<string> {
  const res = await fetch("https://x.ai/build/changelog", {
    headers: {
      // Browser-like UA: bare bot UA gets 403 from some edges.
      "User-Agent":
        "Mozilla/5.0 (compatible; agent-releases/0.1; +https://github.com/majiayu000/agent-releases)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Grok Build changelog HTTP ${res.status}`);
  const html = await res.text();
  if (
    /cf-error|Attention Required|just a moment|cloudflare/i.test(html) &&
    !/Grok Build/i.test(html)
  ) {
    throw new Error(
      "[grok_build] changelog HTML looks blocked (Cloudflare) or empty of Grok Build content",
    );
  }
  return html;
}

/** Exported for selfcheck. */
export function parseVersionBlocks(html: string): Release[] {
  // Strip scripts/styles to reduce noise
  // Next.js / React SSR inserts empty comments between text nodes, e.g.
  // `Grok Build <!-- -->1.0.25` and `v<!-- -->1.0.25`. Strip before match.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<!--[\s\S]*?-->/g, "");

  type Hit = { version: string; index: number };
  const hits: Hit[] = [];
  const seen = new Set<string>();

  const patterns: RegExp[] = [
    /##\s+Grok Build\s+v?(\d+\.\d+\.\d+)/gi,
    /<h[1-6][^>]*>\s*Grok Build\s+v?(\d+\.\d+\.\d+)\s*<\/h[1-6]>/gi,
    /Grok Build\s+v?(\d+\.\d+\.\d+)/gi,
    /Latest\s+v?(\d+\.\d+\.\d+)/gi,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cleaned)) !== null) {
      const version = m[1]!;
      if (seen.has(version)) continue;
      // Prefer heading-style hits; skip ultra-late generic matches if we already have many
      seen.add(version);
      hits.push({ version, index: m.index });
    }
    // If markdown/HTML headings found enough, stop broadening
    if (hits.length >= 2 && patterns.indexOf(re) <= 1) break;
  }

  if (hits.length === 0) return [];

  // Sort by document order (newest usually first on the page)
  hits.sort((a, b) => a.index - b.index);

  // Deduplicate while preserving first-seen order
  const ordered: string[] = [];
  const orderedSet = new Set<string>();
  for (const h of hits) {
    if (orderedSet.has(h.version)) continue;
    orderedSet.add(h.version);
    ordered.push(h.version);
  }

  const releases: Release[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const version = ordered[i]!;
    const start = hits.find((h) => h.version === version)!.index;
    const end =
      i + 1 < ordered.length
        ? hits.find((h) => h.version === ordered[i + 1]!)!.index
        : Math.min(cleaned.length, start + 6000);
    const chunk = cleaned.slice(start, end);
    const notes = extractNotes(chunk);
    releases.push({
      product: "grok_build",
      version,
      displayVersion: version,
      title: `Grok Build ${version}`,
      notes,
      url: "https://x.ai/build/changelog",
    });
  }

  return releases;
}

function extractNotes(chunk: string): string {
  const items = [...chunk.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) =>
      m[1]!
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((t) => t.length > 10)
    .slice(0, 20);

  if (items.length > 0) return items.map((t) => `- ${t}`).join("\n");

  const md = [...chunk.matchAll(/^[-*]\s+(.+)$/gm)]
    .map((m) => `- ${m[1]!.trim()}`)
    .filter((t) => t.length > 4)
    .slice(0, 15);
  if (md.length > 0) return md.join("\n");

  const text = chunk
    .replace(/<[^>]+>/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
  return text.slice(0, 1500) || "- See https://x.ai/build/changelog";
}

// TODO(v2): Grok Bot — no stable versioned feed yet (docs/news only). Add when a release API exists.
