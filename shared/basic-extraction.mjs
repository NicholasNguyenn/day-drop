import { addDays, isDate, isTime, isTimeZone, zonedParts } from './dates.mjs';
import { cleanText } from './events.mjs';

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const monthPattern = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const weekdayPattern = '(?:Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)';
const datePattern = new RegExp('\\b(?:\\d{4}-\\d{2}-\\d{2}|' + monthPattern + '\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|today|tomorrow|in\\s+\\d{1,3}\\s+days?|(?:(?:this|next)\\s+)?' + weekdayPattern + '|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?)\\b', 'gi');
const timeToken = '(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*[ap]\\.?m\\.?|\\d{1,2}:\\d{2}|\\d{1,2})';
const rangePattern = new RegExp('\\b(' + timeToken + ')\\s*(?:[-–—]|to)\\s*(' + timeToken + ')(?!\\w)', 'i');

function readDate(expression, context) {
  const value = expression.toLowerCase();
  if (isDate(value)) return { date: value, notes: [] };
  if (value === 'today' || value === 'tomorrow') return { date: value, notes: [] };
  const days = /^in\s+(\d+)\s+days?$/.exec(value);
  if (days) return { date: addDays(context.anchorDate, Number(days[1])), notes: [expression + ' resolved from ' + context.anchorDate + '.'] };
  const weekday = /^(?:(this|next)\s+)?([a-z]+)/.exec(value);
  const weekdayIndex = weekdays.indexOf(weekday?.[2].slice(0, 3));
  if (weekdayIndex >= 0) {
    const current = new Date(context.anchorDate + 'T12:00:00Z').getUTCDay();
    let delta = (weekdayIndex - current + 7) % 7;
    if (weekday[1] === 'next' && delta === 0) delta = 7;
    const date = addDays(context.anchorDate, delta);
    return { date, notes: [expression + ' interpreted as the next matching day (' + date + '); review this date.'] };
  }
  const explicit = new RegExp('^(' + monthPattern + ')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$', 'i').exec(expression);
  if (explicit?.[3]) {
    const date = explicit[3] + '-' + String(months.indexOf(explicit[1].slice(0, 3).toLowerCase()) + 1).padStart(2, '0') + '-' + explicit[2].padStart(2, '0');
    if (isDate(date)) return { date, notes: [] };
  }
  return { date: null, notes: ['Date “' + expression + '” needs review. Use a complete date with a year; numeric slash dates are not guessed.'] };
}

function readTime(token, meridiem) {
  const value = token.toLowerCase().replace(/[.\s]/g, '');
  if (value === 'noon') return '12:00';
  if (value === 'midnight') return '00:00';
  const parts = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(value);
  if (!parts) return null;
  let hour = Number(parts[1]); const minute = parts[2] || '00'; const suffix = parts[3] || meridiem;
  if (suffix) { if (hour < 1 || hour > 12) return null; hour = hour % 12 + (suffix === 'pm' ? 12 : 0); }
  else if (!parts[2] || parts[1].length !== 2) return null; // Require explicit HH:mm or AM/PM.
  const result = String(hour).padStart(2, '0') + ':' + minute;
  return isTime(result) ? result : null;
}

function readTimes(text) {
  const match = rangePattern.exec(text) || /\b(noon|midnight|\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|\d{1,2}:\d{2})(?!\w)/i.exec(text) || /\bat\s+(\d{1,2})(?![\d\w])/i.exec(text);
  if (!match) return { startTime: null, endTime: null, notes: [], match: null };
  const first = match[1], second = match[2];
  const suffix = /([ap])\.?m\.?$/i.exec(second?.trim() || '')?.[1].toLowerCase() + 'm';
  const inferred = second && !/[ap]\.?m\.?$/i.test(first.trim()) && /^\d{1,2}(?::\d{2})?$/.test(first.trim()) && ['am', 'pm'].includes(suffix);
  let startTime = readTime(first, inferred ? suffix : undefined);
  const endTime = second ? readTime(second) : null;
  const notes = [];
  if (inferred) {
    notes.push('The range’s ' + suffix.toUpperCase() + ' was applied to its start time; review both times.');
    if (startTime && endTime && startTime >= endTime) startTime = null;
  }
  if (!startTime || (second && !endTime)) notes.push('Time “' + match[0] + '” is ambiguous or invalid; enter explicit times.');
  return { startTime, endTime: second && !endTime ? 'invalid' : endTime, notes, match };
}

const candidate = fields => ({ title: '', date: null, startTime: null, endDate: null, endTime: null,
  timeZone: null, allDay: false, location: '', description: '', evidence: '', uncertainties: [], ...fields });

export function extractTextEvents(text, context) {
  const result = []; let heading = ''; let headingDate = null;
  for (const raw of cleanText(text, 32000).split('\n').slice(0, 500)) {
    const line = raw.trim().replace(/^[-•*]\s*/, '');
    if (!line) { heading = ''; headingDate = null; continue; }
    if (line.length > 1200) continue;
    if (/\b(cancel(?:led|ed)|cancellation|published|last updated|copyright)\b/i.test(line)) continue;
    const dates = [...line.matchAll(datePattern)];
    const primaryDate = dates.find(match => /^\d{4}-|^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(match[0])) || dates[0];
    const masked = dates.reduce((value, match) => value.slice(0, match.index) + ' '.repeat(match[0].length) + value.slice(match.index + match[0].length), line);
    const times = readTimes(masked);
    let title = masked;
    if (times.match) title = title.slice(0, times.match.index) + ' '.repeat(times.match[0].length) + title.slice(times.match.index + times.match[0].length);
    const zone = /\b(?:[A-Za-z_]+\/)+[A-Za-z_+-]+\b|\bUTC\b/.exec(title);
    if (zone) title = title.replace(zone[0], '');
    const locationOffset = times.match ? times.match.index + times.match[0].length : 0;
    let location = /\b(?:at|location:|venue:)\s+(.+)$/i.exec(title.slice(locationOffset));
    if (location) location.index += locationOffset;
    else location = /\b(?:at|location:|venue:)\s+(.+)$/i.exec(title);
    if (location) title = title.slice(0, location.index);
    title = title.replace(/\b(?:on|at|from|to|all[ -]day)\b/gi, ' ').replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').replace(/\s+/g, ' ').trim();
    // Date headings apply to subsequent schedule lines, never to unrelated paragraphs.
    if (primaryDate && !times.match && (!title || new RegExp('^' + weekdayPattern + '[, ]*$', 'i').test(title))) { headingDate = readDate(primaryDate[0], context); continue; }
    if (!primaryDate && !times.match) { heading = line; continue; }
    if (!primaryDate && !headingDate && !times.match) continue;
    const date = primaryDate ? readDate(primaryDate[0], context) : headingDate || { date: null, notes: [] };
    if (!title) title = heading;
    if (!title) continue;
    const notes = [...date.notes, ...times.notes];
    if (dates.length > 1 && dates.some(item => item !== primaryDate && !new RegExp('^' + weekdayPattern + '$', 'i').test(item[0]))) notes.push('Multiple dates appear in this line. Review the event’s start and end dates.');
    if (/\b(?:every|weekly|daily|monthly)\b/i.test(line)) notes.push('Recurring schedule: this draft represents one occurrence only.');
    const abbreviation = /\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT|GMT)\b/.exec(line);
    if (abbreviation) { notes.push('Time zone ' + abbreviation[0] + ' is ambiguous. Choose the intended time zone.'); title = title.replace(abbreviation[0], '').trim(); }
    if (zone && !isTimeZone(zone[0])) notes.push('Source time zone needs review.');
    let endDate = null;
    if (times.startTime && times.endTime && times.endTime < times.startTime && date.date) {
      const startDate = date.date === 'today' ? context.anchorDate : date.date === 'tomorrow' ? addDays(context.anchorDate, 1) : date.date;
      endDate = addDays(startDate, 1); notes.push('The time range ends the following day; review the overnight end date.');
    }
    // An unreadable time must not look like "no time", which would become an all-day event.
    result.push(candidate({ title, date: date.date, startTime: times.startTime || (times.match ? 'invalid' : null), endTime: times.endTime, endDate,
      allDay: /\ball[ -]day\b/i.test(line) || (!times.match && /\b(deadline|due|closes?|registration ends)\b/i.test(line)),
      timeZone: zone && isTimeZone(zone[0]) ? zone[0] : null, location: location?.[1].trim().replace(/\s+\b(?:at|on|from)\s*$/i, '').trim() || '',
      evidence: headingDate && !primaryDate ? 'Schedule date: ' + headingDate.date + '\n' + line : line, uncertainties: notes }));
    heading = '';
    if (result.length === 50) break;
  }
  return result;
}

function structuredTimestamp(value, context) {
  if (isDate(value)) return { date: value, time: null, dateOnly: true, notes: [] };
  if (typeof value !== 'string') return { date: null, time: null, notes: [] };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::00(?:\.0+)?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || !isDate(match[1]) || !isTime(match[2])) return { date: null, time: null, notes: ['Structured timestamp needs review: ' + cleanText(value, 100)] };
  if (!match[3]) return { date: match[1], time: match[2], notes: ['Source gives no time zone; using ' + context.timeZone + '.'] };
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return { date: null, time: null, notes: ['Invalid source timestamp.'] };
  return { ...zonedParts(instant, context.timeZone), notes: ['Source offset converted to ' + context.timeZone + '; review the displayed local time.'] };
}

export function extractStructuredEvents(events, context) {
  if (!Array.isArray(events)) return [];
  return events.slice(0, 30).filter(event => event && typeof event.name === 'string' && !/EventCancelled$/i.test(event.eventStatus || '')).map(event => {
    const start = structuredTimestamp(event.startDate, context);
    const end = event.endDate ? structuredTimestamp(event.endDate, context) : {};
    const place = Array.isArray(event.location) ? event.location[0] : event.location;
    const address = place?.address;
    const location = typeof place === 'string' ? place : [place?.name, typeof address === 'string' ? address
      : [address?.streetAddress, address?.addressLocality, address?.addressRegion].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return candidate({ title: cleanText(event.name, 180), date: start.date, startTime: start.time, endDate: event.endDate ? end.date || '' : null,
      endTime: end.time || null, timeZone: context.timeZone, allDay: Boolean(start.dateOnly), location,
      description: cleanText(event.description), evidence: 'Page event data: ' + cleanText(event.name, 180) + '\n' + cleanText(event.startDate, 100),
      uncertainties: [...start.notes, ...(end.notes || []), ...(start.dateOnly ? ['Date-only page event is treated as all day; verify its final day.'] : [])] });
  });
}

export function analyzeBasic({ text, structuredEvents, image, context }) {
  if (image) throw new Error('Screenshots need vision analysis. The simple text parser cannot read image layouts. Nothing was uploaded.');
  const events = [...extractStructuredEvents(structuredEvents, context), ...extractTextEvents(text || '', context)];
  const seen = new Set();
  return events.filter(event => {
    const key = JSON.stringify([event.title.toLowerCase(), event.date, event.startTime, event.endTime, event.allDay]);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 50);
}
