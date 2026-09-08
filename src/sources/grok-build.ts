import type { Release } from "./types.ts";

/** Parse https://x.ai/build/changelog for the newest version block. */
export async function fetchLatestGrokBuild(): Promise<Release | null> {
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

  if (!latest) return null;

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
