import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { postTweet, uploadMedia } from "./twitter.ts";

function loadText(): string {
  const fromEnv = process.env.POST_TEXT?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.POST_FILE?.trim();
  if (file) {
    const body = readFileSync(file, "utf8").trim();
    if (!body) throw new Error(`POST_FILE empty: ${file}`);
    return body;
  }
  throw new Error("POST_TEXT or POST_FILE required");
}

/** Split on a line that is exactly --- (thread parts). Single-part files stay one tweet. */
export function splitThreadParts(body: string): string[] {
  const parts = body
    .split(/\r?\n---\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error("POST body empty after thread split");
  return parts;
}

/** Dig / radar: root tweet must never contain http(s) links. Fail before any X call. */
export function assertRootTweetHasNoLinks(root: string): void {
  if (/https?:\/\//i.test(root)) {
    throw new Error(
      "Root tweet must contain zero http(s) links; put the official URL after --- as 官方：…",
    );
  }
}

/**
 * X does not render Markdown: backticks and **bold** show up literally.
 * Strip every backtick (keep the inner text) and line-leading ** bold markers
 * instead of failing the post. Returns the cleaned text plus warnings to log.
 */
export function stripMarkdownForX(text: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const backticks = text.match(/`/g)?.length ?? 0;
  let out = text;
  if (backticks > 0) {
    out = out.replace(/`/g, "");
    warnings.push(`removed ${backticks} backtick(s); X does not render Markdown`);
  }
  let boldLines = 0;
  out = out
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)\*\*(.*)$/);
      if (!m) return line;
      boldLines++;
      // Drop the opening ** and the closing ** that pairs with it on the same line.
      return `${m[1]}${m[2]!.replace(/\*\*/, "")}`;
    })
    .join("\n");
  if (boldLines > 0) {
    warnings.push(`removed line-leading ** bold on ${boldLines} line(s); X does not render Markdown`);
  }
  return { text: out, warnings };
}

function loadMediaPaths(): string[] {
  const raw = process.env.POST_MEDIA?.trim();
  if (!raw) return [];
  const paths = raw.split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`POST_MEDIA file missing: ${p}`);
  }
  return paths;
}

async function main(): Promise<void> {
  const cleaned = stripMarkdownForX(loadText());
  for (const w of cleaned.warnings) console.warn(`::warning::${w}`);
  const parts = splitThreadParts(cleaned.text);
  assertRootTweetHasNoLinks(parts[0]!);
  const mediaPaths = loadMediaPaths();
  const mediaIds = mediaPaths.length > 0 ? await uploadMedia(mediaPaths) : [];
  let previousId: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const attach = i === 0 && mediaIds.length > 0 ? mediaIds : undefined;
    const id = await postTweet(part, previousId, attach);
    ids.push(id);
    console.log(
      `posted ${id}${previousId ? ` (reply to ${previousId})` : ""}${attach ? ` media=${attach.length}` : ""}`,
    );
    previousId = id;
  }
  if (ids.length > 1) {
    console.log(`thread root ${ids[0]} parts ${ids.length}`);
  }
}

if (import.meta.main) {
  await main();
}
