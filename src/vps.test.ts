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
const recoverySql = readFileSync(new URL("../docs/cloudflare.md", import.meta.url), "utf8")
  .match(/```sql\n([\s\S]*?)\n```/)![1]!.split(";").map(sql => sql.trim()).filter(Boolean);
const reconcile = () => db.batch(recoverySql.map((sql, i) =>
  db.prepare(sql).bind(...(i === 1 ? ["1.0.0"] : ["123456", new Date().toISOString()]))));
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
let failure: "none" | "x" | "reply" | "reply-id";
let claudeVersions: string[];
let claudeNotes: string;
let afterReply: () => void;

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
  claudeVersions = ["1.0.1", "1.0.0"];
  claudeNotes = "- Added support for custom commands and terminal sessions";
  afterReply = () => {};
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.github.com") {
      const codex = url.pathname.includes("/openai/");
      return Response.json((codex ? ["1.0.0"] : claudeVersions).map(version => ({
        tag_name: `${codex ? "rust-v" : "v"}${version}`, html_url: release.url,
        body: claudeNotes, draft: false, prerelease: false,
      })));
    }
    if (url.hostname === "developers.openai.com") return new Response('<li id="codex-2026-01-01-app" data-codex-topics="codex-app"><h3>Initial 26.100</h3><article><p>Added desktop shell</p></article></li>');
    if (url.hostname === "x.ai") return new Response("<h2>Grok Build 1.0.0</h2><ul><li>Added custom commands</li></ul>");
    throw new Error(`Unexpected test network request: ${url}`);
  }) as typeof fetch;
  const spies = [
    spyOn(draft, "draftChinesePost").mockResolvedValue("🔧 新增自定义命令，方便复用常用操作"),
    spyOn(twitter, "assertXCredentials").mockImplementation(() => {}),
    spyOn(twitter, "postTweet").mockImplementation(async (text, replyToId?) => {
      // Read through a second connection to prove reservation durability before X.
      const observer = new Database(join(dir, "state.sqlite"), { readonly: true });
      try {
        if (!replyToId) {
          const reservation = observer.query("SELECT text FROM publications WHERE status='pending'").get() as { text: string };
          expect(JSON.parse(reservation.text).text).toBe(text);
          expect(text).not.toMatch(/https?:\/\//i);
        } else {
          expect(text).toBe(`官方：${release.url}`);
          expect(observer.query("SELECT status,tweet_id FROM publications WHERE status='pending'").get()).toEqual({ status: "pending", tweet_id: replyToId });
        }
      } finally { observer.close(); }
      if (replyToId) afterReply();
      sent++;
      if (failure === "x") throw new Error("X response lost");
      if (replyToId && failure === "reply") throw new Error("reply response lost");
      if (replyToId && failure === "reply-id") return "invalid";
      return String(123455 + sent);
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
  expect(sent).toBe(2);
  expect(connection.query("SELECT status,tweet_id FROM publications").get()).toEqual({ status: "posted", tweet_id: "123456" });
  connection.query("UPDATE cursors SET version='1.0.0' WHERE product='claude'").run();
  await runPublisher(db, false);
  expect(sent).toBe(2);
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

for (const replyFailure of ["reply", "reply-id"] as const) test(`SQLite preserves the root on ${replyFailure} failure and blocks replay`, async () => {
  failure = replyFailure;
  await expect(runPublisher(db, false)).rejects.toThrow("Root tweet 123456");
  const reopened = new Database(join(dir, "state.sqlite"), { strict: true });
  try {
    expect(reopened.query("SELECT status,tweet_id,posted_at FROM publications").get()).toEqual({ status: "pending", tweet_id: "123456", posted_at: null });
    await expect(runPublisher(new SqliteDatabase(reopened), false)).rejects.toThrow("123456");
  } finally { reopened.close(); }
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
  expect(sent).toBe(2);
});

for (const action of ["ABORT, 'root checkpoint failed'", "IGNORE"]) test(`SQLite root checkpoint ${action} prevents sending the reply`, async () => {
  connection.exec(`CREATE TRIGGER fail_root BEFORE UPDATE OF tweet_id ON publications WHEN NEW.status='pending' BEGIN SELECT RAISE(${action}); END`);
  await expect(runPublisher(db, false)).rejects.toThrow("Root tweet 123456");
  expect(sent).toBe(1);
  expect(connection.query("SELECT status,tweet_id FROM publications").get()).toEqual({ status: "pending", tweet_id: null });
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
});

test("completion failure rolls back posted status and keeps pending after mock X success", async () => {
  connection.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON cursors BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
  await expect(runPublisher(db, false)).rejects.toThrow("completion failed");
  expect(sent).toBe(2);
  expect(connection.query("SELECT status,tweet_id FROM publications").get()).toEqual({ status: "pending", tweet_id: "123456" });
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
});

test("overlapping SQLite publishers claim a version only once", async () => {
  await Promise.allSettled([runPublisher(db, false), runPublisher(db, false)]);
  expect(sent).toBe(2);
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


test("SQLite coalesced members survive rewinds without the tip in the feed", async () => {
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  await runPublisher(db, false);
  const posted = connection.query("SELECT version,status,tweet_id FROM publications ORDER BY version").all();
  connection.query("UPDATE cursors SET version='1.0.0' WHERE product='claude'").run();
  claudeVersions = ["1.0.2", "1.0.1", "1.0.0"];
  await runPublisher(db, false);
  expect(sent).toBe(2);
  expect(posted).toEqual([
    { version: "1.0.1", status: "posted", tweet_id: "123456" },
    { version: "1.0.2", status: "posted", tweet_id: "123456" },
    { version: "1.0.3", status: "posted", tweet_id: "123456" },
  ]);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.2" });
});

test("SQLite coalesced members consume only one daily slot", async () => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  for (let i = 0; i < DAILY_PUBLICATION_LIMIT - 2; i++) connection.query("INSERT INTO publications (product,version,status,text,reserved_at,day,tweet_id) VALUES ('claude',?,'posted','history',?,?,?)").run(`0.0.${i}`, new Date().toISOString(), day, String(i));
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  await runPublisher(db, false);
  claudeVersions.unshift("1.1.0");
  await runPublisher(db, false);
  expect(sent).toBe(4);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.1.0" });
  claudeVersions.unshift("1.2.0");
  await runPublisher(db, false);
  expect(sent).toBe(4);
});

for (const bundle of [false, true]) test(`SQLite zero-row cursor completion preserves pending (bundle=${bundle})`, async () => {
  if (bundle) claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  connection.exec("CREATE TRIGGER ignore_cursor BEFORE UPDATE ON cursors BEGIN SELECT RAISE(IGNORE); END");
  await expect(runPublisher(db, false)).rejects.toThrow();
  expect(sent).toBe(2);
  expect(connection.query("SELECT version,status,tweet_id FROM publications").all()).toEqual([
    { version: bundle ? "1.0.3" : "1.0.1", status: "pending", tweet_id: "123456" },
  ]);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
  await expect(runPublisher(db, false)).rejects.toThrow("Reconcile pending");
  expect(sent).toBe(2);
});

test("SQLite changed cursor during X preserves pending and every bundle member", async () => {
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  afterReply = () => { connection.query("UPDATE cursors SET version='9.0.0' WHERE product='claude'").run(); };
  await expect(runPublisher(db, false)).rejects.toThrow();
  expect(connection.query("SELECT version,status FROM publications").all()).toEqual([{ version: "1.0.3", status: "pending" }]);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "9.0.0" });
});

for (const action of ["ABORT", "IGNORE"]) test(`SQLite member ${action} rolls back the bundle completion`, async () => {
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  connection.exec(`CREATE TRIGGER fail_member BEFORE INSERT ON publications WHEN NEW.version='1.0.1' BEGIN SELECT RAISE(${action}${action === "ABORT" ? ", 'member failed'" : ""}); END`);
  await expect(runPublisher(db, false)).rejects.toThrow();
  expect(connection.query("SELECT version,status FROM publications").all()).toEqual([{ version: "1.0.3", status: "pending" }]);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.0.0" });
});

test("SQLite rewind skips a thin older patch before a later posted release", async () => {
  claudeVersions = ["1.1.0", "1.0.1", "1.0.0"];
  claudeNotes = "- Added tiny tweak\n- Fixed a crash in terminal session reconnect";
  connection.query("INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day) VALUES ('claude','1.1.0','posted','history','111',?,?)")
    .run(new Date().toISOString(), new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()));
  await runPublisher(db, false);
  expect(sent).toBe(0);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get()).toEqual({ version: "1.1.0" });
});

test("SQLite failed completion can reconcile durable bundle members after reopening", async () => {
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  connection.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON cursors BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
  await expect(runPublisher(db, false)).rejects.toThrow("completion failed");
  connection.close();
  connection = new Database(join(dir, "state.sqlite"), { strict: true });
  db = new SqliteDatabase(connection);
  connection.exec("DROP TRIGGER fail_completion");
  const row = connection.query("SELECT text FROM publications WHERE status='pending'").get() as { text: string };
  expect(JSON.parse(row.text).coveredVersions).toEqual(["1.0.1", "1.0.2", "1.0.3"]);
  await reconcile();
  connection.query("UPDATE cursors SET version='1.0.0' WHERE product='claude'").run();
  claudeVersions = ["1.0.2", "1.0.1", "1.0.0"];
  await runPublisher(db, false);
  expect(sent).toBe(2);
  expect(connection.query("SELECT version,status,tweet_id FROM publications ORDER BY version").all()).toEqual([
    { version: "1.0.1", status: "posted", tweet_id: "123456" },
    { version: "1.0.2", status: "posted", tweet_id: "123456" },
    { version: "1.0.3", status: "posted", tweet_id: "123456" },
  ]);
  expect(connection.query("SELECT count(DISTINCT tweet_id) AS n FROM publications").get()).toEqual({ n: 1 });
});

for (const cursor of ["missing", "changed", "ignored"]) test(`SQLite documented recovery rolls back a ${cursor} cursor`, async () => {
  claudeVersions = ["1.0.3", "1.0.2", "1.0.1", "1.0.0"];
  connection.exec("CREATE TRIGGER fail_completion BEFORE UPDATE ON cursors BEGIN SELECT RAISE(ABORT, 'completion failed'); END");
  await expect(runPublisher(db, false)).rejects.toThrow("completion failed");
  expect(sent).toBe(2);
  connection.exec("DROP TRIGGER fail_completion");
  if (cursor === "missing") connection.exec("DELETE FROM cursors WHERE product='claude'");
  else if (cursor === "changed") connection.exec("UPDATE cursors SET version='9.0.0' WHERE product='claude'");
  else connection.exec("CREATE TRIGGER ignore_cursor BEFORE UPDATE ON cursors BEGIN SELECT RAISE(IGNORE); END");
  await expect(reconcile()).rejects.toThrow();
  expect(connection.query("SELECT version,status,tweet_id FROM publications").all()).toEqual([
    { version: "1.0.3", status: "pending", tweet_id: "123456" },
  ]);
  expect(connection.query("SELECT version FROM cursors WHERE product='claude'").get())
    .toEqual(cursor === "missing" ? null : { version: cursor === "changed" ? "9.0.0" : "1.0.0" });
  await expect(runPublisher(db, false)).rejects.toThrow("Reconcile pending");
  expect(sent).toBe(2);
});

test("Codex App month-boundary builds publish a bundle and persist only the tip slug", async () => {
  connection.query("UPDATE cursors SET version='1.0.1' WHERE product='claude'").run();
  connection.query("UPDATE cursors SET version='codex-2026-09-27-app' WHERE product='codex_app'").run();
  const html = [
    ["codex-2026-10-01-app", "26.1001"],
    ["codex-2026-09-29-app", "26.929"],
    ["codex-2026-09-28-app", "26.928"],
    ["codex-2026-09-27-app", "26.927"],
  ].map(([id, build]) => `<li id="${id}" data-codex-topics="codex-app"><h3>Codex app ${build}</h3><article><p>Added tiny tweak</p></article></li>`).join("");
  const otherFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => String(input).includes("developers.openai.com")
    ? new Response(html) : otherFetch(input, init)) as typeof fetch;
  const tip = "codex-2026-10-01-app";
  spyOn(twitter, "postTweet").mockImplementation(async (text, replyToId?) => {
    expect(connection.query("SELECT product,version,status FROM publications").get()).toEqual({ product: "codex_app", version: tip, status: "pending" });
    if (replyToId) expect(text).toBe(`官方：https://developers.openai.com/codex/changelog#${tip}`);
    sent++;
    return "123456";
  });
  await runPublisher(db, true);
  expect(sent).toBe(0);
  expect(connection.query("SELECT version FROM cursors WHERE product='codex_app'").get()).toEqual({ version: "codex-2026-09-27-app" });
  expect(draft.draftChinesePost).toHaveBeenCalledWith(expect.objectContaining({ version: tip, displayVersion: "26.928→26.1001" }));
  await runPublisher(db, false);
  expect(sent).toBe(2);
  expect(connection.query("SELECT version FROM cursors WHERE product='codex_app'").get()).toEqual({ version: tip });
  expect(connection.query("SELECT version,status FROM publications").get()).toEqual({ version: tip, status: "posted" });
  await runPublisher(db, false);
  expect(sent).toBe(2);
});

test("first unseen Codex App new-year build uses the feed baseline and publishes once", async () => {
  connection.query("UPDATE cursors SET version='1.0.1' WHERE product='claude'").run();
  const cursor = "codex-2026-12-31-app";
  const tip = "codex-2027-01-01-app";
  connection.query("UPDATE cursors SET version=? WHERE product='codex_app'").run(cursor);
  const html = [
    [tip, "27.101"],
    [cursor, "26.1231"],
  ].map(([id, build]) => `<li id="${id}" data-codex-topics="codex-app"><h3>Codex app ${build}</h3><article><p>Added tiny tweak</p></article></li>`).join("");
  const otherFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => String(input).includes("developers.openai.com")
    ? new Response(html) : otherFetch(input, init)) as typeof fetch;
  spyOn(twitter, "postTweet").mockImplementation(async (text, replyToId?) => {
    expect(connection.query("SELECT product,version,status FROM publications").get()).toEqual({ product: "codex_app", version: tip, status: "pending" });
    if (replyToId) expect(text).toBe(`官方：https://developers.openai.com/codex/changelog#${tip}`);
    sent++;
    return "123456";
  });
  await runPublisher(db, true);
  expect(sent).toBe(0);
  expect(connection.query("SELECT version FROM cursors WHERE product='codex_app'").get()).toEqual({ version: cursor });
  expect(draft.draftChinesePost).toHaveBeenCalledWith(expect.objectContaining({ version: tip, displayVersion: "27.101" }));
  await runPublisher(db, false);
  expect(sent).toBe(2);
  expect(connection.query("SELECT version FROM cursors WHERE product='codex_app'").get()).toEqual({ version: tip });
  expect(connection.query("SELECT version,status FROM publications").get()).toEqual({ version: tip, status: "posted" });
  await runPublisher(db, false);
  expect(sent).toBe(2);
});
