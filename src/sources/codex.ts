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

function toRelease(rel: GhRelease): Release {
  if (!rel.body?.trim()) throw new Error(`Missing Codex release notes: ${rel.tag_name}`);
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
  return /^rust-v\d+\.\d+\.\d+$/.test(tag);
}

/** Tip-only (newest rust-v* preferred). Used for seed. */
export async function fetchLatestCodex(): Promise<Release | null> {
  const list = await fetchCodexSince(null);
  return list[0] ?? null;
}

/**
 * rust-v* releases newer than `afterVersion` (exclusive), oldest-first.
 * Pass `null` to get only the tip (for seeding).
 *
 * API errors and incomplete history fail the product; never guess from an HTML tip.
 */
export async function fetchCodexSince(afterVersion: string | null): Promise<Release[]> {
  const headers = ghHeaders();
  const all: GhRelease[] = [];
  let foundLastSeen = afterVersion === null;
  let apiOk = false;
  let lastStatus = 0;

  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(
        `https://api.github.com/repos/openai/codex/releases?per_page=${PER_PAGE}&page=${page}`,
        { headers },
      );
      lastStatus = res.status;
      if (!res.ok) {
        apiOk = false;
        break;
      }
      apiOk = true;
      const list = (await res.json()) as GhRelease[];
      if (list.length === 0) break;
      all.push(...list);

      if (afterVersion !== null) {
        for (const rel of list) {
          if (!rel.draft && !rel.prerelease && isRustTag(rel.tag_name) && compareVersionIds(rel.tag_name, afterVersion) <= 0) {
            foundLastSeen = true;
            break;
          }
        }
        if (foundLastSeen) break;
      } else {
        break; // seed: tip from page 1
      }

      if (list.length < PER_PAGE) break;
    }
  } catch (e) {
    console.warn("[codex] API error", e);
    apiOk = false;
  }

  if (apiOk) {
    if (afterVersion !== null && !foundLastSeen) {
      throw new Error(`[codex] incomplete release history before ${afterVersion}`);
    }

    const rust = all.filter((r) => !r.draft && !r.prerelease && isRustTag(r.tag_name));
    if (!rust.length) throw new Error("Codex API returned no stable rust releases");
    const pool = rust;

    if (afterVersion === null) {
      const tip = pool[0];
      return tip ? [toRelease(tip)] : [];
    }

    const newer = pool
      .filter((r) => compareVersionIds(r.tag_name, afterVersion) > 0)
      .sort((a, b) => compareVersionIds(a.tag_name, b.tag_name));
    return newer.map(toRelease);
  }

  throw new Error(`[codex] release API failed (${lastStatus || "network error"}); state unchanged`);
}
