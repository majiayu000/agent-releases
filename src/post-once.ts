import { readFileSync } from "node:fs";
import { postTweet } from "./twitter.ts";

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
function splitThreadParts(body: string): string[] {
  const parts = body
    .split(/\r?\n---\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error("POST body empty after thread split");
  return parts;
}

const parts = splitThreadParts(loadText());
let previousId: string | undefined;
const ids: string[] = [];
for (const part of parts) {
  const id = await postTweet(part, previousId);
  ids.push(id);
  console.log(`posted ${id}${previousId ? ` (reply to ${previousId})` : ""}`);
  previousId = id;
}
if (ids.length > 1) {
  console.log(`thread root ${ids[0]} parts ${ids.length}`);
}
