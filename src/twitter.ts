import { readFileSync } from "node:fs";
import { TwitterApi, type TweetV2PostTweetResult } from "twitter-api-v2";

const X_REQUEST_TIMEOUT_MS = 30_000;
const MAX_MEDIA = 4;
const MAX_BYTES = 5 * 1024 * 1024;

export function assertXCredentials(): void {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_TOKEN_SECRET;
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    throw new Error("Missing X OAuth 1.0a secrets");
  }
}

function client(): TwitterApi {
  assertXCredentials();
  return new TwitterApi({
    appKey: process.env.X_API_KEY!,
    appSecret: process.env.X_API_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  });
}

/** Upload local image files; returns media_ids for v2 tweets.create. Max 4, each ≤5MB. */
export async function uploadMedia(paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  if (paths.length > MAX_MEDIA) {
    throw new Error(`Too many media files (max ${MAX_MEDIA})`);
  }
  const tw = client();
  const ids: string[] = [];
  for (const p of paths) {
    const buf = readFileSync(p);
    if (buf.byteLength > MAX_BYTES) {
      throw new Error(`Media too large (>5MB): ${p}`);
    }
    const mime =
      p.toLowerCase().endsWith(".png") ? "image/png" :
      p.toLowerCase().endsWith(".webp") ? "image/webp" :
      p.toLowerCase().endsWith(".gif") ? "image/gif" :
      "image/jpeg";
    const mediaId = await tw.v1.uploadMedia(buf, { mimeType: mime });
    ids.push(mediaId);
  }
  return ids;
}

export async function postTweet(
  text: string,
  replyToId?: string,
  mediaIds?: string[],
): Promise<string> {
  const tw = client();
  const body: {
    text: string;
    reply?: { in_reply_to_tweet_id: string };
    media?: { media_ids: string[] };
  } = { text };
  if (replyToId) {
    body.reply = { in_reply_to_tweet_id: replyToId };
  }
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  const posted = await tw.v2.post<TweetV2PostTweetResult>("tweets", body, {
    timeout: X_REQUEST_TIMEOUT_MS,
  });
  return posted.data.id;
}
