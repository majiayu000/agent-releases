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
const TIMEOUT_MS = Number(process.env.DRAFT_TIMEOUT_MS) || 120_000;
/** API requires max_tokens; high enough for GLM thinking + short post; override with DRAFT_MAX_TOKENS (32768 ok if timeout allows). */
const MAX_TOKENS = Number(process.env.DRAFT_MAX_TOKENS) || 4_096;
/**
 * GLM-5.3 / glm-5.3-flash always think; "disabled" → HTTP 400.
 * Use low effort so thinking does not eat the whole max_tokens budget.
 */
const REASONING_EFFORT =
  (process.env.DRAFT_REASONING_EFFORT?.trim() || "low") as string;

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
  const header = `${tag}${name} ${release.displayVersion} 发布`;
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

type AnthropicContentBlock = {
  type?: string;
  text?: string;
  /** Anthropic / GLM thinking block body (not the post). */
  thinking?: string;
  /** Some gateways nest text under content. */
  content?: string;
};

type AnthropicMessageResponse = {
  content?: AnthropicContentBlock[] | string;
  stop_reason?: string;
  error?: { message?: string; type?: string };
};

/** Log block types + lengths only (no API key, no thinking/post body). */
function logContentShape(data: AnthropicMessageResponse): void {
  const stop = data.stop_reason ?? "?";
  if (typeof data.content === "string") {
    console.log(
      `[draft-llm] content=string len=${data.content.length} stop_reason=${stop}`,
    );
    return;
  }
  if (!Array.isArray(data.content)) {
    console.log(
      `[draft-llm] content=${data.content === null || data.content === undefined ? String(data.content) : typeof data.content} stop_reason=${stop}`,
    );
    return;
  }
  const summary = data.content.map((b, i) => {
    const t = b?.type ?? "(no-type)";
    const textLen =
      typeof b?.text === "string"
        ? b.text.length
        : typeof b?.content === "string"
          ? b.content.length
          : 0;
    const thinkLen = typeof b?.thinking === "string" ? b.thinking.length : 0;
    return `#${i}:${t}/text=${textLen}/thinking=${thinkLen}`;
  });
  console.log(
    `[draft-llm] blocks=${data.content.length} [${summary.join(", ")}] stop_reason=${stop}`,
  );
}

/**
 * Extract assistant *post* text. Ignore thinking/reasoning blocks — GLM-5.3-flash
 * often returns thinking-first; if max_tokens is tight, text can be empty.
 */
function extractText(data: AnthropicMessageResponse): string {
  if (typeof data.content === "string") return data.content.trim();
  if (!Array.isArray(data.content)) return "";

  const parts: string[] = [];
  for (const b of data.content) {
    if (!b || typeof b !== "object") continue;
    const t = b.type ?? "";
    // Never treat thinking / redacted_thinking as the tweet body.
    if (t === "thinking" || t === "redacted_thinking" || t === "reasoning") {
      continue;
    }
    if (typeof b.text === "string" && b.text.trim()) {
      // Prefer explicit text blocks; also accept untyped blocks with .text
      if (t === "text" || t === "" || !t) parts.push(b.text);
      else if (t !== "tool_use" && t !== "tool_result") parts.push(b.text);
    } else if (typeof b.content === "string" && b.content.trim() && t === "text") {
      parts.push(b.content);
    }
  }
  return parts.join("").trim();
}

/**
 * Call Messages API; throws on HTTP/timeout/empty. Caller handles fallback.
 */
export async function draftChinesePostWithLlm(release: Release): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY unset");

  const model = draftModelId();
  const url = `${baseUrl()}/v1/messages`;
  console.log(
    `[draft-llm] model=${model} timeoutMs=${TIMEOUT_MS} max_tokens=${MAX_TOKENS} reasoning_effort=${REASONING_EFFORT} url=${url}`,
  );

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
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        // GLM-5.3-Flash always thinks; sending thinking.disabled → HTTP 400.
        // Explicit thinking.enabled + reasoning_effort=low hung 120s on Actions;
        // omit by default (fast path ~30s). Opt in with DRAFT_THINKING=on (+ DRAFT_REASONING_EFFORT).
        ...(process.env.DRAFT_THINKING?.trim().toLowerCase() === "on"
          ? {
              thinking: { type: "enabled" as const },
              reasoning_effort: REASONING_EFFORT,
            }
          : {}),
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

    logContentShape(data);
    const text = extractText(data);
    if (!text) {
      throw new Error(
        `empty content (stop_reason=${data.stop_reason ?? "?"}; thinking may have consumed max_tokens)`,
      );
    }
    return text.replace(/\r\n/g, "\n").trim();
  } finally {
    clearTimeout(timer);
  }
}
