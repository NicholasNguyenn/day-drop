import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { makeAnalysisContext } from '../shared/dates.mjs';

// Node has no Cloudflare runtime: stand in for its base class and for Durable Object storage.
registerHooks({ resolve: (specifier, context, next) => specifier === 'cloudflare:workers'
  ? { url: 'data:text/javascript,export class DurableObject { constructor(ctx, env) { Object.assign(this, { ctx, env }); } }', shortCircuit: true }
  : next(specifier, context) });
const { default: worker, Analysis } = await import('../server/worker.mjs');

function storage() {
  const db = new DatabaseSync(':memory:');
  return {
    sql: { exec(query, ...values) {
      if (query.includes('CREATE TABLE')) { db.exec(query); return { toArray: () => [] }; }
      const rows = db.prepare(query).all(...values); return { toArray: () => rows };
    } },
    transactionSync(fn) {
      db.exec('BEGIN');
      try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}
const context = makeAnalysisContext('America/Chicago', '2026-10-08T18:00:00Z');
const event = { title: 'Dinner', date: 'tomorrow', startTime: '19:00', endDate: null, endTime: null,
  timeZone: null, allDay: false, location: '', description: '', evidence: 'Dinner tomorrow at 7 PM', uncertainties: [] };
const configured = { GEMINI_API_KEY: 'server-only-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true', GEMINI_RPM: '20', GEMINI_RPD: '100', GEMINI_TPM: '100000' };

test('Cloudflare entry refuses blocked regions, stays off until configured, and keeps usage in Durable Object storage', async t => {
  t.mock.method(console, 'error', () => {});
  const provider = t.mock.method(globalThis, 'fetch', async () => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ events: [event] }) }] } }] }));
  const disk = storage(); const hints = []; let object;
  const start = variables => {
    const env = { ...variables, ANALYSIS: { idFromName: name => name, get: (_id, options) => { hints.push(options.locationHint); return object; } } };
    object = new Analysis({ storage: disk }, env);
    return (path, { country = 'US', token, body } = {}) => worker.fetch(Object.assign(new Request('https://daydrop-api.example' + path, {
      method: body ? 'POST' : 'GET', body: body && JSON.stringify(body),
      headers: { 'cf-connecting-ip': '203.0.113.7', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }), { cf: country ? { country } : undefined }), env);
  };

  let call = start({ GEMINI_FREE_TIER_CONFIRMED: 'false', GEMINI_RPM: '0', GEMINI_RPD: '0', GEMINI_TPM: '0' });
  for (const country of ['GB', 'DE', 'CH', 'XX', null]) {
    const refused = await call('/api/health', { country });
    assert.equal(refused.status, 451); assert.equal((await refused.json()).error.code, 'REGION_UNAVAILABLE');
  }
  assert.equal(hints.length, 0);
  const off = await call('/api/health'); assert.equal(off.status, 503);
  assert.ok(!JSON.stringify(await off.json()).includes('GEMINI'));

  call = start(configured);
  assert.deepEqual(await (await call('/api/health')).json(), { ready: true, mode: 'gemini', cloudEnabled: true });
  const installationId = randomUUID(); const session = await (await call('/v1/session', { body: { installationId } })).json();
  const body = { text: 'Dinner tomorrow at 7 PM', context, mode: 'gemini', requestId: randomUUID() };
  assert.equal((await call('/v1/analyses', { body })).status, 401);
  assert.equal((await call('/v1/analyses', { token: session.token, body: { ...body, image: 'data:image/png;base64,AA==' } })).status, 400);
  assert.equal(provider.mock.callCount(), 0);
  const result = await (await call('/v1/analyses', { token: session.token, body })).json();
  assert.equal(result.events.length, 1); assert.equal(result.usage.remaining, 4);
  const [url, options] = provider.mock.calls[0].arguments;
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//); assert.equal(options.redirect, 'manual');
  assert.ok(hints.every(hint => hint === 'enam'));

  // A restarted object finds the signing secret and the counters in its storage.
  call = start(configured);
  assert.equal((await (await call('/v1/usage', { token: session.token })).json()).usage.remaining, 4);
  assert.equal((await call('/v1/analyses', { token: session.token, body })).status, 409);
});
