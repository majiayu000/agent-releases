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

const text = loadText();
const id = await postTweet(text);
console.log(`posted ${id}`);
