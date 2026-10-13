import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { QuotaStore } from '../server/quota.mjs';
import { createApp } from '../server/index.mjs';
import { AnalysisClient } from '../dist/extension/service.mjs';
import { makeAnalysisContext } from '../shared/dates.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-08T18:00:00Z');
const candidate = { title: 'Dinner', date: 'tomorrow', startTime: '19:00', endDate: null, endTime: null,
  timeZone: null, allDay: false, location: '', description: '', evidence: 'Dinner tomorrow 7 PM', uncertainties: [] };
const reserve = (store, client, ip = 'network') => { const id = randomUUID(); store.reserve(client, id, ip); store.finish(client, id); return id; };
const errorCode = code => error => error.code === code;

test('signed sessions reject tampering and expire; identity does not contain a provider key', () => {
  let now = Date.parse('2026-10-08T18:00:00Z'); const store = new QuotaStore({ now: () => now });
  try {
    const client = randomUUID(); const result = store.session(client, 'ip');
    assert.equal(store.authenticate('Bearer ' + result.token), client);
    assert.throws(() => store.authenticate('Bearer ' + result.token.slice(0, -1) + (result.token.endsWith('a') ? 'b' : 'a')), errorCode('SESSION_REQUIRED'));
    assert.throws(() => store.authenticate('Bearer made-up'), errorCode('SESSION_REQUIRED'));
    now += 3_600_001;
    assert.throws(() => store.authenticate('Bearer ' + result.token), errorCode('SESSION_REQUIRED'));
  } finally { store.close(); }
});

test('daily allowance resets by UTC boundary and failed reservations do not consume it', () => {
  let now = Date.parse('2026-10-08T23:59:00Z'); const store = new QuotaStore({ now: () => now }); const client = randomUUID();
  try {
    for (let i = 0; i < 5; i++) reserve(store, client);
    assert.equal(store.usage(client).remaining, 0);
    assert.throws(() => reserve(store, client), errorCode('QUOTA_EXHAUSTED'));
    assert.equal(store.usage(client).remaining, 0);
    now += 60_001; assert.equal(store.usage(client).remaining, 5);
  } finally { store.close(); }
});

test('quota and request IDs persist across restart and two connections share counters', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'auto-calendar-quota-')); const filename = path.join(folder, 'usage.sqlite');
  const client = randomUUID(); let one = new QuotaStore({ filename }); let two;
  try {
    const session = one.session(client, 'ip'); const id = reserve(one, client); one.close(); one = new QuotaStore({ filename }); two = new QuotaStore({ filename });
    assert.equal(one.authenticate('Bearer ' + session.token), client);
    assert.equal(two.usage(client).remaining, 4);
    assert.throws(() => reserveDuplicate(two, client, id), errorCode('DUPLICATE_REQUEST'));
    for (let i = 0; i < 4; i++) reserve(i % 2 ? one : two, client);
    assert.throws(() => reserve(two, client), errorCode('QUOTA_EXHAUSTED'));
  } finally {
    one.close(); two?.close();
    const relative = path.relative(os.tmpdir(), folder);
    if (!relative.startsWith('auto-calendar-quota-') || relative.includes(path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe test cleanup target.');
    await rm(folder, { recursive: true, force: true });
  }
});
function reserveDuplicate(store, client, id) { store.reserve(client, id, 'ip'); }

test('global and network caps reject new identities atomically', () => {
  for (const [limits, code] of [[{ globalDaily: 2 }, 'SERVICE_LIMIT'], [{ ipDaily: 2 }, 'NETWORK_LIMIT']]) {
    const store = new QuotaStore({ limits }); const rejected = randomUUID();
    try { reserve(store, randomUUID()); reserve(store, randomUUID()); assert.throws(() => reserve(store, rejected), errorCode(code)); assert.equal(store.usage(rejected).remaining, 5); }
    finally { store.close(); }
  }
});

test('burst and concurrent caps never silently queue or consume rejected calls', () => {
  let now = Date.parse('2026-10-08T18:00:00Z'); const store = new QuotaStore({ now: () => now, limits: { burst: 1 } });
  try {
    reserve(store, randomUUID()); const client = randomUUID();
    assert.throws(() => reserve(store, client), errorCode('THROTTLED')); assert.equal(store.usage(client).remaining, 5);
    now += 60_001; reserve(store, client);
  } finally { store.close(); }
  const parallel = new QuotaStore(); const a = randomUUID(); const b = randomUUID(); const c = randomUUID();
  try {
    parallel.reserve(a, randomUUID(), 'a'); parallel.reserve(b, randomUUID(), 'b');
    assert.throws(() => parallel.reserve(c, randomUUID(), 'c'), errorCode('BUSY')); assert.equal(parallel.usage(c).remaining, 5);
  } finally { parallel.close(); }
});

test('expired in-flight leases release concurrency but retain uncertain charges', () => {
  let now = Date.parse('2026-10-08T18:00:00Z'); const store = new QuotaStore({ now: () => now, limits: { concurrency: 1 } }); const client = randomUUID();
  try {
    const id = randomUUID(); store.reserve(client, id, 'ip'); now += 120_001;
    reserve(store, randomUUID()); assert.equal(store.usage(client).remaining, 4);
    assert.throws(() => store.reserve(client, id, 'ip'), errorCode('DUPLICATE_REQUEST'));
  } finally { store.close(); }
});

async function service(t, options = {}) {
  const app = createApp(options); app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); app.quotaStore.close(); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const post = (route, body, token, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers }, body: JSON.stringify(body) });
  const installationId = randomUUID(); const session = await (await post('/v1/session', { installationId })).json();
  return { app, base, post, installationId, session, body: { text: 'Dinner tomorrow at 7 PM', context, mode: 'mock', requestId: randomUUID() } };
}

test('mock returns four separately dated matches and refuses arbitrary screenshots without charging', async t => {
  const s = await service(t);
  const denied = await s.post('/v1/analyses', { ...s.body, image: 'data:image/png;base64,AA==' }, s.session.token);
  assert.equal(denied.status, 503); assert.equal((await denied.json()).usage.remaining, 5);
  const result = await (await s.post('/v1/analyses', { ...s.body, image: 'data:image/png;base64,AA==', fixture: 'matches' }, s.session.token)).json();
  assert.equal(result.mode, 'mock'); assert.equal(result.usage.remaining, 4);
  assert.deepEqual(result.events.map(e => [e.title, e.date, e.startTime]), [['PRX vs T1', 'tomorrow', '04:00'], ['NS vs 100T', 'tomorrow', '07:00'], ['LOUD vs NRG', '2026-10-10', '04:00'], ['VIT vs G2', '2026-10-10', '07:00']]);
  assert.ok(result.events.every(e => /DEVELOPMENT FIXTURE/.test(e.evidence)));
});

test('HTTP quota exhaustion, bad sessions and legacy routes cannot dispatch the extractor', async t => {
  let calls = 0; const s = await service(t, { extractor: async () => { calls++; return [candidate]; } });
  assert.equal((await s.post('/v1/analyses', s.body)).status, 401);
  for (const route of ['/api/extract', '/api/extract-local']) assert.equal((await s.post(route, s.body, s.session.token)).status, 404);
  for (let i = 0; i < 5; i++) assert.equal((await s.post('/v1/analyses', { ...s.body, requestId: randomUUID() }, s.session.token)).status, 200);
  const exhausted = await s.post('/v1/analyses', { ...s.body, requestId: randomUUID() }, s.session.token);
  assert.equal(exhausted.status, 429); assert.ok(exhausted.headers.get('Retry-After')); assert.equal(calls, 5);
});

test('repeated simultaneous requests dispatch once; quota failure is fail closed', async t => {
  let release; let started; let calls = 0;
  const start = new Promise(resolve => { started = resolve; }); const hold = new Promise(resolve => { release = resolve; });
  const s = await service(t, { extractor: async () => { calls++; started(); await hold; return [candidate]; } });
  const first = s.post('/v1/analyses', s.body, s.session.token); await start;
  const duplicate = await s.post('/v1/analyses', s.body, s.session.token); assert.equal(duplicate.status, 409);
  release(); assert.equal((await first).status, 200); assert.equal(calls, 1);
  s.app.quotaStore.reserve = () => { throw new Error('database-secret'); };
  const failed = await s.post('/v1/analyses', { ...s.body, requestId: randomUUID() }, s.session.token);
  assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes('database-secret')); assert.equal(calls, 1);
});

test('unavailable SQLite store fails closed with a stable error', () => {
  const store = new QuotaStore(); store.close();
  assert.throws(() => store.reserve(randomUUID(), randomUUID(), 'ip'), errorCode('QUOTA_UNAVAILABLE'));
});

test('operator kill switch blocks dispatch without consuming allowance', async t => {
  let calls = 0; const s = await service(t, { analysisEnabled: false, extractor: async () => { calls++; return []; } });
  const result = await s.post('/v1/analyses', s.body, s.session.token);
  assert.equal(result.status, 503); const body = await result.json(); assert.equal(body.error.code, 'SERVICE_DISABLED'); assert.equal(body.usage.remaining, 5); assert.equal(calls, 0);
});

test('origins, body limits and invalid inputs are checked without charging; secrets never served', async t => {
  let calls = 0; const s = await service(t, { maxBodyBytes: 1200, extractor: async () => { calls++; return []; } });
  assert.equal((await s.post('/v1/analyses', s.body, s.session.token, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await s.post('/v1/analyses', { ...s.body, text: 'x'.repeat(2000) }, s.session.token)).status, 413);
  assert.equal((await s.post('/v1/analyses', { ...s.body, context: { ...context, anchorDate: '2026-10-09' } }, s.session.token)).status, 400);
  assert.equal(s.app.quotaStore.usage(s.installationId).remaining, 5); assert.equal(calls, 0);
  assert.equal((await fetch(s.base + '/.env')).status, 404);
  const preview = await fetch(s.base + '/sidepanel.html'); assert.equal(preview.status, 200); assert.match(preview.headers.get('Content-Security-Policy'), /connect-src 'self';/);
  assert.deepEqual(await (await fetch(s.base + '/api/health')).json(), { ready: true, mode: 'mock', cloudEnabled: false });
});

test('provider errors and malformed output stay sanitized and counted, without retries', async t => {
  let calls = 0; const s = await service(t, { extractor: async () => { if (++calls === 1) throw new Error('provider-private-key'); return [{}]; } });
  for (let i = 0; i < 2; i++) {
    const result = await s.post('/v1/analyses', { ...s.body, requestId: randomUUID() }, s.session.token);
    assert.equal(result.status, 502); assert.ok(!(await result.text()).includes('provider-private-key'));
  }
  assert.equal(calls, 2); assert.equal(s.app.quotaStore.usage(s.installationId).remaining, 3);
});

test('canceling an analysis releases its slot while retaining the uncertain charge', async t => {
  let started; const start = new Promise(resolve => { started = resolve; });
  const s = await service(t, { store: new QuotaStore({ limits: { concurrency: 1 } }), extractor: async (_input, { signal }) => {
    started(); await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const controller = new AbortController();
  const pending = fetch(s.base + '/v1/analyses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.session.token }, body: JSON.stringify(s.body), signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' }); await start; controller.abort(); await rejected;
  for (let i = 0; i < 20 && s.app.quotaStore.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE active=1').get().n; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(s.app.quotaStore.usage(s.installationId).remaining, 4);
  assert.equal(s.app.quotaStore.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE active=1').get().n, 0);
});

test('client uses keyless session contract, reports quota, and blocks real mock images before reading pixels', async t => {
  const s = await service(t); const usages = []; const client = new AnalysisClient({ installationId: s.installationId, origin: s.base, onUsage: u => usages.push(u) });
  await assert.rejects(() => client.analyze({ image: new Blob(['private'], { type: 'image/png' }), context }), /not connected/);
  assert.equal(usages.length, 0);
  const events = await client.analyze({ text: 'Dinner tomorrow at 7 PM', context }); assert.equal(events.length, 1); assert.equal(usages.at(-1).remaining, 4);
});

test('structured page events remain usable without visible page text', async t => {
  const s = await service(t); const result = await s.post('/v1/analyses', { ...s.body, text: '', structuredEvents: [
    { name: 'Conference', startDate: '2026-10-10T09:00', endDate: '2026-10-10T10:00', location: 'Hall' },
  ] }, s.session.token);
  assert.equal(result.status, 200); const body = await result.json();
  assert.equal(body.events.length, 1); assert.equal(body.events[0].title, 'Conference'); assert.equal(body.events[0].date, '2026-10-10');
});

test('mock empty, outage, invalid response and timeout scenarios keep a stable contract', async t => {
  const s = await service(t);
  for (const [scenario, status, code] of [['empty', 200, null], ['unavailable', 503, 'PROVIDER_UNAVAILABLE'], ['invalid', 502, 'INVALID_OUTPUT'], ['timeout', 504, 'ANALYSIS_TIMEOUT']]) {
    const result = await s.post('/v1/analyses', { ...s.body, requestId: randomUUID(), scenario }, s.session.token);
    assert.equal(result.status, status); const body = await result.json();
    if (code) assert.equal(body.error.code, code); else assert.deepEqual(body.events, []);
    assert.equal(body.mode, 'mock');
  }
  assert.equal(s.app.quotaStore.usage(s.installationId).remaining, 1);
});
