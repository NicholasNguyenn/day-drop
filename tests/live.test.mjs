import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { QuotaStore } from '../server/quota.mjs';
import { liveConfiguration } from '../server/runtime.mjs';
import { inspectImage } from '../server/image-validation.mjs';
import { extractWithGemini } from '../server/gemini.mjs';
import { parseExtraction } from '../shared/extraction.mjs';
import { makeAnalysisContext } from '../shared/dates.mjs';
import { AnalysisClient } from '../dist/extension/service.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-08T18:00:00Z');
const event = { title: 'Dinner', date: 'tomorrow', startTime: '19:00', endDate: null, endTime: null,
  timeZone: null, allDay: false, location: '', description: '', evidence: 'Dinner tomorrow at 7 PM', uncertainties: [] };
const fixture = await readFile(new URL('./fixtures/events.png', import.meta.url));
const png = 'data:image/png;base64,' + fixture.toString('base64');
const config = () => liveConfiguration({ GEMINI_API_KEY: 'server-only-test-key', GEMINI_FREE_TIER_CONFIRMED: 'true', GEMINI_RPM: '20', GEMINI_RPD: '100', GEMINI_TPM: '100000' });
const response = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('live startup requires a key, owner free-project confirmation and real quota values', () => {
  assert.throws(() => liveConfiguration({}), /unbilled/);
  assert.throws(() => liveConfiguration({ GEMINI_FREE_TIER_CONFIRMED: 'true' }), /owner Gemini key/);
  const base = { GEMINI_FREE_TIER_CONFIRMED: 'true', GEMINI_API_KEY: 'test' };
  assert.throws(() => liveConfiguration(base), /RPM/);
  assert.throws(() => liveConfiguration({ ...base, GEMINI_MODEL: 'paid-alternative' }), /Only/);
  assert.equal(config().limits.globalBurst, 2); assert.equal(config().limits.globalDaily, 10);
  assert.throws(() => createApp({ mode: 'gemini' }), /verified owner/);
});

test('image guards reject disguised formats, noncanonical bytes and excessive dimensions', () => {
  assert.ok(inspectImage(png).width > 0);
  for (const invalid of ['data:image/png;base64,AA==', 'data:image/png;base64,AB==', png.replace('image/png', 'image/jpeg')]) assert.throws(() => inspectImage(invalid), error => error.code === 'INVALID_IMAGE');
  const large = Buffer.from(fixture); large.writeUInt32BE(5000,16);
  assert.throws(() => inspectImage('data:image/png;base64,' + large.toString('base64')), error => error.code === 'IMAGE_DIMENSIONS');
  // Header-only fixtures exercise bounds without decoding or calling a provider.
  const jpeg = Buffer.from([255,216,255,192,0,8,8,0,100,0,200,0,255,217]);
  assert.deepEqual([inspectImage('data:image/jpeg;base64,' + jpeg.toString('base64')).width, inspectImage('data:image/jpeg;base64,' + jpeg.toString('base64')).height], [200,100]);
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22,4); webp.write('WEBPVP8X',8); webp.writeUInt32LE(10,16); webp.writeUIntLE(199,24,3); webp.writeUIntLE(99,27,3);
  assert.equal(inspectImage('data:image/webp;base64,' + webp.toString('base64')).width, 200);
  webp[20] = 2; assert.throws(() => inspectImage('data:image/webp;base64,' + webp.toString('base64')), /animated/);
});

test('provider Pacific-day counters survive a UTC date change; token rejection rolls back all allowance', () => {
  let now = Date.parse('2026-10-08T23:59:00Z');
  const store = new QuotaStore({ now: () => now, limits: { providerDaily: 1, tokenPerMinute: 100 } }); const client = randomUUID();
  try {
    const id = randomUUID(); store.reserve(client, id, 'ip', { inputTokens: 80 }); store.finish(client,id);
    now += 60_001;
    assert.throws(() => store.reserve(client, randomUUID(), 'ip', { inputTokens: 10 }), error => error.code === 'PROVIDER_DAILY_LIMIT');
    assert.equal(store.usage(client).remaining, 5); // Application UTC day reset; provider Pacific day did not.
    now = Date.parse('2026-10-09T07:00:01Z');
    const next = randomUUID(); store.reserve(client,next,'ip',{inputTokens:80}); store.finish(client,next);
    assert.equal(store.usage(client).remaining, 4);
  } finally { store.close(); }
  const tokens = new QuotaStore({ limits: { tokenPerMinute: 100 } }); const id = randomUUID();
  try { assert.throws(() => tokens.reserve(id, randomUUID(),'ip',{inputTokens:101}), error => error.code === 'TOKEN_LIMIT'); assert.equal(tokens.usage(id).remaining, 5); }
  finally { tokens.close(); }
});

test('provider rolling request and token limits cannot be bypassed across minute boundaries', () => {
  let now = Date.parse('2026-10-08T18:00:59Z');
  const store = new QuotaStore({ now:()=>now, limits:{providerDaily:10,tokenPerMinute:100,globalBurst:1} });
  try {
    const client=randomUUID(); const id=randomUUID(); store.reserve(client,id,'ip',{inputTokens:60}); store.finish(client,id);
    now+=2000; assert.throws(()=>store.reserve(randomUUID(),randomUUID(),'ip',{inputTokens:30}),error=>error.code==='THROTTLED');
    now+=60000; const next=randomUUID(); store.reserve(client,next,'ip',{inputTokens:60}); store.finish(client,next);
  } finally {store.close();}
  now = Date.parse('2026-10-08T18:00:59Z');
  const tokens=new QuotaStore({now:()=>now,limits:{tokenPerMinute:100}});
  try {const client=randomUUID();const id=randomUUID();tokens.reserve(client,id,'ip',{inputTokens:60});tokens.finish(client,id);now+=2000;assert.throws(()=>tokens.reserve(client,randomUUID(),'ip',{inputTokens:60}),error=>error.code==='TOKEN_LIMIT');}
  finally{tokens.close();}
});

test('vision adapter includes page evidence, rejects oversized/unfinished responses and never enables tools', async () => {
  let body;
  await extractWithGemini({ text:'Dinner',structuredEvents:[{name:'Dinner'}],context },{ apiKey:'test',fetcher:async (_url, options) => {
    body = JSON.parse(options.body); assert.equal(options.redirect,'error');
    return response({ candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({events:[event]})}]}}] });
  } });
  assert.match(body.contents[0].parts[0].text,/PAGE EVENT DATA/); assert.equal(body.tools,undefined); assert.equal(body.generationConfig.maxOutputTokens,8192);
  assert.equal(body.generationConfig.responseJsonSchema.properties.events.maxItems,undefined);
  assert.throws(() => parseExtraction({events:Array.from({length:51},()=>({...event}))},context),/invalid event list/);
  await assert.rejects(() => extractWithGemini({text:'Dinner',context},{apiKey:'test',fetcher:async()=>new Response('x'.repeat(270000))}), error=>error.code==='INVALID_OUTPUT');
  assert.throws(() => parseExtraction({events:[{...event,title:'x'.repeat(181)}]},context),/oversized/);
});

test('live HTTP path sends original image only after quotas and rejects mock/model overrides', async t => {
  let calls = 0; const providerConfig = config();
  const app = createApp({ mode:'gemini',providerConfig,store:new QuotaStore({limits:{...providerConfig.limits,globalDaily:1}}),extractor:async (input, options)=>{
    calls++; assert.equal(input.image,png); assert.equal(options.fixture,undefined); return {events:[event]};
  } });
  app.listen(0,'127.0.0.1'); await once(app,'listening');
  t.after(async()=>{await new Promise(resolve=>app.close(resolve));app.quotaStore.close();});
  const base='http://127.0.0.1:'+app.address().port;
  const post=(route,body,token)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
  const installationId=randomUUID(); const session=await(await post('/v1/session',{installationId})).json();
  const body={image:png,context,mode:'gemini',requestId:randomUUID()};
  assert.equal((await post('/v1/analyses',{...body,mode:'mock'},session.token)).status,409);
  assert.equal((await post('/v1/analyses',{...body,fixture:'matches'},session.token)).status,400);
  assert.equal((await post('/v1/analyses',{...body,image:'data:image/png;base64,AA=='},session.token)).status,400);
  assert.equal(app.quotaStore.usage(installationId).remaining,5); assert.equal(calls,0);
  const valid=await(await post('/v1/analyses',body,session.token)).json(); assert.equal(valid.mode,'gemini'); assert.equal(valid.events.length,1); assert.equal(valid.usage.remaining,4);
  assert.equal((await post('/v1/analyses',{...body,requestId:randomUUID()},session.token)).status,429); assert.equal(calls,1);
  assert.ok(!(await(await fetch(base+'/service-config.mjs')).text()).includes('server-only-test-key'));
  assert.equal((await fetch(base+'/server/runtime.mjs')).status,404);
  const mockClient = new AnalysisClient({installationId:randomUUID(),origin:base});
  await assert.rejects(()=>mockClient.usage(),/mode changed/); assert.equal(calls,1);
});
