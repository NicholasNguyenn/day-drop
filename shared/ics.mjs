import { addDays, zonedTimeToInstant } from './dates.mjs';
import { assertValid, cleanText, eventDescription } from './events.mjs';

export function escapeText(value) {
  return cleanText(value, 16000).replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
    .replace(/;/g, '\\;').replace(/,/g, '\\,');
}

export function foldLine(line) {
  const encoder = new TextEncoder();
  const lines = []; let current = ''; let size = 0;
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > 75) { lines.push(current); current = ' '; size = 1; }
    current += character; size += bytes;
  }
  lines.push(current);
  return lines.join('\r\n');
}

const utcStamp = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const compactDate = date => date.replace(/-/g, '');

export function serializeCalendar(drafts, now = new Date()) {
  if (!Array.isArray(drafts) || drafts.length === 0) throw new Error('Select at least one event.');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Daydrop//EN', 'CALSCALE:GREGORIAN'];
  const stamp = utcStamp(now);
  for (const draft of drafts) {
    assertValid(draft);
    lines.push('BEGIN:VEVENT', 'UID:' + draft.id + '@auto-calendar.local', 'DTSTAMP:' + stamp);
    if (draft.allDay) {
      lines.push('DTSTART;VALUE=DATE:' + compactDate(draft.startDate), 'DTEND;VALUE=DATE:' + compactDate(addDays(draft.endDate, 1)));
    } else {
      lines.push('DTSTART:' + utcStamp(zonedTimeToInstant(draft.startDate, draft.startTime, draft.timeZone)),
        'DTEND:' + utcStamp(zonedTimeToInstant(draft.endDate, draft.endTime, draft.timeZone)));
    }
    lines.push('SUMMARY:' + escapeText(draft.title));
    if (draft.location) lines.push('LOCATION:' + escapeText(draft.location));
    const description = eventDescription(draft);
    if (description) lines.push('DESCRIPTION:' + escapeText(description));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
