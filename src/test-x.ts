import { postTweet } from "./twitter.ts";

const text =
  process.env.TEST_TWEET_TEXT ||
  "【测试】Agent Releases 管道连通检查（非官方）· 可忽略/删除";

const id = await postTweet(text);
console.log("posted tweet id:", id);
