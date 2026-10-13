import { parseExtraction } from './shared/extraction.mjs';
import { serviceOrigin, serviceMode } from './service-config.mjs';

export function backendUrl(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use an HTTPS service origin, or HTTP on localhost.');
  return url.origin;
}
const imageData = image => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read screenshot.')); reader.readAsDataURL(image);
});

export class AnalysisClient {
  constructor({ installationId, origin = serviceOrigin, mode = serviceMode, fetcher = fetch, onUsage = () => {} }) {
    this.installationId = installationId; this.origin = backendUrl(origin); this.mode = mode;
    this.fetcher = (...args) => fetcher(...args); this.onUsage = onUsage; this.session = null; this.initializing = null;
  }
  async permission(request = false) {
    if (!globalThis.chrome?.permissions) return;
    const origins = [this.origin + '/*'];
    if (await chrome.permissions.contains({ origins })) return;
    if (!request || !await chrome.permissions.request({ origins })) throw new Error('Click Try again to connect to the analysis service.');
  }
  async request(route, { body, signal, authorized = true } = {}) {
    let response;
    try {
      response = await this.fetcher(this.origin + route, { method: body ? 'POST' : 'GET', redirect: 'error',
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(authorized ? { Authorization: 'Bearer ' + this.session?.token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([AbortSignal.timeout(95_000), ...(signal ? [signal] : [])]) });
    } catch (error) { if (signal?.aborted) throw error; throw new Error('Analysis service is unavailable. Your drafts are saved; you can still download ICS.'); }
    const result = await response.json().catch(() => null);
    if (result?.usage) this.onUsage(result.usage);
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Analysis could not finish.');
      Object.assign(error, { code: result?.error?.code, resetAt: result?.error?.resetAt }); throw error;
    }
    if (result?.mode !== this.mode) throw new Error('Analysis mode changed. No further capture will be sent.');
    return result;
  }
  async connect({ requestPermission = false, signal } = {}) {
    await this.permission(requestPermission);
    if (this.session && Date.parse(this.session.expiresAt) > Date.now() + 30_000) return;
    if (!this.initializing) this.initializing = this.request('/v1/session', { body: { installationId: this.installationId }, authorized: false, signal })
      .then(result => { this.session = result; }).finally(() => { this.initializing = null; });
    await this.initializing;
  }
  async usage(options = {}) { await this.connect(options); return (await this.request('/v1/usage', { signal: options.signal })).usage; }
  async analyze({ text = '', image, structuredEvents, context, fixture, scenario, signal }) {
    // Mock mode rejects real images before even reading their bytes.
    if (this.mode === 'mock' && image && fixture !== 'matches') throw new Error('Screenshot recognition is not connected yet. Try the simulated match schedule to preview the flow.');
    await this.connect({ signal }); signal?.throwIfAborted();
    const result = await this.request('/v1/analyses', { body: { requestId: crypto.randomUUID(), mode: this.mode, text,
      image: image ? await imageData(image) : null, structuredEvents, context, ...(this.mode === 'mock' ? { fixture, scenario } : {}) }, signal });
    return parseExtraction(result, context);
  }
}
