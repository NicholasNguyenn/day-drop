import { createApp } from './index.mjs';
import { QuotaStore, developmentDatabase } from './quota.mjs';

// No .env file, API key, model download, or external request is needed for this preview.
const port = 8788;
const app = createApp({ store: new QuotaStore({ filename: developmentDatabase() }) });
app.on('error', error => { console.error('Could not start local preview: ' + error.message); process.exitCode = 1; });
app.listen(port, '127.0.0.1', () => console.log('Local-only Auto Calendar prototype: http://127.0.0.1:' + port));
