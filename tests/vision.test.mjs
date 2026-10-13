import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { makeAnalysisContext } from '../shared/dates.mjs';
import { parseExtraction } from '../shared/extraction.mjs';
import { normalizeCandidates, validateDraft } from '../shared/events.mjs';
import { createApp } from '../server/index.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-08T18:00:00Z');
const candidate = (title, date, startTime) => ({ title, date, startTime, endDate: null, endTime: null,
  timeZone: null, allDay: false, location: null, description: 'Champions • Playoffs · Bo3',
  evidence: date + ' ' + startTime + ' ' + title, uncertainties: [] });
// Expected model output transcribed from the reported four-card screenshot.
// This fixture validates the pipeline, not a live model's recognition accuracy.
const schedule = () => [candidate('PRX vs T1', 'tomorrow', '04:00'), candidate('NS vs 100T', 'tomorrow', '07:00'),
  candidate('LOUD vs NRG', 'Saturday Oct 10', '04:00'), candidate('VIT vs G2', 'Saturday Oct 10', '07:00')];
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('four visual cards preserve individual matches, shared headings, and morning times', () => {
  const events = parseExtraction({ events: schedule() }, context);
  const drafts = normalizeCandidates(events, context, { type: 'screenshot' });
  assert.deepEqual(drafts.map(draft => [draft.title, draft.startDate, draft.startTime]), [
    ['PRX vs T1', '2026-10-09', '04:00'], ['NS vs 100T', '2026-10-09', '07:00'],
    ['LOUD vs NRG', '2026-10-10', '04:00'], ['VIT vs G2', '2026-10-10', '07:00'],
  ]);
  assert.ok(events[2].uncertainties.some(note => /Year inferred/.test(note)));
  assert.equal(events[0].endTime, null);
  assert.equal(drafts[0].endTime, '05:00');
  assert.ok(drafts[0].assumptions.some(note => /60/.test(note)));
  assert.ok(drafts.every(draft => !draft.reviewed));
  assert.equal(JSON.parse(JSON.stringify(drafts))[0].startDate, '2026-10-09');
});

test('yearless visual headings require an anchored nearby date and matching weekday', () => {
  assert.equal(parseExtraction({ events: [candidate('Match', 'Saturday Oct 10', '04:00')] }, context)[0].date, null);
  for (const heading of ['Sunday Oct 10', 'Saturday Jan 10', 'Monday Feb 30']) {
    assert.equal(parseExtraction({ events: [candidate('Anchor', 'today', '09:00'), candidate('Match', heading, '04:00')] }, context)[1].date, null);
  }
  const newYear = makeAnalysisContext('America/Chicago', '2026-12-31T18:00:00Z');
  assert.equal(parseExtraction({ events: [candidate('Anchor', 'today', '09:00'), candidate('Match', 'Friday Jan 1', '04:00')] }, newYear)[1].date, '2027-01-01');
  const unresolvedEnd = { ...candidate('Match', '2026-10-10', '04:00'), endDate: 'Saturday Oct 10' };
  const [draft] = normalizeCandidates(parseExtraction({ events: [unresolvedEnd] }, context), context);
  assert.ok(validateDraft(draft).length);
  assert.ok(!draft.assumptions.some(note => /60 minute default/.test(note)));
});
