import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDate, makeAnalysisContext, resolveDate, zonedTimeToInstant } from '../shared/dates.mjs';
import { normalizeCandidates, validateDraft, toGoogleEvent, eventFingerprint } from '../shared/events.mjs';
import { serializeCalendar, foldLine } from '../shared/ics.mjs';
import { parseExtraction } from '../shared/extraction.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-07T02:00:00Z');
const makeDraft = overrides => normalizeCandidates([{
  title: 'Dinner', date: 'tomorrow', startTime: '19:00', endDate: null, endTime: '20:00',
  allDay: false, timeZone: null, location: 'Cafe', description: null, evidence: 'Dinner tomorrow at 7pm', uncertainties: [],
  ...overrides,
}], context)[0];

test('relative dates use the selected zone at analysis time, including year boundaries', () => {
  assert.equal(context.anchorDate, '2026-10-06');
  assert.equal(resolveDate('tomorrow', context), '2026-10-07');
  assert.equal(resolveDate('today', context), '2026-10-06');
  assert.equal(resolveDate('tomorrow', makeAnalysisContext('Asia/Tokyo', '2026-12-31T14:00:00Z')), '2027-01-01');
  assert.equal(resolveDate('Oct 7', context), '');
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('time-zone conversion handles fractional offsets and daylight saving transitions', () => {
  assert.equal(zonedTimeToInstant('2026-10-07', '19:00', 'America/Chicago').toISOString(), '2026-10-08T00:00:00.000Z');
  assert.equal(zonedTimeToInstant('2026-10-07', '09:00', 'Asia/Kathmandu').toISOString(), '2026-10-07T03:15:00.000Z');
  assert.throws(() => zonedTimeToInstant('2026-03-08', '02:30', 'America/Chicago'), /does not exist/);
  assert.throws(() => zonedTimeToInstant('2026-11-01', '01:30', 'America/Chicago'), /occurs twice/);
});

test('missing end time uses a visible default that rolls into the next day', () => {
  const draft = makeDraft({ startTime: '23:30', endTime: null });
  assert.equal(draft.endDate, '2026-10-08'); assert.equal(draft.endTime, '00:30');
  assert.match(draft.assumptions.join(' '), /set to 1 hour/);
  assert.deepEqual(validateDraft(draft), []);
});

test('a duration printed in the source sets the end time; implausible or absent ones fall back to an hour', () => {
  const film = makeDraft({ startTime: '21:15', endTime: null, durationMinutes: 129 });
  assert.deepEqual([film.endDate, film.endTime], ['2026-10-07', '23:24']);
  assert.match(film.assumptions.join(' '), /length shown in the source \(2 hr 9 min\)/);
  assert.equal(makeDraft({ startTime: '21:15', endTime: null, durationMinutes: 5000 }).endTime, '22:15');
  assert.equal(makeDraft({ startTime: '21:15', endTime: '22:00', durationMinutes: 129 }).endTime, '22:00');
  assert.throws(() => parseExtraction({ events: [{ title: 'x', allDay: false, evidence: '', uncertainties: [], date: null, startTime: null,
    endDate: null, endTime: null, timeZone: null, location: null, description: null, durationMinutes: '129' }] }, context), /durationMinutes/);
});

test('missing fields and invalid time ranges cannot be exported', () => {
  assert.ok(validateDraft(makeDraft({ date: null })).some(issue => issue.includes('start date')));
  assert.ok(validateDraft(makeDraft({ startTime: null })).some(issue => issue.includes('start time')));
  assert.throws(() => serializeCalendar([makeDraft({ endTime: '18:00' })]), /after start/);
  assert.throws(() => serializeCalendar([]), /at least one/);
});

test('all-day UI final dates export exclusively in both formats', () => {
  const draft = makeDraft({ allDay: true, date: '2026-10-07', endDate: '2026-10-09' });
  const google = toGoogleEvent(draft);
  assert.equal(google.start.date, '2026-10-07'); assert.equal(google.end.date, '2026-10-10');
  const ics = serializeCalendar([draft], '2026-10-06T12:00:00Z');
  assert.match(ics, /DTSTART;VALUE=DATE:20261007\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261010\r\n/);
});

test('ICS escapes content and folds UTF-8 lines at 75 octets without breaking characters', () => {
  const draft = makeDraft({ title: 'Dinner, friends; fun \\ cafe', description: 'First line\r\nBEGIN:VEVENT\n' + '🍜'.repeat(80) });
  const calendar = serializeCalendar([draft], '2026-10-06T12:00:00Z');
  assert.match(calendar, /SUMMARY:Dinner\\, friends\\; fun \\\\ cafe/);
  assert.equal(calendar.split('\r\n').filter(line => line === 'BEGIN:VEVENT').length, 1);
  assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75));
  assert.equal(foldLine('🍜'.repeat(80)).replace(/\r\n /g, ''), '🍜'.repeat(80));
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
});

test('timed ICS and Google exports represent identical instants and stable identities', async () => {
  const draft = makeDraft();
  const ics = serializeCalendar([draft], '2026-10-06T12:00:00Z');
  assert.match(ics, /DTSTART:20261008T000000Z/);
  assert.equal(toGoogleEvent(draft).start.dateTime, '2026-10-08T00:00:00.000Z');
  assert.equal(await eventFingerprint(draft), await eventFingerprint({ ...draft, id: crypto.randomUUID(), description: 'new notes' }));
  assert.notEqual(await eventFingerprint(draft), await eventFingerprint({ ...draft, startTime: '19:30' }));
  assert.match(serializeCalendar([draft]), new RegExp('UID:' + draft.id));
});

test('malformed model responses are rejected before normalization', () => {
  assert.throws(() => parseExtraction('not json'), /valid event data/);
  assert.throws(() => parseExtraction({ events: [{ title: 'bad', allDay: 'false' }] }), /invalid event/);
  assert.deepEqual(parseExtraction({ events: [] }), []);
});
