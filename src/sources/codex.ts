import type { Release } from "./types.ts";

type GhRelease = {
  tag_name: string;
  html_url: string;
  body: string | null;
  name: string | null;
  draft?: boolean;
  prerelease?: boolean;
};

export async function fetchLatestCodex(): Promise<Release | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "agent-releases-bot",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(
    "https://api.github.com/repos/openai/codex/releases?per_page=20",
    { headers },
  );
  if (res.ok) {
    const list = (await res.json()) as GhRelease[];
    const rel =
      list.find((r) => !r.draft && !r.prerelease && /^rust-v/.test(r.tag_name)) ||
      list.find((r) => !r.draft && !r.prerelease) ||
      list[0];
    if (!rel) return null;
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

  console.warn(`[codex] API ${res.status}, falling back to releases HTML`);
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
