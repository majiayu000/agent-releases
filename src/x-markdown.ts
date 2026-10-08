/**
 * X does not render Markdown: backticks and **bold** show up literally.
 * Strip every backtick (keep the inner text) and line-leading ** bold markers
 * instead of failing the post. Returns the cleaned text plus warnings to log.
 *
 * Shared by the one-shot dig poster (post-once.ts) and the version radar
 * (draft.ts validateChinesePost + twitter.ts postRootThenOfficialReply).
 */
export function stripMarkdownForX(text: string): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const backticks = text.match(/`/g)?.length ?? 0;
  let out = text;
  if (backticks > 0) {
    out = out.replace(/`/g, "");
    warnings.push(`removed ${backticks} backtick(s); X does not render Markdown`);
  }
  let boldLines = 0;
  out = out
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*)\*\*(.*)$/);
      if (!m) return line;
      boldLines++;
      // Drop the opening ** and the closing ** that pairs with it on the same line.
      return `${m[1]}${m[2]!.replace(/\*\*/, "")}`;
    })
    .join("\n");
  if (boldLines > 0) {
    warnings.push(`removed line-leading ** bold on ${boldLines} line(s); X does not render Markdown`);
  }
  return { text: out, warnings };
}

/** Strip Markdown and log each warning with a context label; never rejects. */
export function cleanForX(text: string, context: string): string {
  const { text: cleaned, warnings } = stripMarkdownForX(text);
  for (const w of warnings) console.warn(`[warn] ${context}: ${w}`);
  return cleaned;
}
