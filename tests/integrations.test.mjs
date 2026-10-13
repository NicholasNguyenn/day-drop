import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, validateInput } from '../server/index.mjs';
import { extractWithGemini, ServiceError } from '../server/gemini.mjs';
import { makeAnalysisContext } from '../shared/dates.mjs';
import { normalizeCandidates } from '../shared/events.mjs';
import { importGoogleEvents, listCalendars, createCalendar } from '../dist/extension/google.mjs';
import { backendUrl } from '../dist/extension/service.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-06T18:00:00Z');
const candidate = { title: 'Dinner', date: 'tomorrow', startTime: '19:00', endDate: null,
  endTime: '20:00', timeZone: null, allDay: false, location: 'Cafe', description: '',
  evidence: 'Dinner tomorrow 7–8pm', uncertainties: [] };
const draft = () => normalizeCandidates([candidate], context)[0];
const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('backend input rejects spoofed date anchors and unsupported image formats', () => {
  assert.equal(validateInput({ text: 'Dinner tomorrow', context }).context.anchorDate, '2026-10-06');
  assert.throws(() => validateInput({ text: 'Dinner', context: { ...context, anchorDate: '2026-10-07' } }), /does not match/);
  assert.throws(() => validateInput({ image: 'data:text/html;base64,AA==', context }), /PNG/);
  assert.throws(() => validateInput({ text: '', context }), /Provide text/);
  assert.throws(() => backendUrl('http://remote.example'), /HTTPS/);
  assert.throws(() => backendUrl('https://user:password@example.com'), /HTTPS/);
  assert.equal(backendUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
});

test('Gemini adapter sends image plus frozen date/schema and never returns its key', async () => {
  let request;
  const output = await extractWithGemini({ text: '', image: 'data:image/png;base64,AA==', context }, {
    apiKey: 'test-key', fetcher: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return response(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ events: [candidate] }) }] } }] });
    },
  });
  assert.match(request.url, /gemini-3.5-flash-lite:generateContent$/);
  assert.match(request.body.systemInstruction.parts[0].text, /2026-10-06/);
  assert.equal(request.body.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.equal(request.body.generationConfig.responseJsonSchema.type, 'object');
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(output.events, [candidate]);
  assert.ok(!JSON.stringify(output).includes('test-key'));
});

test('Gemini service fails explicitly on missing setup, quota, or incomplete output', async () => {
  await assert.rejects(() => extractWithGemini({ text: 'event', context }, { apiKey: '' }), /not configured/);
  await assert.rejects(() => extractWithGemini({ text: 'event', context }, { apiKey: 'test', fetcher: async () => response(429, {}) }), error => error.code === 'PROVIDER_QUOTA');
  await assert.rejects(() => extractWithGemini({ text: 'event', context }, { apiKey: 'test', fetcher: async () => response(200, { candidates: [{ finishReason: 'MAX_TOKENS' }] }) }), /did not finish/);
});

test('Calendar list paginates and only includes calendars covered by owned scopes', async () => {
  let calls = 0;
  const calendars = await listCalendars('test-token', async url => {
    calls++;
    return calls === 1 ? response(200, { items: [{ id: 'shared', accessRole: 'writer' }, { id: 'own', accessRole: 'owner' }], nextPageToken: 'next' })
      : (assert.match(url, /pageToken=next/), response(200, { items: [{ id: 'primary', primary: true, accessRole: 'owner' }] }));
  });
  assert.equal(calls, 2); assert.deepEqual(calendars.map(item => item.id), ['primary', 'own']);
});

test('creating a calendar posts a trimmed name and rejects an empty one', async () => {
  let request;
  const created = await createCalendar('test-token', '  Daydrop  ', async (url, options) => {
    request = { url, options }; return response(200, { id: 'new', summary: 'Daydrop' });
  });
  assert.match(request.url, /calendar\/v3\/calendars$/); assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { summary: 'Daydrop' }); assert.equal(created.id, 'new');
  await assert.rejects(() => createCalendar('test-token', '   ', async () => assert.fail('no request expected')), /Enter a name/);
});

test('repeat Calendar imports skip existing fingerprints and make lost-response retries safe', async () => {
  const posts = []; const item = draft();
  const fetcher = async (url, options) => {
    if (options.method === 'POST') { posts.push(JSON.parse(options.body)); return response(posts.length === 1 ? 200 : 409, { htmlLink: 'https://calendar.google.com/event' }); }
    assert.match(url, /privateExtendedProperty=autoCalendarFingerprint/);
    return response(200, { items: [] });
  };
  assert.equal((await importGoogleEvents([item], 'calendar', 'token', { fetcher }))[0].status, 'added');
  assert.equal((await importGoogleEvents([item], 'calendar', 'token', { fetcher }))[0].status, 'duplicate');
  assert.equal(posts[0].id, posts[1].id); assert.match(posts[0].id, /^[0-9a-v]+$/);
  const skipped = await importGoogleEvents([item], 'calendar', 'token', { fetcher: async () => response(200, { items: [{ id: 'existing', status: 'confirmed' }] }) });
  assert.equal(skipped[0].status, 'duplicate');
});

test('Calendar imports preserve partial successes and surface the failed event', async () => {
  let inserts = 0;
  const results = await importGoogleEvents([draft(), draft()], 'calendar', 'token', { fetcher: async (_url, options) => {
    if (options.method !== 'POST') return response(200, { items: [] });
    return ++inserts === 1 ? response(200, {}) : response(403, {});
  } });
  assert.deepEqual(results.map(item => item.status), ['added', 'failed']);
  assert.match(results[1].error, /grant access/);
});
