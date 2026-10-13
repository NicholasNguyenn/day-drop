import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'dist', 'extension');
const relative = path.relative(root, destination);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || destination !== path.join(root, 'dist', 'extension')) throw new Error('Unsafe build target.');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(path.join(root, 'extension'), destination, { recursive: true });
await cp(path.join(root, 'shared'), path.join(destination, 'shared'), { recursive: true });
const manifest = JSON.parse(await readFile(path.join(root, 'extension', 'manifest.json'), 'utf8'));
if (process.env.ANALYSIS_MODE === 'gemini') {
  const origin = new URL(process.env.ANALYSIS_ORIGIN || 'http://127.0.0.1:8788');
  if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && origin.hostname === '127.0.0.1')) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid analysis service origin.');
  manifest.optional_host_permissions = [origin.origin + '/*'];
  await writeFile(path.join(destination, 'service-config.mjs'), 'export const serviceOrigin = ' + JSON.stringify(origin.origin) + ';\nexport const serviceMode = "gemini";\n');
}
if (process.env.GOOGLE_CLIENT_ID) {
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(process.env.GOOGLE_CLIENT_ID)) throw new Error('Invalid GOOGLE_CLIENT_ID.');
  manifest.oauth2 = { client_id: process.env.GOOGLE_CLIENT_ID, scopes: [
    'https://www.googleapis.com/auth/calendar.events.owned',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  ] };
}
if (process.env.CHROME_EXTENSION_KEY) manifest.key = process.env.CHROME_EXTENSION_KEY;
await writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Load unpacked extension from ' + destination);
