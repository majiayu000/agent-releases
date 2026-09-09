import type { Release } from "./types.ts";
import { compareVersionIds } from "../versions.ts";

/** Parse https://x.ai/build/changelog for the newest version block. */
export async function fetchLatestGrokBuild(): Promise<Release | null> {
  const list = await fetchGrokBuildSince(null);
  return list[0] ?? null;
}

/**
 * Grok Build changelog is typically tip-only (SPA / Cloudflare HTML).
 * When `afterVersion` is set we can only return the tip if it is newer;
 * multi-version walk is not available — logged clearly.
 */
export async function fetchGrokBuildSince(
  afterVersion: string | null,
): Promise<Release[]> {
  const tip = await parseTipFromChangelog();
  if (!tip) return [];

  if (afterVersion === null) return [tip];

  if (tip.version === afterVersion) return [];

  // Only the tip block is reliably parseable from the public page.
  console.log(
    `[grok_build] tip-only source; cannot walk full range after ${afterVersion}, only tip ${tip.version}`,
  );

  if (compareVersionIds(tip.version, afterVersion) > 0) return [tip];
  return [];
}

async function parseTipFromChangelog(): Promise<Release | null> {
  const res = await fetch("https://x.ai/build/changelog", {
    headers: {
      "User-Agent": "agent-releases-bot",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!res.ok) throw new Error(`Grok Build changelog HTTP ${res.status}`);
  const html = await res.text();

  // Prefer "Latest v1.0.13" marker
  const latest =
    html.match(/Latest\s+v?(\d+\.\d+\.\d+)/i)?.[1] ||
    html.match(/##\s+Grok Build\s+(v?\d+\.\d+\.\d+)/i)?.[1]?.replace(/^v/, "") ||
    html.match(/\bv(\d+\.\d+\.\d+)\b/)?.[1];

  if (!latest) {
    console.warn("[grok_build] could not parse tip version from changelog HTML");
    return null;
  }

  // Collect list items near the first version heading
  const headingRe = new RegExp(
    `(?:##\\s+Grok Build\\s+v?${latest.replace(/\./g, "\\.")}|v${latest.replace(/\./g, "\\.")})([\\s\\S]{0,4000})`,
    "i",
  );
  const chunk = html.match(headingRe)?.[1] || html.slice(0, 8000);
  const items = [...chunk.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) =>
      m[1]
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

  // Fallback: markdown-ish bullets in text
  let notes =
    items.length > 0
      ? items.map((t) => `- ${t}`).join("\n")
      : [...chunk.matchAll(/^[-*]\s+(.+)$/gm)]
          .map((m) => `- ${m[1].trim()}`)
          .slice(0, 15)
          .join("\n");

  if (!notes) {
    // strip tags and take a window
    const text = chunk.replace(/<[^>]+>/g, "\n").replace(/\s+\n/g, "\n");
    notes = text.slice(0, 1500);
  }

  return {
    product: "grok_build",
    version: latest,
    displayVersion: latest,
    title: `Grok Build ${latest}`,
    notes,
    url: "https://x.ai/build/changelog",
  };
}

// TODO(v2): Grok Bot — no stable versioned feed yet (docs/news only). Add when a release API exists.
