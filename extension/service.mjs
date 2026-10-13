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
// The hosted service runs on a small free allowance. A screenshot over the limit is redrawn
// as JPEG within the service's size rules, then shrunk until its upload is about 1 MB.
export async function fitImage(image, limit = 750_000) {
  if (image.size <= limit) return image;
  const bitmap = await createImageBitmap(image); const { width, height } = bitmap;
  let scale = Math.min(1, 4096 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height))); let result = image;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
    const draw = canvas.getContext('2d'); draw.fillStyle = '#fff'; draw.fillRect(0, 0, canvas.width, canvas.height); // JPEG has no transparency.
    draw.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    result = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    if (result.size <= limit) break;
    scale *= Math.sqrt(limit / result.size) * 0.9;
  }
  bitmap.close(); return result;
}

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
      image: image ? await imageData(await fitImage(image)) : null, structuredEvents, context, ...(this.mode === 'mock' ? { fixture, scenario } : {}) }, signal });
    return parseExtraction(result, context);
  }
}
