import type { Release } from "./sources/types.ts";

export async function openDraftIssue(release: Release, body: string): Promise<string> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY; // owner/name
  if (!token || !repo) {
    console.log("--- DRY_RUN draft (no GITHUB_TOKEN/REPO; printing only) ---\n" + body);
    return "local";
  }
  const title = `[DRY_RUN] ${release.product} ${release.version}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "agent-releases-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body: `自动草稿（未发 X）\n\n\`\`\`\n${body}\n\`\`\`\n`,
      labels: ["dry-run", release.product],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Create issue failed ${res.status}: ${t}`);
  }
  const json = (await res.json()) as { html_url: string };
  return json.html_url;
}
