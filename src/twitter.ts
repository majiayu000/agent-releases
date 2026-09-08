import { TwitterApi } from "twitter-api-v2";

export async function postTweet(text: string): Promise<string> {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error("Missing X OAuth 1.0a secrets");
  }
  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });
  const { data } = await client.v2.tweet(text);
  return data.id;
}
