import { TwitterApi } from "twitter-api-v2";
import { weightedXLength, X_WEIGHTED_LIMIT } from "./x-length.ts";

export async function postTweet(text: string): Promise<string> {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error("Missing X OAuth 1.0a secrets");
  }

  const w = weightedXLength(text);
  if (w > X_WEIGHTED_LIMIT) {
    console.warn(
      `[twitter] weighted length ${w} > ${X_WEIGHTED_LIMIT}; post may be rejected by X`,
    );
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
