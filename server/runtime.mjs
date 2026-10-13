import { parseEnv } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { developmentDatabase } from './quota.mjs';

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
export function liveConfiguration(env = process.env) {
  if (env.GEMINI_FREE_TIER_CONFIRMED !== 'true') throw new Error('Verify an unbilled Free-tier project, then set GEMINI_FREE_TIER_CONFIRMED=true in the owner config.');
  if (!env.GEMINI_API_KEY?.trim() || env.GEMINI_API_KEY === 'your-key-here') throw new Error('Add your owner Gemini key to the private backend config.');
  if ((env.GEMINI_MODEL || 'gemini-3.5-flash-lite') !== 'gemini-3.5-flash-lite') throw new Error('Only the verified Flash-Lite model is enabled for initial free testing.');
  const values = ['GEMINI_RPM','GEMINI_RPD','GEMINI_TPM'].map(key => Number(env[key]));
  if (values.some(value => !Number.isSafeInteger(value) || value < 1)) throw new Error('Copy positive RPM, RPD and TPM limits for this model from AI Studio into the owner config.');
  const port = Number(env.PORT || 8788);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Choose a valid local service port.');
  return { apiKey: env.GEMINI_API_KEY.trim(), model: 'gemini-3.5-flash-lite', port, analysisEnabled: env.ANALYSIS_ENABLED !== 'false', limits: {
    daily: 5, ipDaily: 10, globalDaily: Math.min(10, Math.max(1, Math.floor(values[1] * .8))),
    globalBurst: Math.min(2, Math.max(1, Math.floor(values[0] * .8))), concurrency: 1,
    providerDaily: Math.max(1, Math.floor(values[1] * .8)), tokenPerMinute: Math.max(1, Math.floor(values[2] * .8)),
  } };
}
export function loadOwnerConfiguration() {
  // Read the key and its free-project confirmation from the same private file.
  // Inherited shell variables must not silently replace a confirmed project's key.
  const file = prepareOwnerConfig(); return liveConfiguration(parseEnv(readFileSync(file, 'utf8')));
}
