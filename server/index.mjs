import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { QuotaStore, developmentDatabase } from './quota.mjs';
import { createService } from './service.mjs';

export { validateInput } from './service.mjs';

const assets = new Map([
  ...['sidepanel.html', 'sidepanel.css', 'sidepanel.mjs', 'providers.mjs', 'service.mjs', 'service-config.mjs', 'demo.mjs', 'google.mjs'].map(file =>
    ['/' + file, ['../extension/' + file, file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript']]),
  ...['dates', 'events', 'ics', 'extraction', 'basic-extraction', 'visual-dates'].map(name => ['/shared/' + name + '.mjs', ['../shared/' + name + '.mjs', 'text/javascript']]),
  ['/icons/daydrop.svg', ['../extension/icons/daydrop.svg', 'image/svg+xml']],
]);

// The local server: the shared service behind node:http, plus the panel preview files.
export function createApp({ store = new QuotaStore(), mode = 'mock', analysisEnabled = process.env.ANALYSIS_ENABLED !== 'false',
  extensionId = process.env.ALLOWED_EXTENSION_ID || '', ...options } = {}) {
  async function preview(pathname) {
    if (pathname === '/service-config.mjs') {
      return new Response("export const serviceOrigin = 'http://127.0.0.1:8788';\nexport const serviceMode = " + JSON.stringify(mode) + ';\n',
        { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
    }
    if (pathname === '/') return new Response(null, { status: 302, headers: { Location: '/sidepanel.html' } });
    if (!assets.has(pathname)) return;
    try {
      const [file, type] = assets.get(pathname);
      return new Response(await readFile(new URL(file, import.meta.url)), { headers: { 'Content-Type': type + '; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none';" } });
    } catch { return Response.json({ error: { code: 'NOT_FOUND', message: 'Preview asset not found.' } }, { status: 404 }); }
  }
  const handle = createService({ ...options, store, mode, analysisEnabled, extensionId, preview });
  const app = createServer(async (request, response) => {
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    // Node's own request stream stands in for the Fetch body, so a body the service
    // never reads is still discarded by Node once the response has been sent.
    const result = await handle({ method: request.method, url: new URL(request.url, 'http://localhost').href,
      headers: new Headers(request.headers), body: request, signal: controller.signal },
      { ip: request.socket.remoteAddress || 'unknown' }); // Never trust arbitrary X-Forwarded-For.
    if (response.destroyed) return;
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  app.quotaStore = store;
  return app;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8787);
  const app = createApp({ store: new QuotaStore({ filename: developmentDatabase() }) });
  app.on('error', error => { console.error('Could not start development service: ' + error.message); process.exitCode = 1; });
  app.listen(port, '127.0.0.1', () => console.log('Auto Calendar mock service (no provider uploads): http://127.0.0.1:' + port));
}
