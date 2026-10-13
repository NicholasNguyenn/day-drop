// Cloudflare entry point (see wrangler.jsonc). The Worker turns away regions the free
// Gemini tier may not serve, then passes everything to one Durable Object in eastern
// North America. That object owns the usage counters and makes every Gemini call, so
// accounting has a single writer and provider requests always leave from the US.
import { DurableObject } from 'cloudflare:workers';
import { createService, liveConfiguration } from './service.mjs';
import { QuotaCore } from './quota-core.mjs';

// EEA, United Kingdom and Switzerland, with their territories that have a country code
// of their own. XX and T1 are Cloudflare's codes for an unknown country and for Tor.
const blocked = new Set(('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH '
  + 'AX GF GP MQ RE YT MF GI GG JE IM XX T1').split(' '));
const refuse = (status, code, message) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });

export class Analysis extends DurableObject {
  fetch(request) {
    try { this.handle ??= this.start(); }
    catch (error) {
      console.error('Daydrop is not configured: ' + error.message); // Visible in `wrangler tail`; never includes the key.
      return refuse(503, 'SERVICE_DISABLED', 'Analysis is not set up yet. Editing and ICS export remain available.');
    }
    return this.handle(request, { ip: request.headers.get('cf-connecting-ip') || 'unknown' });
  }
  start() {
    const config = liveConfiguration(this.env); const { storage } = this.ctx;
    const db = {
      exec: query => { storage.sql.exec(query); },
      prepare: query => ({ run: (...values) => { storage.sql.exec(query, ...values); }, get: (...values) => storage.sql.exec(query, ...values).toArray()[0] }),
    };
    // Workers do not accept fetch's redirect: 'error'. 'manual' does not follow a redirect either,
    // and the unfollowed response then fails the Gemini call as not ok.
    const fetcher = (url, options) => fetch(url, { ...options, redirect: 'manual' });
    return createService({ mode: 'gemini', providerConfig: { ...config, fetcher }, analysisEnabled: config.analysisEnabled, extensionId: this.env.ALLOWED_EXTENSION_ID || '',
      store: new QuotaCore({ db, transaction: fn => storage.transactionSync(fn), limits: config.limits }) });
  }
}

export default {
  fetch(request, env) {
    const country = request.cf?.country;
    if (!country || blocked.has(country)) return refuse(451, 'REGION_UNAVAILABLE', 'Daydrop analysis is not available in your region. You can still add events yourself and download ICS.');
    if (Number(request.headers.get('content-length')) > 12_000_000) return refuse(413, 'CAPTURE_TOO_LARGE', 'Use a smaller screenshot.');
    return env.ANALYSIS.get(env.ANALYSIS.idFromName('daydrop'), { locationHint: 'enam' }).fetch(request);
  },
};
