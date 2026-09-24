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
  const parts = splitThreadParts(loadText());
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
