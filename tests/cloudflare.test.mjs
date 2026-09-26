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
const products = ['claude', 'codex', 'codex_app', 'grok_build'];
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
/** Keep in sync with src/limits.ts */
const DAILY_PUBLICATION_LIMIT = 12;

async function setup(t, { preview = false, failX = false, failSource = false, failDraft = false, missingX = false } = {}) {
  const calls = { tweets: 0, drafts: 0 };
  let db;
  const secrets = {
    DRY_RUN: String(preview),
    ANTHROPIC_API_KEY: 'test-only',
    ...(missingX ? {} : {
      X_API_KEY: 'test-only',
      X_API_SECRET: 'test-only',
      X_ACCESS_TOKEN: 'test-only',
      X_ACCESS_TOKEN_SECRET: 'test-only',
    }),
  };
  const mf = new Miniflare({
    log: new Log(LogLevel.ERROR), telemetry: { enabled: false },
    workers: [{
      config: {
        type: 'worker', name: 'publisher', compatibilityDate: '2026-09-01', compatibilityFlags: ['nodejs_compat'],
        manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: bundle } } },
        env: {
          DB: { type: 'd1', id: 'test-db' },
          ...Object.fromEntries(Object.entries(secrets).map(([k, value]) => [k, { type: 'text', value }])),
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
        if (url.hostname === 'developers.openai.com' && url.pathname.includes('/codex/changelog')) {
          return new Response(`<ul>
<li id="codex-2026-09-11-app" data-codex-topics="codex-app"><div><time>2026-09-11</time><h3>Quick chats 26.908</h3></div><article><h3>Chat while you work</h3><p>Keep ChatGPT close while you work in other apps.</p></article></li>
<li id="codex-2026-01-01-app" data-codex-topics="codex-app"><div><time>2026-01-01</time><h3>Initial app shell 26.100</h3></div><article><h3>Desktop shell</h3><p>Added the Codex desktop shell for macOS and Windows.</p></article></li>
</ul>`);
        }
        if (url.hostname === 'x.ai') return new Response('<h2>Grok Build 1.0.1</h2><ul><li>Added support for custom commands</li></ul><h2>Grok Build 1.0.0</h2><ul><li>Added support for terminal sessions</li></ul>');
        if (url.hostname === 'open.bigmodel.cn') {
          calls.drafts++;
          return Response.json({ stop_reason: failDraft ? 'max_tokens' : 'end_turn', content: [{ type: 'text', text: '🔧 新增自定义命令支持，方便使用终端会话' }] });
        }
        if (url.hostname === 'api.x.com' || url.hostname === 'api.twitter.com') {
          assert.equal(request.method, 'POST');
          const pending = await db.prepare("SELECT * FROM publications WHERE status='pending'").all();
          assert.equal(pending.results.length, 1, 'intent must be durable before X');
          const body = await request.json();
          if (body.reply?.in_reply_to_tweet_id) {
            assert.match(body.text, /^官方：https?:\/\//);
          } else {
            assert.equal(body.text, pending.results[0].text);
            assert.ok(!/https?:\/\//i.test(body.text), 'root tweet must have zero links');
          }
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
  for (const product of products) {
    const version = product === 'codex' ? 'rust-v1.0.0'
      : product === 'codex_app' ? 'codex-2026-01-01-app'
      : '1.0.0';
    await db.prepare('INSERT INTO cursors VALUES (?, ?)').bind(product, version).run();
  }
  const worker = await mf.getWorker('publisher');
  const run = () => worker.scheduled({ scheduledTime: Date.now(), cron: '17 * * * *' });
  return { db, calls, run };
}

test('Workers runtime publishes once, persists before X and ignores replay', async t => {
  const { db, calls, run } = await setup(t);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 8);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM publications WHERE status='posted'").first()).n, 4);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 8);
  await db.prepare("UPDATE cursors SET version = CASE WHEN product='codex' THEN 'rust-v1.0.0' WHEN product='codex_app' THEN 'codex-2026-01-01-app' ELSE '1.0.0' END").run();
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 8);
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
  assert.equal(calls.tweets, 2);
  assert.equal((await db.prepare("SELECT status FROM publications").first()).status, 'pending');
  assert.equal((await db.prepare("SELECT version FROM cursors WHERE product='claude'").first()).version, '1.0.0');
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 2);
});

test('overlapping cron runs cannot send the same version twice', async t => {
  const { db, calls, run } = await setup(t);
  await Promise.allSettled([run(), run(), run()]);
  const rows = (await db.prepare('SELECT * FROM publications').all()).results;
  assert.ok(calls.tweets >= 2);
  assert.equal(calls.tweets, rows.length * 2);
  assert.ok(calls.tweets <= 8);
  assert.equal(new Set(rows.map(r => `${r.product}:${r.version}`)).size, rows.length);
  assert.ok(rows.every(r => r.status === 'posted'));
});

test('daily limit is enforced across products and leaves remaining versions for later', async t => {
  const { db, calls, run } = await setup(t);
  for (let i = 0; i < DAILY_PUBLICATION_LIMIT - 1; i++) await db.prepare("INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day) VALUES ('claude',?,'posted','history',?, ?, ?)").bind(`0.0.${i}`, String(i + 1), new Date().toISOString(), day()).run();
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 2);
  assert.equal((await db.prepare("SELECT version FROM cursors WHERE product='codex'").first()).version, 'rust-v1.0.0');
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 2);
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
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cursors').first()).n, 4);
  assert.equal((await run()).outcome, 'ok');
  assert.equal(calls.tweets, 0);
});

test('concurrent cron runs cannot exceed the last remaining daily slot', async t => {
  const { db, calls, run } = await setup(t);
  for (let i = 0; i < DAILY_PUBLICATION_LIMIT - 1; i++) await db.prepare("INSERT INTO publications (product,version,status,text,tweet_id,reserved_at,day) VALUES ('claude',?,'posted','history',?, ?, ?)").bind(`0.0.${i}`, String(i + 1), new Date().toISOString(), day()).run();
  await Promise.all([run(), run(), run()]);
  assert.equal(calls.tweets, 2);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications WHERE day=?').bind(day()).first()).n, DAILY_PUBLICATION_LIMIT);
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
  assert.equal((await db.prepare('SELECT count(*) AS n FROM cursors').first()).n, 4);
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

test('a deferred reservation still publishes later products', async t => {
  const { db, calls, run } = await setup(t);
  await db.prepare("CREATE TRIGGER skip_claude BEFORE INSERT ON publications WHEN NEW.product = 'claude' BEGIN SELECT RAISE(IGNORE); END").run();
  assert.equal((await run()).outcome, 'ok');
  const products = (await db.prepare("SELECT product FROM publications WHERE status='posted'").all()).results.map(r => r.product);
  assert.deepEqual([...products].sort(), ['codex', 'codex_app', 'grok_build']);
  assert.equal(calls.tweets, 6);
});

test('missing X secrets cannot create a pending publication', async t => {
  const { db, calls, run } = await setup(t, { missingX: true });
  assert.equal((await run()).outcome, 'exception');
  assert.equal(calls.tweets, 0);
  assert.equal(calls.drafts, 0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM publications').first()).n, 0);
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
