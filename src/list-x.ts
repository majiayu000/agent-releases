/**
 * One-shot: print @agentreleases profile + recent tweets (uses X OAuth secrets).
 * Usage: bun run src/list-x.ts
 */
import { TwitterApi } from "twitter-api-v2";

const missing = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"].filter(
  (k) => !process.env[k]?.trim(),
);
if (missing.length) {
  console.error("missing env:", missing.join(", "));
  process.exit(1);
}

const client = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
});

const me = await client.v2.me({
  "user.fields": ["public_metrics", "description", "created_at", "username", "name"],
});
console.log("=== profile ===");
console.log(JSON.stringify(me.data, null, 2));

const tl = await client.v2.userTimeline(me.data.id, {
  max_results: 10,
  exclude: ["retweets", "replies"],
  "tweet.fields": ["created_at", "text", "public_metrics"],
});
console.log("=== recent tweets ===");
const rows = tl.data.data ?? [];
if (!rows.length) console.log("(none)");
for (const t of rows) {
  console.log("---");
  console.log(t.created_at, t.id);
  console.log(t.text);
  console.log("metrics", JSON.stringify(t.public_metrics));
}
