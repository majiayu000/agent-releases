import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as draft from "./draft.ts";
import * as twitter from "./twitter.ts";
import type { Release } from "./sources/types.ts";
import { runPublisher } from "./worker.ts";
import { SqliteDatabase } from "./vps.ts";
import { DAILY_PUBLICATION_LIMIT } from "./limits.ts";

const schema = readFileSync(new URL("../migrations/0001_publications.sql", import.meta.url), "utf8");
const release: Release = {
  product: "claude", version: "1.0.1", displayVersion: "1.0.1", title: "Claude 1.0.1",
  notes: "- Added custom commands", url: "https://example.com/1.0.1",
};
const realFetch = globalThis.fetch;
let dir: string;
let connection: Database;
let db: SqliteDatabase;
let restores: (() => void)[];
let sent: number;
let failure: "none" | "x";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-release-sqlite-"));
  connection = new Database(join(dir, "state.sqlite"), { create: true, strict: true });
  connection.exec(schema);
  for (const product of ["claude", "codex", "codex_app", "grok_build"]) {
    connection.query("INSERT INTO cursors VALUES (?, ?)").run(product, product === "codex_app" ? "codex-2026-01-01-app" : product === "codex" ? "rust-v1.0.0" : "1.0.0");
  }
  db = new SqliteDatabase(connection);
  sent = 0;
  failure = "none";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.github.com") {
      const codex = url.pathname.includes("/openai/");
      return Response.json((codex ? ["1.0.0"] : ["1.0.1", "1.0.0"]).map(version => ({
        tag_name: `${codex ? "rust-v" : "v"}${version}`, html_url: release.url,
        body: "- Added support for custom commands and terminal sessions", draft: false, prerelease: false,
      })));
    }
    if (url.hostname === "developers.openai.com") return new Response('<li id="codex-2026-01-01-app" data-codex-topics="codex-app"><h3>Initial 26.100</h3><article><p>Added desktop shell</p></article></li>');
    if (url.hostname === "x.ai") return new Response("<h2>Grok Build 1.0.0</h2><ul><li>Added custom commands</li></ul>");
    throw new Error(`Unexpected test network request: ${url}`);
  }) as typeof fetch;
  const spies = [
    spyOn(draft, "draftChinesePost").mockResolvedValue("🔧 新增自定义命令，方便复用常用操作"),
    spyOn(twitter, "assertXCredentials").mockImplementation(() => {}),
    spyOn(twitter, "postTweet").mockImplementation(async text => {
      // Read through a second connection to prove reservation durability before X.
      const observer = new Database(join(dir, "state.sqlite"), { readonly: true });
      try {
        expect(observer.query("SELECT text FROM publications WHERE status='pending'").get()).toEqual({ text });
      } finally { observer.close(); }
      sent++;
      if (failure === "x") throw new Error("X response lost");
      return "123456";
    }),
  ];
  restores = spies.map(spy => () => spy.mockRestore());
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const restore of restores) restore();
  connection.close();
  rmSync(dir, { recursive: true, force: true });
});

test("VPS preview generates a draft against read-only SQLite without X or state writes", async () => {
  const before = readFileSync(join(dir, "state.sqlite"));
  const readOnly = new Database(join(dir, "state.sqlite"), { readonly: true, strict: true });
  try { await runPublisher(new SqliteDatabase(readOnly), true); }
  finally { readOnly.close(); }
  expect(sent).toBe(0);
  expect(readFileSync(join(dir, "state.sqlite"))).toEqual(before);
  expect(connection.query("SELECT count(*) AS n FROM publications").get()).toEqual({ n: 0 });
});

test("SQLite commits a reservation before mock X, completes atomically and rejects replay", async () => {
  await runPublisher(db, false);
  expect(sent).toBe(1);
  expect(connection.query("SELECT status,tweet_id FROM publications").get()).toEqual({ status: "posted", tweet_id: "123456" });
  connection.query("UPDATE cursors SET version='1.0.0' WHERE product='claude'").run();
  await runPublisher(db, false);
  expect(sent).toBe(1);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.1" });
});

test("unknown mock X outcome survives reopening SQLite and blocks later runs", async () => {
  failure = "x";
  await expect(runPublisher(db, false)).rejects.toThrow("X response lost");
  const reopened = new Database(join(dir, "state.sqlite"), { strict: true });
  try {
    await expect(runPublisher(new SqliteDatabase(reopened), false)).rejects.toThrow("Reconcile pending");
  } finally { reopened.close(); }
  expect(sent).toBe(1);
});

test("completion failure rolls back posted status and keeps pending after mock X success", async () => {
  connection.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON cursors BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
  await expect(runPublisher(db, false)).rejects.toThrow("completion failed");
  expect(sent).toBe(1);
  expect(connection.query("SELECT status,tweet_id FROM publications").get()).toEqual({ status: "pending", tweet_id: null });
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
});

test("overlapping SQLite publishers claim a version only once", async () => {
  await Promise.allSettled([runPublisher(db, false), runPublisher(db, false)]);
  expect(sent).toBe(1);
  expect(connection.query("SELECT count(*) AS n FROM publications").get()).toEqual({ n: 1 });
});

test("SQLite daily limit prevents a mock X call after the cap", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  for (let i = 0; i < DAILY_PUBLICATION_LIMIT; i++) connection.query("INSERT INTO publications (product,version,status,text,reserved_at,day,tweet_id) VALUES ('claude',?,'posted','history',?,?,?)").run(`0.0.${i}`, new Date().toISOString(), day, String(i));
  await runPublisher(db, false);
  expect(sent).toBe(0);
});

test("VPS CLI rejects unknown arguments before accessing database or network", () => {
  const result = Bun.spawnSync([process.execPath, new URL("./vps.ts", import.meta.url).pathname, join(dir, "state.sqlite"), "--pubish"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("Usage:");
});

test("explicit CLI publication fails before network or reservation when X credentials are absent", () => {
  const env = { ...process.env };
  for (const key of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"]) delete env[key];
  const result = Bun.spawnSync([process.execPath, new URL("./vps.ts", import.meta.url).pathname, join(dir, "state.sqlite"), "--publish"], { env });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("Missing X OAuth");
  expect(connection.query("SELECT count(*) AS n FROM publications").get()).toEqual({ n: 0 });
});

test("publication refuses a missing database instead of creating an empty ledger", () => {
  const result = Bun.spawnSync([process.execPath, new URL("./vps.ts", import.meta.url).pathname, join(dir, "missing.sqlite"), "--publish"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("unable to open database file");
  expect(existsSync(join(dir, "missing.sqlite"))).toBe(false);
});
