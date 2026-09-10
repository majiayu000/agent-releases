// This command is deliberately read-only. Formal posts go through reserved publication.
const text = process.env.TEST_TWEET_TEXT?.trim();
if (!text) throw new Error("TEST_TWEET_TEXT required for preview");
console.log("PREVIEW ONLY — no X request, no publication state change\n" + text);
