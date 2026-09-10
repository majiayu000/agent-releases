import { TwitterApi, type TweetV2PostTweetResult } from "twitter-api-v2";

const X_REQUEST_TIMEOUT_MS = 30_000;

export function assertXCredentials(): void {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error("Missing X OAuth 1.0a secrets");
  }
}

export async function postTweet(text: string): Promise<string> {
  assertXCredentials();
  const appKey = process.env.X_API_KEY!;
  const appSecret = process.env.X_API_SECRET!;
  const accessToken = process.env.X_ACCESS_TOKEN!;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET!;

  const client = new TwitterApi({
    appKey,
    appSecret,
    accessToken,
    accessSecret,
  });
  // SDK request timeout. A timeout is an unknown X outcome: pending stays, no auto-retry.
  const posted = await client.v2.post<TweetV2PostTweetResult>("tweets", { text }, { timeout: X_REQUEST_TIMEOUT_MS });
  return posted.data.id;
}
