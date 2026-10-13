import { parseEnv } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { developmentDatabase } from './quota.mjs';
import { liveConfiguration } from './service.mjs';

export { liveConfiguration };

export const ownerConfigPath = () => path.join(path.dirname(developmentDatabase()), 'provider.env');
export function prepareOwnerConfig() {
  const file = ownerConfigPath(); mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, [
    '# Owner backend configuration. Never paste this key into chat or the extension.',
    '# Use an AI Studio project marked Free, with billing disabled.',
    'GEMINI_API_KEY=', 'GEMINI_MODEL=gemini-3.5-flash-lite',
    '# Set true only after checking this project has billing disabled.', 'GEMINI_FREE_TIER_CONFIRMED=false',
    '# Copy the active model limits from AI Studio. Zero keeps live mode disabled.',
    'GEMINI_RPM=0', 'GEMINI_RPD=0', 'GEMINI_TPM=0',
    'ANALYSIS_ENABLED=true', 'PORT=8788', '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  return file;
}
export function loadOwnerConfiguration() {
  // Read the key and its free-project confirmation from the same private file.
  // Inherited shell variables must not silently replace a confirmed project's key.
  const file = prepareOwnerConfig(); return liveConfiguration(parseEnv(readFileSync(file, 'utf8')));
}
