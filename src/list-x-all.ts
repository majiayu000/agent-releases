import { TwitterApi } from "twitter-api-v2";

const client = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
});

const me = await client.v2.me({
  "user.fields": ["public_metrics", "username"],
});
console.log("username", me.data.username);
console.log("public_metrics", JSON.stringify(me.data.public_metrics));

type Row = {
  id: string;
  created_at?: string;
  text: string;
  referenced_tweets?: { type: string; id: string }[];
};

const rows: Row[] = [];
let token: string | undefined;
do {
  const tl = await client.v2.userTimeline(me.data.id, {
    max_results: 100,
    // no exclude — include replies + retweets
    "tweet.fields": ["created_at", "text", "referenced_tweets", "public_metrics"],
    ...(token ? { pagination_token: token } : {}),
  });
  for (const t of tl.data.data ?? []) rows.push(t as Row);
  token = tl.meta.next_token;
  console.log(`fetched page size=${tl.data.data?.length ?? 0} total=${rows.length} next=${Boolean(token)}`);
} while (token && rows.length < 300);

console.log(`=== ALL tweets returned by API: ${rows.length} ===`);
let i = 0;
for (const t of rows) {
  i++;
  const refs = (t.referenced_tweets ?? []).map((r) => r.type).join(",") || "original";
  const first = t.text.replace(/\n/g, " ⏎ ").slice(0, 120);
  console.log(`${String(i).padStart(2, "0")}. ${t.created_at} ${t.id} [${refs}] ${first}`);
}
