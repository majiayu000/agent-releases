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

function toRelease(rel: GhRelease): Release {
  const display = rel.tag_name.replace(/^rust-v/, "").replace(/^v/, "");
  return {
    product: "codex",
    version: rel.tag_name,
    displayVersion: display,
    title: rel.name || `Codex ${rel.tag_name}`,
    notes: rel.body?.trim() || "",
    url: rel.html_url,
  };
}

function isRustTag(tag: string): boolean {
  return /^rust-v/.test(tag);
}

/** Tip-only (newest rust-v* preferred). Used for seed. */
export async function fetchLatestCodex(): Promise<Release | null> {
  const list = await fetchCodexSince(null);
  return list[0] ?? null;
}

/**
 * rust-v* releases newer than `afterVersion` (exclusive), oldest-first.
 * Pass `null` to get only the tip (for seeding).
 */
export async function fetchCodexSince(afterVersion: string | null): Promise<Release[]> {
  const headers = ghHeaders();
  const res = await fetch(
    "https://api.github.com/repos/openai/codex/releases?per_page=30",
    { headers },
  );
  if (res.ok) {
    const list = (await res.json()) as GhRelease[];
    const rust = list.filter((r) => !r.draft && !r.prerelease && isRustTag(r.tag_name));
    const pool =
      rust.length > 0
        ? rust
        : list.filter((r) => !r.draft && !r.prerelease);

    if (afterVersion === null) {
      const tip = pool[0] || list[0];
      return tip ? [toRelease(tip)] : [];
    }

    const newer = pool
      .filter((r) => compareVersionIds(r.tag_name, afterVersion) > 0)
      .sort((a, b) => compareVersionIds(a.tag_name, b.tag_name));
    return newer.map(toRelease);
  }

  console.warn(`[codex] API ${res.status}, falling back to releases HTML (tip-only)`);
  const tip = await fetchCodexTipFromHtml();
  if (!tip) return [];
  if (afterVersion === null) return [tip];
  if (compareVersionIds(tip.version, afterVersion) > 0) return [tip];
  return [];
}

async function fetchCodexTipFromHtml(): Promise<Release | null> {
  const htmlRes = await fetch("https://github.com/openai/codex/releases", {
    headers: { "User-Agent": "agent-releases-bot" },
  });
  if (!htmlRes.ok) throw new Error(`Codex HTML HTTP ${htmlRes.status}`);
  const html = await htmlRes.text();
  const tag =
    html.match(/\/openai\/codex\/releases\/tag\/(rust-v[0-9.]+)/)?.[1] ||
    html.match(/\/openai\/codex\/releases\/tag\/(v?[0-9.]+)/)?.[1];
  if (!tag) return null;
  const display = tag.replace(/^rust-v/, "").replace(/^v/, "");
  return {
    product: "codex",
    version: tag,
    displayVersion: display,
    title: `Codex ${tag}`,
    notes: "- See release notes on GitHub",
    url: `https://github.com/openai/codex/releases/tag/${tag}`,
  };
}
