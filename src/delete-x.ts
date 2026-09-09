import { TwitterApi } from "twitter-api-v2";

const id = process.env.TWEET_ID;
if (!id) throw new Error("TWEET_ID required");

const client = new TwitterApi({
  appKey: process.env.X_API_KEY!,
  appSecret: process.env.X_API_SECRET!,
  accessToken: process.env.X_ACCESS_TOKEN!,
  accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
});

await client.v2.deleteTweet(id);
console.log("deleted", id);
