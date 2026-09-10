import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Miniflare, Response, Log, LogLevel } from 'miniflare';

const bundle = readFileSync(new URL('../.worker-build/worker.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../migrations/0001_publications.sql', import.meta.url), 'utf8');
const products = ['claude', 'codex', 'grok_build'];
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());

async function setup(t, { preview = false, failX = false, failSource = false, failDraft = false } = {}) {
  const calls = { tweets: 0, drafts: 0 };
  let db;
  const mf = new Miniflare({
    log: new Log(LogLevel.ERROR), telemetry: { enabled: false },
    workers: [{
      config: {
        type: 'worker', name: 'publisher', compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
        manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle } } },
        env: {
          DB: { type: 'd1', id: 'test-db' },
          ...Object.fromEntries(Object.entries({ DRY_RUN: String(preview), ANTHROPIC_API_KEY: 'test-only', X_API_KEY: 'test-only', X_API_SECRET: 'test-only', X_ACCESS_TOKEN: 'test-only', X_ACCESS_TOKEN_SECRET: 'test-only' }).map(([k, value]) => [k, { type: 'text', value }])),
        },
      },
      dev: { outboundService: { type: 'fetcher', handler: async request => {
        const url = new URL(request.url);
        if (url.hostname === 'api.github.com') {
          if (failSource && url.pathname.includes('/openai/')) return new Response('unavailable', { status: 503 });
          const codex = url.pathname.includes('/openai/');
          const releases = ['1.0.1', '1.0.0'].map(version => ({ tag_name: `${codex ? 'rust-v' : 'v'}${version}`, html_url: `https://github.com/test/releases/${version}`, body: '- Added support for custom commands and terminal sessions', draft: false, prerelease: false }));
          return Response.json(releases);
        }
        if (url.hostname === 'x.ai') return new Response('<h2>Grok Build 1.0.1</h2><ul><li>Added support for custom commands</li></ul><h2>Grok Build 1.0.0</h2><ul><li>Added support for terminal sessions</li></ul>');
        if (url.hostname === 'open.bigmodel.cn') {
          calls.drafts++;
          return Response.json({ stop_reason: failDraft ? 'max_tokens' : 'end_turn', content: [{ type: 'text', text: '• 新增自定义命令支持，方便使用终端会话' }] });
        }
        if (url.hostname === 'api.x.com' || url.hostname === 'api.twitter.com') {
          assert.equal(request.method, 'POST');
          const pending = await db.prepare("SELECT * FROM publications WHERE status='pending'").all();
          assert.equal(pending.results.length, 1, 'intent must be durable before X');
          assert.equal((await request.json()).text, pending.results[0].text);
          assert.match(request.headers.get('authorization'), /OAuth /);
          calls.tweets++;
          if (failX) return Response.json({ detail: 'outcome unknown' }, { status: 503 });
          return Response.json({ data: { id: String(9000 + calls.tweets) } });
        }
        throw new Error(`Unexpected outbound request: ${request.url}`);
      } } },
    }],
  });
  t.after(() => mf.dispose());
  db = await mf.getD1Database('DB', 'publisher');
  for (const statement of schema.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  for (const product of products) await db.prepare('INSERT INTO cursors VALUES (?, ?)').bind(product, product === 'codex' ? 'rust-v1.0.0' : '1.0.0').run();
  const worker = await mf.getWorker('publisher');
  const run = () => worker.scheduled({ scheduledTime: Date.now(), cron: '17 * * * *' });
  return { db, calls, run };
}

test('Workers runtime publishes once, persists before X and ignores replay', async t => {
  const { db, calls, run } = await setup(t);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 3);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM publications WHERE status='posted'").first()).n, 3);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 3);
  await db.prepare("UPDATE cursors SET version = CASE WHEN product='codex' THEN 'rust-v1.0.0' ELSE '1.0.0' END").run();
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 3);
});

test('preview does not write state or call X', async t => {
  const { db, calls, run } = await setup(t, { preview: true });
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications').first()).n, 0);
  assert.equal((await db.prepare("SELECT version FROM cursors WHERE product='claude'").first()).version, '1.0.0');
});

test('unknown X result stays pending and blocks every later run', async t => {
  const { db, calls, run } = await setup(t, { failX: true });
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM publications WHERE status='pending'").first()).n, 1);
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 1);
});

test('D1 completion failure preserves pending intent after X success', async t => {
  const { db, calls, run } = await setup(t);
  await db.prepare("CREATE TRIGGER fail_completion BEFORE UPDATE ON cursors BEGIN SELECT RAISE(ABORT, 'test completion failure'); END").run();
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 1);
  assert.equal((await db.prepare("SELECT status FROM publications").first()).status, 'pending');
  assert.equal((await db.prepare("SELECT version FROM cursors WHERE product='claude'").first()).version, '1.0.0');
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 1);
});

test('overlapping cron runs cannot send the same version twice', async t => {
  const { db, calls, run } = await setup(t);
  await Promise.allSettled([run(), run(), run()]);
  const rows = (await db.prepare('SELECT * FROM publications').all()).results;
  assert.ok(calls.tweets >= 1);
  assert.equal(calls.tweets, rows.length);
  assert.ok(calls.tweets <= 3);
  assert.equal(new Set(rows.map(r => `${r.product}:${r.version}`)).size, rows.length);
  assert.ok(rows.every(r => r.status === 'posted'));
});

test('daily limit is enforced across products and leaves remaining versions for later', async t => {
  const { db, calls, run } = await setup(t);
  for (let i = 0; i < 4; i++) await db.prepare("INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day) VALUES ('claude',?,'posted','history',?, ?, ?)").bind(`0.0.${i}`, String(i + 1), new Date().toISOString(), day()).run();
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 1);
  assert.equal((await db.prepare("SELECT version FROM cursors WHERE product='codex'").first()).version, 'rust-v1.0.0');
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 1);
});

for (const failure of ['failSource', 'failDraft']) test(`${failure} cannot partially reserve or publish`, async t => {
  const { db, calls, run } = await setup(t, { [failure]: true });
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications').first()).n, 0);
});

test('empty database seeds latest versions without posting historical releases', async t => {
  const { db, calls, run } = await setup(t);
  await db.prepare('DELETE FROM cursors').run();
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cursors').first()).n, 3);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 0);
});

test('concurrent cron runs cannot exceed the last remaining daily slot', async t => {
  const { db, calls, run } = await setup(t);
  for (let i = 0; i < 4; i++) await db.prepare("INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day) VALUES ('claude',?,'posted','history',?, ?, ?)").bind(`0.0.${i}`, String(i + 1), new Date().toISOString(), day()).run();
  await Promise.all([run(), run(), run()]);
  assert.equal(calls.tweets, 1);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications WHERE day=?').bind(day()).first()).n, 5);
});

test('ledger import preserves cursors and confirmed IDs, ignores previews and refuses pending', async t => {
  const { db } = await setup(t);
  await db.prepare('DELETE FROM cursors').run();
  const dir = mkdtempSync(join(tmpdir(), 'agent-release-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.state'));
  for (const product of products) writeFileSync(join(dir, `.state/last_posted_${product}.txt`), '1.0.0\n');
  const rows = [
    { product: 'claude', version: '1.0.0', dryRun: true, ts: new Date().toISOString() },
    { product: 'claude', version: '1.0.0', dryRun: false, tweetId: '111', ts: new Date().toISOString() },
    { product: 'claude', version: '1.0.0', dryRun: false, tweetId: '222', text: "operator's confirmed post", ts: new Date().toISOString() },
  ];
  const ledger = join(dir, '.state/posted.jsonl');
  writeFileSync(ledger, rows.map(r => JSON.stringify(r)).join('\n'));
  const execute = () => spawnSync('bun', [fileURLToPath(new URL('../scripts/export-d1.ts', import.meta.url))], { cwd: dir, encoding: 'utf8' });
  const exported = execute();
  assert.equal(exported.status, 0, exported.stderr);
  for (const sql of exported.stdout.trim().split('\n')) await db.prepare(sql).run();
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cursors').first()).n, 3);
  const saved = (await db.prepare('SELECT * FROM publications').all()).results;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].tweet_id, '222');
  assert.equal(saved[0].text, "operator's confirmed post");
  rows.push({ product: 'codex', version: '1.0.1', dryRun: false, ts: new Date().toISOString() });
  writeFileSync(ledger, rows.map(r => JSON.stringify(r)).join('\n'));
  const blocked = execute();
  assert.notEqual(blocked.status, 0);
  assert.equal(blocked.stdout, '');
  assert.match(blocked.stderr, /Reconcile pending/);
});

test('reservation storage failure cannot reach X', async t => {
  const { db, calls, run } = await setup(t);
  await db.prepare("CREATE TRIGGER fail_reservation BEFORE INSERT ON publications BEGIN SELECT RAISE(ABORT, 'test reservation failure'); END").run();
  const result = await run();
  assert.equal(result.outcome, 'exception');
  assert.equal(result.noRetry, true);
  assert.equal(calls.tweets, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications').first()).n, 0);
});
