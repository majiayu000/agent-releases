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
 *
 * HTML tip-only fallback is allowed for seed (afterVersion === null) only.
 * If API fails and last_seen is set with a newer tip, fail the product
 * rather than silently skip middle versions.
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
          if (compareVersionIds(rel.tag_name, afterVersion) <= 0) {
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
      console.warn(
        `[codex] hit page cap (${MAX_PAGES}) without finding last_seen ${afterVersion}`,
      );
    }

    const rust = all.filter((r) => !r.draft && !r.prerelease && isRustTag(r.tag_name));
    const pool =
      rust.length > 0 ? rust : all.filter((r) => !r.draft && !r.prerelease);

    if (afterVersion === null) {
      const tip = pool[0] || all[0];
      return tip ? [toRelease(tip)] : [];
    }

    const newer = pool
      .filter((r) => compareVersionIds(r.tag_name, afterVersion) > 0)
      .sort((a, b) => compareVersionIds(a.tag_name, b.tag_name));
    return newer.map(toRelease);
  }

  console.warn(`[codex] API ${lastStatus || "error"}, considering HTML tip fallback`);
  const tip = await fetchCodexTipFromHtml();
  if (!tip) {
    throw new Error(`[codex] API ${lastStatus || "error"} and HTML tip unparseable`);
  }

  // Seed only: tip-only is OK
  if (afterVersion === null) return [tip];

  if (
    tip.version === afterVersion ||
    compareVersionIds(tip.version, afterVersion) <= 0
  ) {
    console.log(`[codex] HTML tip ${tip.version} <= last_seen ${afterVersion}; skip`);
    return [];
  }

  throw new Error(
    `[codex] API failed (${lastStatus || "error"}); HTML tip-only would skip middle versions ` +
      `(last_seen=${afterVersion}, tip=${tip.version}). Failing product rather than advancing past gap.`,
  );
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
