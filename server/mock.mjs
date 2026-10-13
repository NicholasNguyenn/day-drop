import { analyzeBasic } from '../shared/basic-extraction.mjs';
import { ApiError } from './quota.mjs';

export function validateMock(input, body) {
  if (input.image && body.fixture !== 'matches') throw new ApiError('MOCK_CAPTURE_ONLY', 'Screenshot recognition is not connected yet. Try the simulated match schedule to preview the flow.', 503);
  if (body.scenario && !['normal', 'empty', 'unavailable', 'invalid', 'timeout'].includes(body.scenario)) throw new ApiError('INVALID_SCENARIO', 'Unknown preview scenario.');
}
export async function extractMock(input, { fixture, scenario = 'normal', signal } = {}) {
  const delay = scenario === 'timeout' ? 1500 : 150;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay);
    function done() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ApiError('CANCELED', 'Analysis canceled.', 499)); }
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  });
  if (scenario === 'unavailable') throw new ApiError('PROVIDER_UNAVAILABLE', 'Simulated provider outage. Existing drafts are saved.', 503);
  if (scenario === 'invalid') throw new ApiError('INVALID_OUTPUT', 'Simulated invalid model response. No drafts were added.', 502);
  if (scenario === 'timeout') throw new ApiError('ANALYSIS_TIMEOUT', 'Simulated analysis timeout. No automatic retry was made.', 504);
  if (scenario === 'empty') return [];
  if (fixture !== 'matches') return analyzeBasic(input);
  const date = offset => new Date(Date.parse(input.context.anchorDate + 'T12:00:00Z') + offset * 86_400_000).toISOString().slice(0, 10);
  return ['PRX vs T1', 'NS vs 100T', 'LOUD vs NRG', 'VIT vs G2'].map((title, i) => ({
    title, date: i < 2 ? 'tomorrow' : date(2), startTime: i % 2 ? '07:00' : '04:00',
    endDate: null, endTime: null, allDay: false, timeZone: input.context.timeZone,
    location: null, description: 'Simulated Champions · Playoffs · Bo3 schedule. Match duration is unknown.', uncertainties: ['Simulated preview; no vision model read this image.'],
    evidence: 'DEVELOPMENT FIXTURE: ' + title + ' · ' + (i < 2 ? 'Tomorrow' : date(2)) + ' · ' + (i % 2 ? '7:00 AM' : '4:00 AM'),
  }));
}
