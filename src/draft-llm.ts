/**
 * Chinese X-post drafting via Anthropic Messages-compatible HTTP
 * (Zhipu BigModel gateway by default).
 */
import type { Release } from "./sources/types.ts";
import { pickBullets } from "./filter.ts";

const DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/anthropic";
/** Default BigModel draft model (override with DRAFT_MODEL). */
export const DEFAULT_MODEL = "glm-5.3-flash";
/**
 * GLM-5.3 / glm-5.3-flash always think; "disabled" → HTTP 400.
 * Use Messages API output_config.effort to request a short reasoning budget.
 */

function draftTimeoutMs(): number {
  return Number(process.env.DRAFT_TIMEOUT_MS) || 120_000;
}

function draftMaxTokens(): number {
  return Number(process.env.DRAFT_MAX_TOKENS) || 32_768;
}

function reasoningEffort(): string {
  return process.env.DRAFT_REASONING_EFFORT?.trim() || "low";
}

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
  const bullets = pickBullets(release.notes, 2);
  if (!bullets.length) throw new Error("No feature bullets available for Chinese drafting");
  return `把下面的版本更新概括成 ${bullets.length} 条简短的简体中文要点。
硬性格式：每行必须以「恰好一个语义表情 + 空格 + 中文」开头（例如 🔧 / 🌿 / 💬 / ⚙️），禁止叠两个表情如「🔧 🛠️」，禁止用「•」「-」「*」当行首。
每条用一句完整中文说明具体变化（能干什么），尽量不超过 30 个汉字。保留必要的反引号代码标识符，不添加原文没有的事实。
不要标题、链接、解释、hashtag 或省略号；禁止「详见发版说明」「见 changelog」等空壳占位。只输出要点正文。

${bullets.map(b => `- ${b}`).join("\n")}`;
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
 * Call Messages API; throws on HTTP/timeout/empty. Never substitute a template.
 */
export async function draftChinesePostWithLlm(release: Release): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY unset");

  const model = draftModelId();
  const url = `${baseUrl()}/v1/messages`;
  const thinking = process.env.DRAFT_THINKING?.trim().toLowerCase() === "on";
  const timeoutMs = draftTimeoutMs();
  const maxTokens = draftMaxTokens();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
        max_tokens: maxTokens,
        temperature: 0.3,
        // Messages API effort uses output_config, not the native chat-completions field.
        output_config: { effort: reasoningEffort() },
        // GLM-5.3-Flash always thinks; sending thinking.disabled → HTTP 400.
        // Effort is independent of thinking; leave explicit thinking opt-in.
        ...(thinking
          ? {
              thinking: { type: "enabled" as const },
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
    if (data.stop_reason !== "end_turn") {
      throw new Error(`Incomplete model response (stop_reason=${data.stop_reason ?? "missing"}); no post generated`);
    }
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
