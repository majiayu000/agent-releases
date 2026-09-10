import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepare, publish, type Source } from "./index.ts";
import { appendLedger, dailyPostCount, hasPostedLive, pendingPosts, readLedger } from "./ledger.ts";
import { readState, writeState } from "./state.ts";
import { isNotable, pickBullets } from "./filter.ts";
import { draftChinesePost, validateChinesePost } from "./draft.ts";
import { fetchClaudeSince } from "./sources/claude.ts";
import { fetchCodexSince } from "./sources/codex.ts";
import type { Product, Release } from "./sources/types.ts";

const root = process.cwd();
const realFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;
const now = new Date("2026-09-10T06:00:00Z");
let dir: string;
const release = (product: Product = "claude", version = "2.0.0"): Release => ({
  product, version, displayVersion: version, title: version,
  notes: "- Added support for custom tools", url: "https://example.com/release/" + version,
});
const source = (product: Product = "claude", releases = [release(product)]): Source => ({
  product, fetchLatest: async () => releases.at(-1) ?? null,
  fetchSince: async version => releases.filter(r => r.version > version),
});
const draft = async () => "已经生成完整的中文正文";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-releases-test-"));
  process.chdir(dir);
  for (const product of ["claude", "codex", "grok_build"] as const) writeState(product, "1.0.0");
  writeFileSync(".state/posted.jsonl", "");
});
afterEach(() => {
  process.chdir(root);
  globalThis.fetch = realFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  rmSync(dir, { recursive: true, force: true });
});

describe("publication recovery", () => {
  test("preview leaves cursor and ledger untouched; live can still publish", async () => {
    await prepare(false, "preview", [source()], draft, now);
    expect(readState("claude")).toBe("1.0.0");
    expect(readLedger()).toEqual([]);
    const plan = await prepare(true, "live", [source()], draft, now);
    expect(plan.posts).toHaveLength(1);
    expect(readState("claude")).toBe("1.0.0");
    await publish(plan, async () => "123", () => now);
    expect(hasPostedLive("claude", "2.0.0")).toBe(true);
    expect(readState("claude")).toBe("2.0.0");
  });

  test("one failed product preserves successful post and blocks automatic retries", async () => {
    const plan = await prepare(true, "live", [source(), source("codex")], draft, now);
    let calls = 0;
    await expect(publish(plan, async () => {
      if (++calls === 2) throw new Error("response lost");
      return "123";
    }, () => now)).rejects.toThrow("Reconcile pending");
    expect(hasPostedLive("claude", "2.0.0")).toBe(true);
    expect(readState("claude")).toBe("2.0.0");
    expect(readState("codex")).toBe("1.0.0");
    expect(pendingPosts().map(p => p.product)).toEqual(["codex"]);
    await expect(prepare(true, "retry", [source(), source("codex")], draft, now)).rejects.toThrow("Unresolved");
    expect(calls).toBe(2);
  });

  test("process interruption after reservation cannot cause a fresh automatic post", async () => {
    await prepare(true, "interrupted", [source()], draft, now);
    await expect(prepare(true, "retry", [source()], draft, now)).rejects.toThrow("Unresolved");
  });

  test("cannot publish a plan without its reservation or replay a completed plan", async () => {
    const preview = await prepare(false, "preview", [source()], draft, now);
    let calls = 0;
    const send = async () => { calls++; return "123"; };
    await expect(publish(preview, send, () => now)).rejects.toThrow("Missing pending");
    const live = await prepare(true, "live", [source()], draft, now);
    await publish(live, send, () => now);
    await expect(publish(live, send, () => now)).rejects.toThrow("Missing pending");
    expect(calls).toBe(1);
  });

  test("draft failure never consumes versions or creates a reservation", async () => {
    await expect(prepare(true, "live", [source()], async () => { throw new Error("LLM empty"); }, now)).rejects.toThrow("LLM empty");
    expect(readState("claude")).toBe("1.0.0");
    expect(readLedger()).toEqual([]);
  });

  test("source failure cannot leave another product partially reserved", async () => {
    const broken = source("grok_build");
    broken.fetchSince = async () => { throw new Error("parse error"); };
    await expect(prepare(true, "live", [source(), broken], draft, now)).rejects.toThrow("parse error");
    expect(pendingPosts()).toEqual([]);
    expect(readState("claude")).toBe("1.0.0");
  });

  test("one release per product; cursor cannot jump over unpublished backlog", async () => {
    const list = [release("claude", "1.1.0"), release("claude", "1.2.0"), release("claude", "1.3.0")];
    list[0]!.notes = "- Fixed a crash";
    const plan = await prepare(true, "live", [source("claude", list)], draft, now);
    expect(readState("claude")).toBe("1.1.0");
    expect(plan.posts.map(p => p.release.version)).toEqual(["1.2.0"]);
    await publish(plan, async () => "123", () => now);
    expect(readState("claude")).toBe("1.2.0");
  });

  test("ledger prevents repost even after an operator rewinds the cursor", async () => {
    appendLedger({ ts: now.toISOString(), product: "claude", version: "2.0.0", tweetId: "123", dryRun: false });
    const plan = await prepare(true, "live", [source()], draft, now);
    expect(plan.posts).toEqual([]);
    expect(readState("claude")).toBe("2.0.0");
  });

  test("daily limit counts unique reserved/published versions and does not consume deferred versions", async () => {
    for (let i = 0; i < 5; i++) {
      appendLedger({ ts: now.toISOString(), product: "claude", version: `0.0.${i}`, runId: "old", dryRun: false });
      appendLedger({ ts: now.toISOString(), product: "claude", version: `0.0.${i}`, tweetId: String(i + 1), dryRun: false });
    }
    expect(dailyPostCount(now)).toBe(5);
    const plan = await prepare(true, "live", [source()], draft, now);
    expect(plan.posts).toEqual([]);
    expect(readState("claude")).toBe("1.0.0");
    expect(dailyPostCount(new Date("2026-09-10T16:01:00Z"))).toBe(0);
  });

  test("a plan crossing midnight is not sent under yesterday's quota", async () => {
    const plan = await prepare(true, "live", [source()], draft, now);
    await expect(publish(plan, async () => { throw new Error("must not call X"); }, () => new Date("2026-09-10T16:01:00Z"))).rejects.toThrow("daily boundary");
  });

  test("corrupt ledger and empty cursor fail closed", () => {
    writeFileSync(".state/posted.jsonl", "{broken\n");
    expect(readLedger).toThrow("Invalid posted.jsonl");
    writeFileSync(".state/posted.jsonl", '{"product":"claude","version":"2.0.0","dryRun":false}\n');
    expect(readLedger).toThrow("Invalid posted.jsonl entry");
    writeFileSync(".state/last_posted_claude.txt", "\n");
    expect(() => readState("claude")).toThrow("Empty state");
  });

  test("a rerun cannot re-enter the live CLI from an old reservation artifact", () => {
    const result = Bun.spawnSync(["bun", join(root, "src/index.ts"), "publish"], {
      cwd: dir,
      env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_RUN_ATTEMPT: "2" },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Never rerun a publication job");
  });

  test("preview seed writes no state", async () => {
    rmSync(".state/last_posted_claude.txt");
    await prepare(false, "preview", [source()], draft, now);
    expect(readState("claude")).toBe(null);
  });
});

describe("release content", () => {
  test("Fixed-only hints cannot masquerade as features", () => {
    expect(isNotable("- Fixed a crash in support for custom tools")).toBe(false);
    expect(isNotable("## Bug Fixes\n- Added a missing null check")).toBe(false);
    expect(isNotable("## Fixed\n- A crash when loading plugins")).toBe(false);
    expect(isNotable("- Windows: Fixed support for custom tools")).toBe(false);
    expect(() => isNotable("Unparseable release body")).toThrow("No structured");
    expect(isNotable("- Added new terminal support\n- Bug fixes and reliability improvements")).toBe(true);
    expect(pickBullets("- Fixed first crash\n- Fixed second crash\n- Fixed third crash\n- Added plugin discovery")).toEqual(["Added plugin discovery"]);
    expect(isNotable("## Changelog\n- #42874 Show model picker @author")).toBe(false);
    expect(() => isNotable("")).toThrow("Empty release notes");
  });

  test("actual failure shapes are rejected; complete Chinese and code identifiers survive", () => {
    const r = release();
    const wrap = (body: string) => `【Claude】Claude Code 2.0.0 发布\n\n${body}\n\n${r.url}`;
    expect(() => validateChinesePost(wrap("• 新增 `maxEffortLevel` setting (top-level or per model under `modelSettings`): caps the effort level…"), r)).toThrow();
    expect(() => validateChinesePost(wrap("• 更新「详见发版说明」"), r)).toThrow();
    expect(() => validateChinesePost(wrap("• " + "新增设置".repeat(100)), r)).toThrow("length limit");
    expect(() => validateChinesePost(wrap("• 新增 `broken 设置，支持限制最大努力等级"), r)).toThrow("incomplete code");
    expect(validateChinesePost(wrap("• 新增 `maxEffortLevel` 设置，可按模型限制努力等级上限"), r)).toContain("`maxEffortLevel`");
  });

  test("missing key and incomplete LLM responses never produce fallback posts", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(draftChinesePost(release())).rejects.toThrow("unset");
    process.env.ANTHROPIC_API_KEY = "test-not-a-secret";
    globalThis.fetch = (async () => Response.json({ stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "still thinking" }] })) as unknown as typeof fetch;
    await expect(draftChinesePost(release())).rejects.toThrow("Incomplete model response");
    globalThis.fetch = (async () => Response.json({ stop_reason: "end_turn", content: [] })) as unknown as typeof fetch;
    await expect(draftChinesePost(release())).rejects.toThrow("empty content");
  });

  test("Messages request sends effort in the compatible field and code owns header/link", async () => {
    process.env.ANTHROPIC_API_KEY = "test-not-a-secret";
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: RequestInfo | URL, options?: RequestInit) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: "• 新增自定义工具支持，方便扩展开发流程" }] });
    }) as unknown as typeof fetch;
    const result = await draftChinesePost(release());
    expect(body.output_config).toEqual({ effort: "low" });
    expect(body.reasoning_effort).toBeUndefined();
    expect(result).toStartWith("【Claude】Claude Code 2.0.0 发布");
    expect(result).toEndWith(release().url);
  });

  test("Claude API plus changelog outage is an error, not zero updates", async () => {
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchClaudeSince("1.0.0")).rejects.toThrow("503");
  });

  test("Claude partial pagination never advances across a missing page", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes("page=1")) return Response.json(Array.from({ length: 30 }, (_, i) => ({ tag_name: `v2.0.${i}`, body: "- Added complete release information for testing" })));
      return new Response("down", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(fetchClaudeSince("1.0.0")).rejects.toThrow();
  });

  test("Codex cannot return a partial page window as complete history", async () => {
    globalThis.fetch = (async () => Response.json(Array.from({ length: 30 }, (_, i) => ({ tag_name: `rust-v2.0.${i}`, body: "- Added custom tools" })))) as unknown as typeof fetch;
    await expect(fetchCodexSince("rust-v1.0.0")).rejects.toThrow("incomplete release history");
  });

  test("unrelated Codex tag cannot prematurely stop pagination", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json(calls === 1 ? [{ tag_name: "v0.1.0", body: "unrelated" }, ...Array.from({ length: 29 }, (_, i) => ({ tag_name: `rust-v2.0.${i}`, body: "- Added new tools" }))] : [{ tag_name: "rust-v1.0.0", body: "- Added old tools" }]);
    }) as unknown as typeof fetch;
    expect((await fetchCodexSince("rust-v1.0.0")).length).toBe(29);
    expect(calls).toBe(2);
  });
});


describe("durable Git checkpoint", () => {
  function git(...args: string[]): string {
    const result = Bun.spawnSync(["git", ...args], { cwd: dir });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  }
  function setup() {
    git("init", "-b", "main");
    git("config", "user.name", "Checkpoint Test");
    git("config", "user.email", "checkpoint@example.invalid");
    git("add", ".state");
    git("commit", "-m", "initial state");
    git("init", "--bare", "origin.git");
    git("remote", "add", "origin", join(dir, "origin.git"));
    git("push", "origin", "HEAD:main");
    mkdirSync(".incoming/.run", { recursive: true });
    cpSync(".state", ".incoming/.state", { recursive: true });
    writeFileSync(".incoming/.run/base-tree", git("rev-parse", "HEAD:.state") + "\n");
    writeFileSync(".incoming/.state/posted.jsonl", JSON.stringify({ ts: now.toISOString(), product: "claude", version: "2.0.0", dryRun: false, runId: "123", text: "待发布正文" }) + "\n");
  }
  const checkpoint = () => Bun.spawnSync(["bash", join(root, "scripts/commit-state.sh")], { cwd: dir });

  test("reservation reaches remote before the next phase; result uses its exact baseline", () => {
    setup();
    expect(checkpoint().exitCode).toBe(0);
    expect(git("--git-dir=origin.git", "show", "main:.state/posted.jsonl")).toContain("待发布正文");
    expect(readFileSync(".incoming/.run/base-tree", "utf8").trim()).toBe(git("rev-parse", "HEAD:.state"));
    const reserved = readFileSync(".incoming/.state/posted.jsonl", "utf8");
    writeFileSync(".incoming/.state/posted.jsonl", reserved + JSON.stringify({ ts: now.toISOString(), product: "claude", version: "2.0.0", dryRun: false, tweetId: "123" }) + "\n");
    expect(checkpoint().exitCode).toBe(0);
    expect(git("--git-dir=origin.git", "show", "main:.state/posted.jsonl")).toContain('"tweetId":"123"');
  });

  test("changed state is not overwritten or rebased", () => {
    setup();
    writeState("codex", "3.0.0");
    git("add", ".state");
    git("commit", "-m", "concurrent update");
    const result = checkpoint();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("State changed");
    expect(readState("codex")).toBe("3.0.0");
    expect(readFileSync(".state/posted.jsonl", "utf8")).toBe("");
  });

  test("push failure fails checkpoint; cannot authorize publication", () => {
    setup();
    git("remote", "set-url", "origin", join(dir, "missing-origin.git"));
    expect(checkpoint().exitCode).not.toBe(0);
    expect(git("--git-dir=origin.git", "show", "main:.state/posted.jsonl")).toBe("");
  });
});
