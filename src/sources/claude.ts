import type { Release } from "./types.ts";
import { compareVersionIds } from "../versions.ts";

type GhRelease = {
  tag_name: string;
  html_url: string;
  body: string | null;
  name: string | null;
  draft?: boolean;
  prerelease?: boolean;
};

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-releases-bot",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function toRelease(rel: GhRelease, changelogMd?: string | null): Promise<Release> {
  const tag = rel.tag_name.replace(/^v/, "");
  let notes = rel.body?.trim() || "";
  if (notes.length < 40) {
    const section = changelogMd
      ? extractChangelogSection(changelogMd, tag)
      : await changelogSection(tag);
    if (section) notes = section;
  }
  return {
    product: "claude",
    version: tag,
    displayVersion: tag,
    title: rel.name || `Claude Code ${tag}`,
    notes,
    url: rel.html_url,
  };
}

/** Tip-only (newest stable). Used for seed. */
export async function fetchLatestClaude(): Promise<Release | null> {
  const list = await fetchClaudeSince(null);
  return list[0] ?? null;
}

/**
 * Releases newer than `afterVersion` (exclusive), oldest-first.
 * Pass `null` to get only the tip (for seeding).
 */
export async function fetchClaudeSince(afterVersion: string | null): Promise<Release[]> {
  const headers = ghHeaders();
  try {
    const res = await fetch(
      "https://api.github.com/repos/anthropics/claude-code/releases?per_page=30",
      { headers },
    );
    if (res.ok) {
      const list = (await res.json()) as GhRelease[];
      const stables = list.filter((r) => !r.draft && !r.prerelease);
      if (stables.length === 0 && list[0]) stables.push(list[0]);

      let needChangelog = false;
      const mapped: { rel: GhRelease; tag: string }[] = [];
      for (const rel of stables) {
        const tag = rel.tag_name.replace(/^v/, "");
        if (afterVersion !== null && compareVersionIds(tag, afterVersion) <= 0) continue;
        mapped.push({ rel, tag });
        if ((rel.body?.trim().length ?? 0) < 40) needChangelog = true;
      }

      // Tip-only when seeding
      if (afterVersion === null) {
        const tip = stables[0];
        if (!tip) return [];
        const md = (tip.body?.trim().length ?? 0) < 40 ? await fetchChangelogMd() : null;
        return [await toRelease(tip, md)];
      }

      // API is newest-first; we want oldest-first
      mapped.sort((a, b) => compareVersionIds(a.tag, b.tag));

      const md = needChangelog ? await fetchChangelogMd() : null;
      const out: Release[] = [];
      for (const { rel } of mapped) {
        out.push(await toRelease(rel, md));
      }
      return out;
    }
    console.warn(`[claude] API ${res.status}, falling back to CHANGELOG.md`);
  } catch (e) {
    console.warn("[claude] API error, fallback", e);
  }

  return fetchClaudeSinceFromChangelog(afterVersion);
}

async function fetchClaudeSinceFromChangelog(
  afterVersion: string | null,
): Promise<Release[]> {
  const md = await fetchChangelogMd();
  if (!md) return [];
  const tags = [...md.matchAll(/^##\s+(\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1]);
  if (tags.length === 0) return [];

  if (afterVersion === null) {
    const tag = tags[0];
    return [
      {
        product: "claude",
        version: tag,
        displayVersion: tag,
        title: `Claude Code ${tag}`,
        notes: extractChangelogSection(md, tag) || "",
        url: `https://github.com/anthropics/claude-code/releases/tag/v${tag}`,
      },
    ];
  }

  const newer = tags
    .filter((t) => compareVersionIds(t, afterVersion) > 0)
    .sort((a, b) => compareVersionIds(a, b));

  return newer.map((tag) => ({
    product: "claude" as const,
    version: tag,
    displayVersion: tag,
    title: `Claude Code ${tag}`,
    notes: extractChangelogSection(md, tag) || "",
    url: `https://github.com/anthropics/claude-code/releases/tag/v${tag}`,
  }));
}

async function fetchChangelogMd(): Promise<string | null> {
  const mdRes = await fetch(
    "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    { headers: { "User-Agent": "agent-releases-bot" } },
  );
  if (!mdRes.ok) return null;
  return mdRes.text();
}

async function changelogSection(version: string): Promise<string | null> {
  const md = await fetchChangelogMd();
  if (!md) return null;
  return extractChangelogSection(md, version);
}

function extractChangelogSection(md: string, version: string): string | null {
  const re = new RegExp(`^##\\s+${version.replace(/\./g, "\\.")}\\s*$`, "m");
  const m = md.match(re);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[0].length;
  const rest = md.slice(start);
  const next = rest.search(/^##\s+/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
