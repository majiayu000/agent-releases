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

const PER_PAGE = 30;
const MAX_PAGES = 10;

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
  if (!notes) throw new Error(`Missing Claude release notes: ${tag}`);
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
 * Paginate GitHub releases until we pass last_seen or hit MAX_PAGES.
 * Returns newest-first raw stables; caller sorts oldest-first for walks.
 */
async function fetchClaudeReleasePages(
  afterVersion: string | null,
): Promise<GhRelease[]> {
  const headers = ghHeaders();
  const all: GhRelease[] = [];
  let foundLastSeen = afterVersion === null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `https://api.github.com/repos/anthropics/claude-code/releases?per_page=${PER_PAGE}&page=${page}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`Claude API HTTP ${res.status} page=${page}`);
    }
    const list = (await res.json()) as GhRelease[];
    if (list.length === 0) break;

    all.push(...list);

    if (afterVersion !== null) {
      for (const rel of list) {
        if (rel.draft || rel.prerelease || !/^v?\d+\.\d+\.\d+$/.test(rel.tag_name)) continue;
        const tag = rel.tag_name.replace(/^v/, "");
        if (compareVersionIds(tag, afterVersion) <= 0) {
          foundLastSeen = true;
          break;
        }
      }
      if (foundLastSeen) break;
    } else {
      // Seed only needs page 1 tip
      break;
    }

    if (list.length < PER_PAGE) break;
  }

  if (afterVersion !== null && !foundLastSeen) {
    throw new Error(`[claude] incomplete release history before ${afterVersion}`);
  }

  return all;
}

/**
 * Releases newer than `afterVersion` (exclusive), oldest-first.
 * Pass `null` to get only the tip (for seeding).
 *
 * The version list always comes from GitHub. CHANGELOG.md only fills in notes
 * when a GitHub release body is missing or too short — it never replaces the walk.
 */
export async function fetchClaudeSince(afterVersion: string | null): Promise<Release[]> {
  const list = await fetchClaudeReleasePages(afterVersion);
  const stables = list.filter((r) => !r.draft && !r.prerelease && /^v?\d+\.\d+\.\d+$/.test(r.tag_name));
  if (!stables.length) throw new Error("Claude API returned no stable releases");

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

async function fetchChangelogMd(): Promise<string | null> {
  const mdRes = await fetch(
    "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    { headers: { "User-Agent": "agent-releases-bot" } },
  );
  if (!mdRes.ok) throw new Error(`Claude changelog HTTP ${mdRes.status}`);
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
