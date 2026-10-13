import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAnalysisContext } from '../shared/dates.mjs';
import { analyzeBasic, extractTextEvents, extractStructuredEvents } from '../shared/basic-extraction.mjs';
import { normalizeCandidates, validateDraft } from '../shared/events.mjs';
import { serializeCalendar } from '../shared/ics.mjs';

const context = makeAnalysisContext('America/Chicago', '2026-10-06T17:00:00Z');
const drafts = text => normalizeCandidates(extractTextEvents(text, context), context, { type: 'text' });

test('no-model text creates reviewed drafts and real ICS from relative, explicit and deadline dates', () => {
  const events = drafts('Dinner with friends tomorrow, 7–8:30 PM at Cafe Luna\nDentist on October 12, 2026 at 9:30 AM\nRegistration closes tomorrow');
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(e => [e.title, e.startDate, e.startTime, e.endTime, e.allDay]), [
    ['Dinner with friends', '2026-10-07', '19:00', '20:30', false],
    ['Dentist', '2026-10-12', '09:30', '10:30', false],
    ['Registration closes', '2026-10-07', '', '', true],
  ]);
  assert.equal(events[0].location, 'Cafe Luna');
  assert.equal(drafts('Dinner tomorrow at 7 PM at Cafe Luna')[0].location, 'Cafe Luna');
  assert.equal(drafts('Dinner at Cafe Luna tomorrow at 7 PM')[0].location, 'Cafe Luna');
  assert.ok(events[0].assumptions.some(note => note.includes('PM')));
  assert.ok(events[1].assumptions.some(note => note.includes('60 minute')));
  assert.deepEqual(events.flatMap(validateDraft), []);
  assert.equal((serializeCalendar(events).match(/BEGIN:VEVENT/g) || []).length, 3);
});

test('weekday and in-N-days dates freeze from context across year boundary', () => {
  const c = makeAnalysisContext('America/Chicago', '2026-12-31T18:00:00Z');
  const events = normalizeCandidates(extractTextEvents('Lunch next Friday at noon\nParty in 3 days at 8 PM', c), c);
  assert.deepEqual(events.map(e => e.startDate), ['2027-01-01', '2027-01-03']);
  assert.equal(events[0].startTime, '12:00');
  assert.ok(events[0].assumptions.some(note => note.includes('next matching day')));
});

test('ambiguous dates, invalid dates and bare hours block export without invented fields', () => {
  for (const text of ['Meeting October 12 at 7', 'Meeting 10/12/2026 at 7 PM', 'Meeting 2026-02-30 at 9 AM', 'Meeting tomorrow at 25:00', 'Meeting tomorrow 11–1 PM', 'Meeting tomorrow 09:00–25:00', 'Dinner tomorrow at 7:30']) {
    const [event] = drafts(text); assert.ok(event, text); assert.ok(validateDraft(event).length, text);
    assert.throws(() => serializeCalendar([event]), undefined, text);
  }
  const [event] = drafts('Workshop tomorrow');
  assert.equal(event.allDay, false);
  assert.equal(event.startTime, '');
});

test('explicit HH:mm is accepted and past dates receive a visible review warning', () => {
  const [event] = drafts('Meeting October 5, 2026 at 09:30');
  assert.equal(event.startTime, '09:30'); assert.deepEqual(validateDraft(event), []);
  assert.ok(event.assumptions.some(note => note.includes('before the analysis date')));
});

test('explicit overnight ranges roll end date with a visible assumption; noon/midnight are precise', () => {
  const [event] = drafts('Night shift 2026-10-31 10 PM–1 AM');
  assert.equal(event.endDate, '2026-11-01');
  assert.equal(event.startTime, '22:00'); assert.equal(event.endTime, '01:00');
  assert.ok(event.assumptions.some(note => note.includes('following day')));
  assert.equal(drafts('Deadline tomorrow at midnight')[0].startTime, '00:00');
});

test('multiline schedule headings and titles work without inheriting across paragraphs', () => {
  const events = drafts('October 12, 2026\nOpening talk 9:00–10:00 at Main Hall\nClosing talk 11:00–12:00\n\nCoffee at 2 PM');
  assert.equal(events.length, 3);
  assert.equal(events[0].startDate, '2026-10-12'); assert.equal(events[0].location, 'Main Hall');
  assert.equal(events[1].startDate, '2026-10-12'); assert.equal(events[2].startDate, '');
  const [event] = drafts('Team catch-up\nTomorrow at 3 PM'); assert.equal(event.title, 'Team catch-up');
});

test('ordinary prose, publication dates and canceled events produce no schedulable candidates', () => {
  assert.deepEqual(extractTextEvents('Nothing scheduled here\nPublished October 6, 2026\nCanceled: Meeting tomorrow at 9 AM', context), []);
});

test('structured event offsets convert correctly and date-only events remain reviewable', () => {
  const events = normalizeCandidates(extractStructuredEvents([
    { name: 'Conference', startDate: '2026-10-12T09:00:00-07:00', endDate: '2026-10-12T10:00:00-07:00', location: { name: 'Main Hall', address: { streetAddress: '12 Oak St', addressLocality: 'Austin' } } },
    { name: 'Festival', startDate: '2026-10-14', endDate: '2026-10-16' },
    { name: 'Canceled', startDate: '2026-10-15', eventStatus: 'https://schema.org/EventCancelled' },
  ], context), context);
  assert.equal(events.length, 2);
  assert.equal(events[0].startTime, '11:00'); assert.equal(events[0].endTime, '12:00');
  assert.match(events[0].location, /Main Hall.*Austin/);
  assert.equal(events[1].allDay, true); assert.equal(events[1].endDate, '2026-10-16');
  assert.deepEqual(events.flatMap(validateDraft), []);
});

test('malformed source end fields stay invalid rather than falling back to valid defaults', () => {
  const [time] = normalizeCandidates([{ title: 'Meeting', date: 'tomorrow', startTime: '09:00', endTime: 'bogus' }], context);
  assert.equal(time.endTime, ''); assert.ok(validateDraft(time).length);
  const [date] = normalizeCandidates([{ title: 'Meeting', date: 'tomorrow', startTime: '09:00', endTime: '10:00', endDate: 'wrong' }], context);
  assert.equal(date.endDate, ''); assert.ok(validateDraft(date).length);
  const [structured] = normalizeCandidates(extractStructuredEvents([{ name: 'Meeting', startDate: '2026-10-12T09:00:00Z', endDate: 'bad' }], context), context);
  assert.ok(validateDraft(structured).length);
});

test('basic extraction never invokes network or models, rejects images and deduplicates results', () => {
  assert.throws(() => analyzeBasic({ image: {}, context }), /Nothing was uploaded/);
  assert.equal(analyzeBasic({ text: 'Lunch tomorrow at noon\nLunch tomorrow at noon', context }).length, 1);
  assert.equal(analyzeBasic({ text: Array.from({ length: 80 }, (_, i) => 'Meeting ' + i + ' tomorrow at 9 AM').join('\n'), context }).length, 50);
});
