import { describe, expect, test } from "bun:test";
import { assertRootTweetHasNoLinks, splitThreadParts, stripMarkdownForX } from "./post-once.ts";

describe("stripMarkdownForX", () => {
  test("removes backticks but keeps the inner text", () => {
    const { text, warnings } = stripMarkdownForX(
      "• 新小模型 `claude-haiku-5-5`\n• 在 `/model` 里看 Haiku",
    );
    expect(text).toBe("• 新小模型 claude-haiku-5-5\n• 在 /model 里看 Haiku");
    expect(text).not.toContain("`");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("4 backtick");
  });

  test("removes line-leading ** bold markers", () => {
    const { text, warnings } = stripMarkdownForX("**要点：**\n\n  **谁受影响**：Max 用户\n正文 **不动** 行内");
    expect(text).toBe("要点：\n\n  谁受影响：Max 用户\n正文 **不动** 行内");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2 line(s)");
  });

  test("clean text passes through unchanged with no warnings", () => {
    const body = "【Claude】标题\n\n要点：\n\n• 第一条\n---\n官方：https://example.com";
    expect(stripMarkdownForX(body)).toEqual({ text: body, warnings: [] });
  });

  test("cleaned dig file still splits and keeps root link-free", () => {
    const { text } = stripMarkdownForX("【Claude】`x`\n---\n官方：https://example.com");
    const parts = splitThreadParts(text);
    expect(parts).toEqual(["【Claude】x", "官方：https://example.com"]);
    expect(() => assertRootTweetHasNoLinks(parts[0]!)).not.toThrow();
  });
});
