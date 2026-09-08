import type { Release } from "./types.ts";

type GhRelease = {
  tag_name: string;
  html_url: string;
  body: string | null;
  name: string | null;
  draft?: boolean;
  prerelease?: boolean;
};

export async function fetchLatestClaude(): Promise<Release | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-releases-bot",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const res = await fetch(
      "https://api.github.com/repos/anthropics/claude-code/releases?per_page=5",
      { headers },
    );
    if (res.ok) {
      const list = (await res.json()) as GhRelease[];
      const rel = list.find((r) => !r.draft && !r.prerelease) || list[0];
      if (rel) {
        const tag = rel.tag_name.replace(/^v/, "");
        let notes = rel.body?.trim() || "";
        if (notes.length < 40) {
          const section = await changelogSection(tag);
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
    } else {
      console.warn(`[claude] API ${res.status}, falling back to CHANGELOG.md`);
    }
  } catch (e) {
    console.warn("[claude] API error, fallback", e);
  }

  const mdRes = await fetch(
    "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    { headers: { "User-Agent": "agent-releases-bot" } },
  );
  if (!mdRes.ok) throw new Error(`Claude CHANGELOG HTTP ${mdRes.status}`);
  const text = await mdRes.text();
  const m = text.match(/^##\s+(\d+\.\d+\.\d+)\s*$/m);
  if (!m) return null;
  const tag = m[1];
  const section = extractChangelogSection(text, tag) || "";
  return {
    product: "claude",
    version: tag,
    displayVersion: tag,
    title: `Claude Code ${tag}`,
    notes: section,
    url: `https://github.com/anthropics/claude-code/releases/tag/v${tag}`,
  };
}

async function changelogSection(version: string): Promise<string | null> {
  const md = await fetch(
    "https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md",
    { headers: { "User-Agent": "agent-releases-bot" } },
  );
  if (!md.ok) return null;
  return extractChangelogSection(await md.text(), version);
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
