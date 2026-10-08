import { describe, expect, test } from "bun:test";
import { stripMarkdownForX } from "./x-markdown.ts";
import { stripMarkdownForX as fromPostOnce } from "./post-once.ts";

describe("shared stripMarkdownForX", () => {
  test("post-once re-exports the shared implementation", () => {
    expect(fromPostOnce).toBe(stripMarkdownForX);
  });

  test("radar-style draft loses every backtick but keeps identifiers", () => {
    const { text, warnings } = stripMarkdownForX("🟣🚀 【Claude】Claude Code 2.1.294 发布\n\n🔧 修复 `PreToolUse` hooks 在 `--print` 下不触发");
    expect(text).toBe("🟣🚀 【Claude】Claude Code 2.1.294 发布\n\n🔧 修复 PreToolUse hooks 在 --print 下不触发");
    expect(warnings).toEqual(["removed 4 backtick(s); X does not render Markdown"]);
  });
});
