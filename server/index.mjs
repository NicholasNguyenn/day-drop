import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDate, isTimeZone, makeAnalysisContext } from '../shared/dates.mjs';
import { ServiceError, extractWithGemini, estimateInputTokens } from './gemini.mjs';
import { QuotaStore, ApiError, developmentDatabase } from './quota.mjs';
import { extractMock, validateMock } from './mock.mjs';
import { parseExtraction } from '../shared/extraction.mjs';
import { inspectImage } from './image-validation.mjs';

const assets = new Map([
  ...['sidepanel.html', 'sidepanel.css', 'sidepanel.mjs', 'providers.mjs', 'service.mjs', 'service-config.mjs', 'demo.mjs', 'google.mjs'].map(file =>
    ['/' + file, ['../extension/' + file, file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript']]),
  ...['dates', 'events', 'ics', 'extraction', 'basic-extraction', 'visual-dates'].map(name => ['/shared/' + name + '.mjs', ['../shared/' + name + '.mjs', 'text/javascript']]),
  ['/icons/daydrop.svg', ['../extension/icons/daydrop.svg', 'image/svg+xml']],
]);
function readJson(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0; let rejected = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit && !rejected) { rejected = true; reject(new ApiError('CAPTURE_TOO_LARGE', 'Use a smaller screenshot.', 413)); }
      if (!rejected) chunks.push(chunk);
    });
    request.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError('INVALID_JSON', 'Request must contain valid JSON.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new ApiError('CANCELED', 'Request canceled.', 499)));
  });
}
export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError('Invalid analysis request.');
  const text = body.text ?? '';
  if (typeof text !== 'string' || text.length > 44000) throw new ServiceError('Page text is too large. Select a smaller section.');
  const image = body.image ?? null;
  if (image !== null && (typeof image !== 'string' || image.length > 11_200_000
    || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(image))) throw new ServiceError('Use a PNG, JPEG, or WebP screenshot smaller than 8 MB.');
  const structuredEvents = body.structuredEvents ?? [];
  if (!Array.isArray(structuredEvents) || structuredEvents.length > 30) throw new ServiceError('Invalid structured event data.');
  if (JSON.stringify(structuredEvents).length > 12_000) throw new ServiceError('Select a smaller section of the page.');
  if (!text.trim() && !image && !structuredEvents.length) throw new ServiceError('Provide text or a screenshot to analyze.');
  const context = body.context;
  if (!context || !isTimeZone(context.timeZone) || !isDate(context.anchorDate)
    || typeof context.analyzedAt !== 'string' || !Number.isFinite(Date.parse(context.analyzedAt))) throw new ServiceError('Invalid analysis date or time zone.');
  const expected = makeAnalysisContext(context.timeZone, context.analyzedAt);
  if (expected.anchorDate !== context.anchorDate) throw new ServiceError('Analysis date does not match its time zone.');
  return { text, image, structuredEvents, context: expected };
}

// Mock is always the default. Only the explicit live entry point enables Gemini.
export function createApp({ store = new QuotaStore(), mode = 'mock', extractor, providerConfig, maxBodyBytes = 12_000_000,
  analysisEnabled = process.env.ANALYSIS_ENABLED !== 'false', extensionId = process.env.ALLOWED_EXTENSION_ID || '' } = {}) {
  if (!['mock', 'gemini'].includes(mode)) throw new Error('Unsupported analysis mode.');
  if (mode === 'gemini' && (!providerConfig?.apiKey || providerConfig.model !== 'gemini-3.5-flash-lite' || !store.limits.providerDaily || !store.limits.tokenPerMinute)) throw new Error('Live mode requires verified owner configuration and provider budgets.');
  const analyze = extractor || (mode === 'mock' ? extractMock : (input, options) => extractWithGemini(input, { ...providerConfig, ...options }));
  const app = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
    };
    const origin = request.headers.origin;
    const extensionOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
      && (!extensionId || origin === 'chrome-extension://' + extensionId);
    if (origin && !extensionOrigin && origin !== 'http://' + request.headers.host) {
      send(403, { error: { code: 'ORIGIN_REJECTED', message: 'This origin cannot use the development service.' } }); return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/health') { send(200, { ready: true, mode, cloudEnabled: mode === 'gemini' }); return; }
    if (request.method === 'GET' && url.pathname === '/service-config.mjs') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      response.end("export const serviceOrigin = 'http://127.0.0.1:8788';\nexport const serviceMode = " + JSON.stringify(mode) + ';\n'); return;
    }
    if (request.method === 'GET' && url.pathname === '/') { response.writeHead(302, { Location: '/sidepanel.html' }); response.end(); return; }
    if (request.method === 'GET' && assets.has(url.pathname)) {
      try {
        const [file, type] = assets.get(url.pathname); const content = await readFile(new URL(file, import.meta.url));
        response.writeHead(200, { 'Content-Type': type + '; charset=utf-8',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none';" }); response.end(content);
      } catch { send(404, { error: { code: 'NOT_FOUND', message: 'Preview asset not found.' } }); }
      return;
    }
    let client = null; let reserved = false; let body;
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    try {
      const ip = request.socket.remoteAddress || 'unknown'; // Never trust arbitrary X-Forwarded-For.
      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        client = store.authenticate(request.headers.authorization);
        send(200, { usage: store.usage(client), mode }); return;
      }
      if (request.method !== 'POST' || !['/v1/session', '/v1/analyses'].includes(url.pathname)) {
        throw new ApiError('NOT_FOUND', 'Route not found.', 404);
      }
      if (!request.headers['content-type']?.startsWith('application/json')) throw new ApiError('CONTENT_TYPE', 'Use application/json.', 415);
      if (url.pathname === '/v1/analyses') client = store.authenticate(request.headers.authorization);
      body = await readJson(request, url.pathname === '/v1/session' ? 2048 : maxBodyBytes);
      if (url.pathname === '/v1/session') {
        send(200, { ...store.session(body?.installationId, ip), mode }); return;
      }
      if (body?.mode !== mode) throw new ApiError('MODE_CHANGED', 'Analysis mode changed. Reload the panel before sending a capture.', 409);
      if (!app.analysisEnabled) throw new ApiError('SERVICE_DISABLED', 'Analysis is temporarily paused. Editing and ICS export remain available.', 503);
      const input = validateInput(body);
      if (mode === 'mock') validateMock(input, body);
      else {
        if (body.scenario || body.fixture || body.model || body.endpoint) throw new ApiError('INVALID_INPUT', 'Development overrides are not accepted by live analysis.');
        if (input.image) inspectImage(input.image);
      }
      store.reserve(client, body.requestId, ip, mode === 'gemini' ? { inputTokens: estimateInputTokens(input) } : {}); reserved = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
      const output = await analyze(input, { signal, ...(mode === 'mock' ? { fixture: body.fixture, scenario: body.scenario } : {}) });
      const events = parseExtraction(Array.isArray(output) ? { events: output } : output, input.context);
      send(200, { events, usage: store.usage(client), mode });
    } catch (error) {
      const known = error instanceof ApiError || error instanceof ServiceError;
      const detail = { code: error.code || (known ? 'INVALID_INPUT' : controller.signal.aborted ? 'CANCELED' : error.name === 'TimeoutError' ? 'ANALYSIS_TIMEOUT' : 'ANALYSIS_FAILED'),
        message: known ? error.message : 'Analysis could not finish. No automatic retry was made.' };
      if (error.resetAt) { detail.resetAt = error.resetAt; response.setHeader('Retry-After', Math.max(1, Math.ceil((Date.parse(error.resetAt) - Date.now()) / 1000))); }
      let usage;
      if (client) { try { usage = store.usage(client); } catch { /* Fail closed; unavailable usage is never unlimited. */ } }
      send(known ? error.status : 502, { error: detail, ...(usage ? { usage } : {}), mode });
    } finally {
      if (reserved) { try { store.finish(client, body.requestId); } catch { /* Lease expires; never refund uncertain usage. */ } }
    }
  });
  app.quotaStore = store;
  app.analysisEnabled = analysisEnabled;
  return app;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const app = createApp({ store: new QuotaStore({ filename: developmentDatabase() }) });
  app.on('error', error => { console.error('Could not start development service: ' + error.message); process.exitCode = 1; });
  app.listen(port, '127.0.0.1', () => console.log('Auto Calendar mock service (no provider uploads): http://127.0.0.1:' + port));
}
