import { createApp } from './index.mjs';
import { QuotaStore, developmentDatabase } from './quota.mjs';
import { loadOwnerConfiguration } from './runtime.mjs';
try {
  const config = loadOwnerConfiguration();
  const app = createApp({ mode: 'gemini', providerConfig: config, analysisEnabled: config.analysisEnabled, store: new QuotaStore({ filename: developmentDatabase(), limits: config.limits }) });
  app.on('error', () => { console.error('Live service could not start. Stop the preview using port 8788 first.'); process.exitCode = 1; });
  app.listen(config.port, '127.0.0.1', () => console.log('Quota-enforced Gemini service: http://127.0.0.1:' + config.port));
} catch (error) { console.error('Live setup required: ' + error.message); process.exitCode = 1; }
