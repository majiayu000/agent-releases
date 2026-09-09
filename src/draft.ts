import type { Release } from "./sources/types.ts";
import { PRODUCT_NAME, PRODUCT_TAG } from "./sources/types.ts";
import { pickBullets } from "./filter.ts";
import { isLlmDraftConfigured, draftChinesePostWithLlm } from "./draft-llm.ts";
import { trimPostToWeightedLimit, weightedXLength, X_WEIGHTED_LIMIT } from "./x-length.ts";

/** Leading changelog verbs → Chinese. */
const LEADING_VERBS: [RegExp, string][] = [
  [/^Added support for\b/i, "支持"],
  [/^Added\b/i, "新增"],
  [/^Improved\b/i, "改进"],
  [/^Fixed\b/i, "修复"],
  [/^Changed\b/i, "变更"],
  [/^Removed\b/i, "移除"],
  [/^Updated\b/i, "更新"],
  [/^Support for\b/i, "支持"],
  [/^Now supports\b/i, "现已支持"],
  [/^\[VSCode\]\s*Added\b/i, "[VS Code] 新增"],
  [/^\[VSCode\]\s*Fixed\b/i, "[VS Code] 修复"],
  [/^\[VSCode\]\s*Improved\b/i, "[VS Code] 改进"],
  [/^\[VSCode\]\s*Changed\b/i, "[VS Code] 变更"],
  [/^Windows:\s*Fixed\b/i, "Windows：修复"],
  [/^Windows:\s*Added\b/i, "Windows：新增"],
];

/**
 * Phrase table — longer / more specific first.
 * Only rewrite recognizable changelog English into Chinese clauses;
 * do NOT strip bare articles/prepositions (that creates word salad).
 */
const PHRASES: [RegExp, string][] = [
  [/\bClaude Desktop and Cowork\b/gi, "Claude Desktop 与 Cowork"],
  [/\bmatching terminal sessions\b/gi, "与终端会话对齐"],
  [/\bterminal sessions?\b/gi, "终端会话"],
  [/\bClaude apps gateway\b/gi, "Claude apps gateway"],
  [/\bto the telemetry\b/gi, "到遥测"],
  [/\btelemetry\b/gi, "遥测"],
  [/\bpointing\s+(@@\d+@@)\s+at\b/gi, "将 $1 指向"],
  [/\ba folder of plugins\b/gi, "插件目录"],
  [
    /\beach child folder with a manifest loads,?\s*and children added or removed while running are picked up/gi,
    "带清单的子目录会加载，运行中增减也会自动发现",
  ],
  [/\bplugin directories?\b/gi, "插件目录"],
  [/\bplugin path\b/gi, "插件路径"],
  [/\bcap on tool results saved to disk\b/gi, "工具结果落盘上限"],
  [/\btool results?\b/gi, "工具结果"],
  [/\bsaved to disk\b/gi, "落盘"],
  [/\bin-conversation preview\b/gi, "会话内预览"],
  [/\bsays when a saved file was truncated\b/gi, "会提示文件被截断"],
  [/\bwas truncated\b/gi, "被截断"],
  [/\blarge repositories\b/gi, "大型仓库"],
  [/\bchecked out in parallel\b/gi, "并行检出"],
  [/\bin parallel\b/gi, "并行"],
  [/\bworking tree\b/gi, "工作树"],
  [/\bworktree\b/gi, "worktree"],
  [/\bforeground-spawned subagent\b/gi, "前台启动的子代理"],
  [/\bresumed subagents?\b/gi, "已恢复的子代理"],
  [/\bsubagents?\b/gi, "子代理"],
  [/\bprompt-cache reuse\b/gi, "提示缓存复用"],
  [/\bprompt cache\b/gi, "提示缓存"],
  [/\bprompt prefix\b/gi, "提示前缀"],
  [/\bsystem prompt\b/gi, "系统提示"],
  [/\bhook context\b/gi, "hook 上下文"],
  [/\bpermission prompts?\b/gi, "权限提示"],
  [/\bpermission\b/gi, "权限"],
  [/\bpreloaded skills?\b/gi, "预加载技能"],
  [/\bRemote Control\b/gi, "Remote Control"],
  [/\bVS Code\b/g, "VS Code"],
  [/\b\[VSCode\]\b/gi, "[VS Code]"],
  [/\bSDK sessions?\b/gi, "SDK 会话"],
  [/\bMCP servers?\b/gi, "MCP 服务器"],
  [/\bOAuth client\b/gi, "OAuth 客户端"],
  [/\bidle timeout\b/gi, "空闲超时"],
  [/\bbundled model picker\b/gi, "内置模型选择器"],
  [/\bmodel picker\b/gi, "模型选择器"],
  [/\basynchronous questions?\b/gi, "异步提问"],
  [/\btool is available\b/gi, "工具可用"],
  [/\bgateway\b/gi, "gateway"],
  [/\bresume(?:d|ing)?\b/gi, "恢复"],
  [/\byou can\b/gi, "可以"],
  [/\blets you\b/gi, "让你可以"],
  [/\bno longer\b/gi, "不再"],
  [/\binstead of\b/gi, "而不是"],
  [/\brather than\b/gi, "而不是"],
];

const BT_RE = /`([^`]+)`/g;

function protectBackticks(s: string): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const text = s.replace(BT_RE, (_m, inner: string) => {
    const i = tokens.length;
    tokens.push("`" + inner + "`");
    return `@@${i}@@`;
  });
  return { text, tokens };
}

function restoreBackticks(s: string, tokens: string[]): string {
  return s.replace(/@@(\d+)@@/g, (_m, i) => tokens[Number(i)] ?? "");
}

function extractBacktickTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(BT_RE)) out.push("`" + m[1] + "`");
  return out;
}

function leadingVerbZh(english: string): string {
  for (const [re, zh] of LEADING_VERBS) {
    if (re.test(english.trim())) return zh;
  }
  return "更新";
}

/**
 * Targeted readable rewrites for common Claude changelog shapes.
 * Returns null to fall through to phrase-table + guard.
 */
function rewriteKnownShapes(english: string): string | null {
  const e = english.trim();

  // Added `user.email` and `user.groups` to the telemetry …
  {
    const m = e.match(
      /^Added\s+(`[^`]+`)\s+and\s+(`[^`]+`)\s+to the telemetry\b[\s\S]*$/i,
    );
    if (m) {
      return `新增遥测字段 ${m[1]}、${m[2]}（Claude Desktop / Cowork 经 Claude apps gateway 上报，与终端会话对齐）`;
    }
  }

  // Added support for pointing `--plugin-dir` at a folder of plugins: …
  {
    const m = e.match(
      /^Added support for pointing\s+(`[^`]+`|--plugin-dir)\s+at a folder of plugins:?[\s\S]*$/i,
    );
    if (m) {
      const flag = m[1].startsWith("`") ? m[1] : "`" + m[1] + "`";
      return `支持将 ${flag} 指向插件目录：带清单的子目录会加载，运行中增减也会自动发现`;
    }
  }

  // Added a 1 GB cap on tool results saved to disk; …
  {
    const m = e.match(
      /^Added an?\s+(\d+\s*GB)\s+cap on tool results saved to disk[\s\S]*$/i,
    );
    if (m) {
      return `新增工具结果落盘上限 ${m[1]}；会话内预览会提示文件被截断`;
    }
  }

  // Improved `--worktree` startup on large repositories …
  if (/^Improved\b/i.test(e) && /worktree/i.test(e) && /parallel|large/i.test(e)) {
    return "改进大型仓库下 `--worktree` 启动：新 worktree 可并行检出（git 2.32+）";
  }

  // [VSCode] Added automatic archiving of sessions inactive …
  if (/\[VSCode\].*archiv.*inactive sessions/i.test(e)) {
    return "[VS Code] 新增自动归档闲置会话（「Archive inactive sessions」，默认 14 天）";
  }

  // Improved slash commands …
  if (/^Improved slash commands\b/i.test(e)) {
    return "改进斜杠命令：输入中可显示匹配列表，插件技能可用短名查找";
  }

  // Improved the time to resume long sessions …
  if (/^Improved the time to resume\b/i.test(e)) {
    return "改进读取大量文件的长会话恢复速度";
  }

  // Changed … gateway … OpenTelemetry …
  if (/^Changed\b/i.test(e) && /gateway/i.test(e) && /OpenTelemetry|OTEL_/i.test(e)) {
    const toks = extractBacktickTokens(e);
    const extra = toks[0] ? `（${toks[0]}）` : "";
    return `变更 Claude apps gateway 会话：可直接向托管设置中的 collector 导出 OpenTelemetry${extra}`;
  }

  // Fixed resume / prompt-cache family — short Chinese
  if (/^Fixed\b/i.test(e) && /prompt-cache|subagent|resume/i.test(e)) {
    const toks = extractBacktickTokens(e);
    const extra = toks.length ? " " + toks.slice(0, 2).join(" ") : "";
    return `修复恢复/子代理相关提示缓存问题${extra}`.trim();
  }

  // Codex hotfix: Fixed Astra visibility / bundled model picker
  if (/^Fixed\b/i.test(e) && /\bAstra\b/i.test(e) && /model picker/i.test(e)) {
    return "修复 Astra 在内置模型选择器中的可见性，未显式配置模型时设为默认";
  }

  // Codex hotfix: Updated Astra async-question guidance by tool availability
  if (
    /^Updated\b/i.test(e) &&
    /\bAstra\b/i.test(e) &&
    /asynchronous questions?/i.test(e)
  ) {
    return "更新 Astra 指引：仅在会话提供该工具时使用异步提问";
  }

  return null;
}

function applyPhraseTable(s: string): string {
  let out = s;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);
  return out;
}

/**
 * Max run of Latin letters outside backticks, allowing spaces/hyphens
 * inside an English clause so "to the telemetry … pointing" still trips.
 * Shared with LLM draft validation.
 */
export function maxLatinRunOutsideBackticks(s: string): number {
  const stripped = s.replace(BT_RE, "§");
  let max = 0;
  let cur = 0;
  let inLatin = false;
  for (const ch of stripped) {
    if (/[A-Za-z]/.test(ch)) {
      cur++;
      inLatin = true;
      if (cur > max) max = cur;
    } else if (inLatin && (ch === " " || ch === "-" || ch === "'" || ch === ",")) {
      continue;
    } else {
      cur = 0;
      inLatin = false;
    }
  }
  return max;
}

function guardRewrite(originalEnglish: string, attempted: string): string {
  if (maxLatinRunOutsideBackticks(attempted) <= 40) return attempted;
  const verb = leadingVerbZh(originalEnglish);
  const toks = extractBacktickTokens(originalEnglish);
  const tokPart = toks.length > 0 ? " " + toks.slice(0, 4).join(" ") : "";
  return `${verb}${tokPart}「详见发版说明」`.replace(/\s+/g, " ").trim();
}

function cleanupZh(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([，。；：、）》」…])/g, "$1")
    .replace(/([（「《])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,:;\-\s]+/, "")
    .trim();
}

function toChineseBullet(english: string): string {
  const known = rewriteKnownShapes(english);
  if (known) return cleanupZh(guardRewrite(english, known));

  const { text: protected_, tokens } = protectBackticks(english.trim());
  let work = protected_;
  let verbZh = "";
  for (const [re, zh] of LEADING_VERBS) {
    if (re.test(work)) {
      verbZh = zh;
      work = work.replace(re, "").trim();
      break;
    }
  }

  work = applyPhraseTable(work);
  work = restoreBackticks(work, tokens);
  work = cleanupZh(verbZh ? `${verbZh} ${work}` : work);

  if (work.length > 100) work = work.slice(0, 97) + "…";
  return cleanupZh(guardRewrite(english, work));
}

function isFixedOnlyBullet(s: string): boolean {
  const t = s.trim();
  return /^(修复|Fixed|Fix)\b/i.test(t) || /^\[VS Code\]\s*修复\b/.test(t);
}

/** Rule-based Chinese draft (no LLM). */
export function draftChinesePostRuleBased(release: Release): string {
  const tag = PRODUCT_TAG[release.product];
  const name = PRODUCT_NAME[release.product];
  const header = `${tag}${name} ${release.displayVersion} 出了（非官方）`;

  let raw = pickBullets(release.notes, 3);
  if (raw.length === 0) {
    raw = release.notes
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, 3);
  }

  let bullets = raw.map(toChineseBullet);

  // Drop trailing Fixed-only noise when pickBullets already preferred features
  const featureish = bullets.filter((b) => !isFixedOnlyBullet(b));
  if (featureish.length > 0 && featureish.length < bullets.length) {
    bullets = featureish.slice(0, 3);
  }

  if (bullets.length === 0) {
    bullets = ["详见发版说明（非官方整理）"];
  }

  const post = `${header}\n\n${bullets.map((b) => `• ${b}`).join("\n")}\n\n${release.url}`;
  return trimPostToWeightedLimit(post, X_WEIGHTED_LIMIT);
}


function validateLlmDraft(text: string, release: Release): string | null {
  const tag = PRODUCT_TAG[release.product];
  const name = PRODUCT_NAME[release.product];
  const headerHint = `${tag}${name} ${release.displayVersion}`;
  const hasHeader =
    text.includes(headerHint) ||
    (text.includes(tag) && text.includes(release.displayVersion));
  if (!hasHeader) return "missing product version/header tag";
  if (!text.includes(release.url)) return "missing release.url";
  if (maxLatinRunOutsideBackticks(text) > 40) return "long English run";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return "too few lines";
  return null;
}

/**
 * Prefer LLM Chinese draft when ANTHROPIC_API_KEY is set;
 * on any failure/timeout/bad shape, fall back to rule-based path.
 */
export async function draftChinesePost(release: Release): Promise<string> {
  if (!isLlmDraftConfigured()) {
    return draftChinesePostRuleBased(release);
  }
  try {
    const llm = await draftChinesePostWithLlm(release);
    const reason = validateLlmDraft(llm, release);
    if (reason) {
      console.warn(`[draft-llm] fallback: ${reason}`);
      return draftChinesePostRuleBased(release);
    }
    const trimmed = trimPostToWeightedLimit(llm, X_WEIGHTED_LIMIT);
    if (trimmed !== llm) {
      console.log(
        `[draft-llm] trimmed weighted length ${weightedXLength(llm)} -> ${weightedXLength(trimmed)}`,
      );
    }
    return trimmed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[draft-llm] fallback: ${msg}`);
    return draftChinesePostRuleBased(release);
  }
}

/** Exported for self-check / fixtures. */
export function draftChineseBulletsForNotes(notes: string): string[] {
  return pickBullets(notes, 3).map(toChineseBullet);
}
