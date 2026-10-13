import { isDate, isTimeZone, makeAnalysisContext } from '../shared/dates.mjs';
import { ServiceError, extractWithGemini, estimateInputTokens } from './gemini.mjs';
import { ApiError } from './quota-core.mjs';
import { extractMock, validateMock } from './mock.mjs';
import { parseExtraction } from '../shared/extraction.mjs';
import { inspectImage } from './image-validation.mjs';

async function readJson(request, limit) {
  const chunks = []; let bytes = 0;
  try {
    // Read to the end even when oversized, so the connection stays usable; keep at most `limit` bytes.
    for await (const chunk of request.body || []) { bytes += chunk.byteLength; if (bytes <= limit) chunks.push(chunk); }
  } catch { throw new ApiError('CANCELED', 'Request canceled.', 499); }
  if (bytes > limit) throw new ApiError('CAPTURE_TOO_LARGE', 'Use a smaller screenshot.', 413);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('INVALID_JSON', 'Request must contain valid JSON.'); }
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

// Owner settings for live analysis: a private file locally, secrets and variables on Cloudflare.
export function liveConfiguration(env = process.env) {
  if (env.GEMINI_FREE_TIER_CONFIRMED !== 'true') throw new Error('Verify an unbilled Free-tier project, then set GEMINI_FREE_TIER_CONFIRMED=true in the owner config.');
  if (!env.GEMINI_API_KEY?.trim() || env.GEMINI_API_KEY === 'your-key-here') throw new Error('Add your owner Gemini key to the private backend config.');
  if ((env.GEMINI_MODEL || 'gemini-3.5-flash-lite') !== 'gemini-3.5-flash-lite') throw new Error('Only the verified Flash-Lite model is enabled for initial free testing.');
  const values = ['GEMINI_RPM','GEMINI_RPD','GEMINI_TPM'].map(key => Number(env[key]));
  if (values.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Copy positive RPM, RPD and TPM limits for this model from AI Studio into the owner config.');
  const [perMinute, perDay, tokens] = values.map(value => Math.max(1, Math.floor(value * .8)));
  const port = Number(env.PORT || 8788);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid local service port.');
  return { apiKey: env.GEMINI_API_KEY.trim(), model: 'gemini-3.5-flash-lite', port, analysisEnabled: env.ANALYSIS_ENABLED !== 'false', limits: {
    // Everyone together may use 80% of each provider limit. A few analyses run at once,
    // so one slow capture does not make every other user wait.
    daily: 5, ipDaily: 10, globalDaily: perDay, globalBurst: perMinute, concurrency: 3,
    providerDaily: perDay, tokenPerMinute: tokens,
  } };
}

// The analysis service as one function from request to response, shared by the local
// Node server and the Cloudflare Durable Object. `request` is a Fetch Request, or anything
// with its method, url, headers, body and signal. `preview` may answer extra GET routes.
// Mock is always the default. Only the explicit live entry points enable Gemini.
export function createService({ store, mode = 'mock', extractor, providerConfig, maxBodyBytes = 12_000_000,
  analysisEnabled = true, extensionId = '', preview } = {}) {
  if (!['mock', 'gemini'].includes(mode)) throw new Error('Unsupported analysis mode.');
  if (mode === 'gemini' && (!providerConfig?.apiKey || providerConfig.model !== 'gemini-3.5-flash-lite' || !store.limits.providerDaily || !store.limits.tokenPerMinute)) throw new Error('Live mode requires verified owner configuration and provider budgets.');
  const analyze = extractor || (mode === 'mock' ? extractMock : (input, options) => extractWithGemini(input, { ...providerConfig, ...options }));
  return async function handle(request, { ip = 'unknown' } = {}) {
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const send = (status, value) => {
      headers.set('Content-Type', 'application/json; charset=utf-8'); return new Response(JSON.stringify(value), { status, headers });
    };
    const origin = request.headers.get('origin');
    const extensionOrigin = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
      && (!extensionId || origin === 'chrome-extension://' + extensionId);
    if (origin && !extensionOrigin && origin !== 'http://' + request.headers.get('host')) {
      return send(403, { error: { code: 'ORIGIN_REJECTED', message: 'This origin cannot use the analysis service.' } });
    }
    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin); headers.set('Vary', 'Origin');
      headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') return send(200, { ready: true, mode, cloudEnabled: mode === 'gemini' });
    const extra = request.method === 'GET' && await preview?.(url.pathname);
    if (extra) { headers.forEach((value, name) => extra.headers.set(name, value)); return extra; }
    let client = null; let reserved = false; let body;
    try {
      if (request.method === 'GET' && url.pathname === '/v1/usage') {
        client = store.authenticate(request.headers.get('authorization'));
        return send(200, { usage: store.usage(client), mode });
      }
      if (request.method !== 'POST' || !['/v1/session', '/v1/analyses'].includes(url.pathname)) {
        throw new ApiError('NOT_FOUND', 'Route not found.', 404);
      }
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('CONTENT_TYPE', 'Use application/json.', 415);
      if (url.pathname === '/v1/analyses') client = store.authenticate(request.headers.get('authorization'));
      body = await readJson(request, url.pathname === '/v1/session' ? 2048 : maxBodyBytes);
      if (url.pathname === '/v1/session') return send(200, { ...store.session(body?.installationId, ip), mode });
      if (body?.mode !== mode) throw new ApiError('MODE_CHANGED', 'Analysis mode changed. Reload the panel before sending a capture.', 409);
      if (!analysisEnabled) throw new ApiError('SERVICE_DISABLED', 'Analysis is temporarily paused. Editing and ICS export remain available.', 503);
      const input = validateInput(body);
      if (mode === 'mock') validateMock(input, body);
      else {
        if (body.scenario || body.fixture || body.model || body.endpoint) throw new ApiError('INVALID_INPUT', 'Development overrides are not accepted by live analysis.');
        if (input.image) inspectImage(input.image);
      }
      store.reserve(client, body.requestId, ip, mode === 'gemini' ? { inputTokens: estimateInputTokens(input) } : {}); reserved = true;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90_000)]);
      const output = await analyze(input, { signal, ...(mode === 'mock' ? { fixture: body.fixture, scenario: body.scenario } : {}) });
      const events = parseExtraction(Array.isArray(output) ? { events: output } : output, input.context);
      return send(200, { events, usage: store.usage(client), mode });
    } catch (error) {
      const known = error instanceof ApiError || error instanceof ServiceError;
      const detail = { code: error.code || (known ? 'INVALID_INPUT' : request.signal.aborted ? 'CANCELED' : error.name === 'TimeoutError' ? 'ANALYSIS_TIMEOUT' : 'ANALYSIS_FAILED'),
        message: known ? error.message : 'Analysis could not finish. No automatic retry was made.' };
      if (error.resetAt) { detail.resetAt = error.resetAt; headers.set('Retry-After', String(Math.max(1, Math.ceil((Date.parse(error.resetAt) - Date.now()) / 1000)))); }
      let usage;
      if (client) { try { usage = store.usage(client); } catch { /* Fail closed; unavailable usage is never unlimited. */ } }
      return send(known ? error.status : 502, { error: detail, ...(usage ? { usage } : {}), mode });
    } finally {
      if (reserved) { try { store.finish(client, body.requestId); } catch { /* Lease expires; never refund uncertain usage. */ } }
    }
  };
}
