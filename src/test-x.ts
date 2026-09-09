import { postTweet } from "./twitter.ts";

/** workflow_dispatch `text` input lands in TEST_TWEET_TEXT for manual repost. */
const text =
  (process.env.TEST_TWEET_TEXT || "").trim() ||
  "【测试】Agent Releases 管道连通检查（非官方）· 可忽略/删除";

const id = await postTweet(text);
console.log("posted tweet id:", id);
