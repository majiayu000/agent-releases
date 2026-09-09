/**
 * Chinese X-post drafting via Anthropic Messages-compatible HTTP
 * (Zhipu BigModel gateway by default).
 */
import type { Release } from "./sources/types.ts";
import { PRODUCT_NAME, PRODUCT_TAG } from "./sources/types.ts";
import { pickBullets } from "./filter.ts";

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/anthropic";
/** Default BigModel draft model (override with DRAFT_MODEL). */
export const DEFAULT_MODEL = "glm-5.3-flash";
const TIMEOUT_MS = Number(process.env.DRAFT_TIMEOUT_MS) || 60_000;

export function isLlmDraftConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function draftModelId(): string {
  return process.env.DRAFT_MODEL?.trim() || DEFAULT_MODEL;
}

function baseUrl(): string {
  const raw = process.env.ANTHROPIC_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function buildPrompt(release: Release): string {
  const tag = PRODUCT_TAG[release.product];
  const name = PRODUCT_NAME[release.product];
  const header = `${tag}${name} ${release.displayVersion} 出了（非官方）`;
  const bullets = pickBullets(release.notes, 5);
  const notesBlock =
    bullets.length > 0
      ? bullets.map((b, i) => `${i + 1}. ${b}`).join("\n")
      : release.notes.slice(0, 2500);

  return `你是发版情报整理助手。根据下方英文发版说明，写一条完整的中文 X（Twitter）帖文。

硬性格式：
1. 第一行必须是这个标题（一字不差）：
${header}
2. 空一行后，写 1～3 条要点，每行以「• 」开头（实心圆点+空格），用完整中文短句。
3. 保留说明里的反引号代码词（如 \`--plugin-dir\`），不要翻译代码标识符。
4. 不要编造说明里没有的功能；优先概括 Added / Changed / Improved，少写 Fixed。
5. 最后一行单独放发布链接（不要加任何前后缀）：
${release.url}
6. 全文不要残留英文句子；专有名词与反引号内代码可保留英文。
7. 全文按 X 加权长度约 280（中文/非 ASCII≈2，链接≈23）；尽量短。

只输出帖文正文，不要解释、不要 markdown 代码块。

发版说明摘录：
${notesBlock}`;
}

type AnthropicContentBlock = { type?: string; text?: string };
type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[] | string;
  error?: { message?: string; type?: string };
};

function extractText(data: AnthropicMessageResponse): string {
  if (typeof data.content === "string") return data.content.trim();
  if (!Array.isArray(data.content)) return "";
  return data.content
    .filter((b) => (b.type === "text" || !b.type) && typeof b.text === "string")
    .map((b) => b.text!)
    .join("")
    .trim();
}

/**
 * Call Messages API; throws on HTTP/timeout/empty. Caller handles fallback.
 */
export async function draftChinesePostWithLlm(release: Release): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY unset");

  const model = draftModelId();
  const url = `${baseUrl()}/v1/messages`;
  console.log(`[draft-llm] model=${model} timeoutMs=${TIMEOUT_MS} url=${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{ role: "user", content: buildPrompt(release) }],
      }),
      signal: controller.signal,
    });

    const raw = await res.text();
    let data: AnthropicMessageResponse;
    try {
      data = JSON.parse(raw) as AnthropicMessageResponse;
    } catch {
      throw new Error(`non-JSON response status=${res.status}`);
    }

    if (!res.ok) {
      const msg = data.error?.message || raw.slice(0, 200);
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }

    const text = extractText(data);
    if (!text) throw new Error("empty content");
    return text.replace(/\r\n/g, "\n").trim();
  } finally {
    clearTimeout(timer);
  }
}
