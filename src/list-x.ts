/**
 * Print @agentreleases profile + recent tweets; flag version duplicates.
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

type Row = {
  id: string;
  created_at?: string;
  text: string;
  public_metrics?: { impression_count?: number };
};

const rows: Row[] = [];
let token: string | undefined;
do {
  const tl = await client.v2.userTimeline(me.data.id, {
    max_results: 100,
    exclude: ["retweets", "replies"],
    "tweet.fields": ["created_at", "text", "public_metrics"],
    ...(token ? { pagination_token: token } : {}),
  });
  for (const t of tl.data.data ?? []) rows.push(t as Row);
  token = tl.meta.next_token;
} while (token && rows.length < 200);

console.log(`=== recent tweets (${rows.length}) ===`);
const byKey = new Map<string, Row[]>();
for (const t of rows) {
  console.log("---");
  console.log(t.created_at, t.id);
  console.log(t.text.slice(0, 280));
  console.log("metrics", JSON.stringify(t.public_metrics));
  const m2 = t.text.match(/【(Claude|Codex|Grok)】[\s\S]*?(\d+\.\d+\.\d+|rust-v[\d.]+)/);
  const key = m2 ? `${m2[1]}:${m2[2]}` : `other:${t.id}`;
  const arr = byKey.get(key) ?? [];
  arr.push(t);
  byKey.set(key, arr);
}

console.log("=== duplicate analysis ===");
let dupGroups = 0;
for (const [key, arr] of byKey) {
  if (key.startsWith("other:")) continue;
  if (arr.length < 2) continue;
  dupGroups++;
  console.log(`DUP ${key} count=${arr.length}`);
  for (const t of arr) {
    const line = (t.text.split("\n")[0] ?? "").slice(0, 80);
    console.log(
      `  ${t.id} imp=${t.public_metrics?.impression_count ?? "?"} ${t.created_at} ${line}`,
    );
  }
}
if (!dupGroups) console.log("NO_VERSION_DUPLICATES among listed tweets");

const deleted = ["2097850006208233749", "2097783019860074831", "2097821154090390002"];
console.log("=== deleted-id check ===");
for (const id of deleted) {
  const hit = rows.find((t) => t.id === id);
  console.log(id, hit ? "STILL_PRESENT" : "GONE");
}
