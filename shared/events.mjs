import { addDays, isDate, isTime, isTimeZone, resolveDate, zonedParts, zonedTimeToInstant } from './dates.mjs';

export const cleanText = (value, max = 8000) => typeof value === 'string'
  ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';

export const autoEndNote = 'No valid end time was found, so this event is set to 1 hour. Adjust if needed.';
export const statedDurationNote = minutes => 'End time is set from the length shown in the source ('
  + [minutes >= 60 ? Math.floor(minutes / 60) + ' hr' : '', minutes % 60 ? minutes % 60 + ' min' : ''].filter(Boolean).join(' ') + '). Adjust if needed.';
export const autoAllDayNote ='No time was found, so this is set as an all-day event. Add times if needed.';

export function normalizeCandidates(candidates, context, source = {}) {
  if (!Array.isArray(candidates) || candidates.length > 50) throw new Error('Analysis returned an invalid event list.');
  return candidates.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Analysis returned an invalid event.');
    const startDate = resolveDate(candidate.date, context);
    const timeZone = isTimeZone(candidate.timeZone) ? candidate.timeZone : context.timeZone;
    const assumptions = Array.isArray(candidate.uncertainties) ? candidate.uncertainties
      .filter(item => typeof item === 'string').slice(0, 12).map(item => cleanText(item, 500)) : [];
    if (candidate.timeZone && !isTimeZone(candidate.timeZone)) assumptions.push('Source time zone was unclear; using your selected time zone.');
    if (typeof candidate.date === 'string' && /^(today|tomorrow)$/i.test(candidate.date.trim())) {
      assumptions.push('The source says “' + candidate.date.trim().toLowerCase() + '”, read as ' + startDate + ' in ' + context.timeZone + '.');
    }
    // No time at all means all day. A time that was present but unreadable still needs the user.
    const allDay = candidate.allDay === true || (!candidate.startTime && !candidate.endTime);
    if (allDay && candidate.allDay !== true) assumptions.push(autoAllDayNote);
    const draft = {
      id: crypto.randomUUID(), title: cleanText(candidate.title, 180), selected: true,
      startDate, startTime: isTime(candidate.startTime) ? candidate.startTime : '',
      endDate: candidate.endDate == null ? startDate : resolveDate(candidate.endDate, context),
      endTime: isTime(candidate.endTime) ? candidate.endTime : '',
      timeZone, allDay, location: cleanText(candidate.location, 1000),
      description: cleanText(candidate.description), evidence: cleanText(candidate.evidence, 4000),
      assumptions, source: { type: cleanText(source.type, 30), url: safeUrl(source.url), title: cleanText(source.title, 300) },
      analyzedAt: context.analyzedAt, anchorDate: context.anchorDate,
    };
    if (!startDate) assumptions.push('Choose a date; the source did not provide a complete date.');
    if (startDate && startDate < context.anchorDate) assumptions.push('This date is before the analysis date (' + context.anchorDate + '); verify the year and whether the event is still relevant.');
    if (!allDay && !draft.startTime) assumptions.push('Enter a start time or choose All day.');
    // A readable end time on a later day is kept; anything else unreadable gets the labelled default.
    if (!allDay && startDate && draft.startTime && !draft.endTime && (!draft.endDate || draft.endDate === startDate)) {
      // Only a duration printed in the source is used; a day or more is treated as a misread.
      const stated = Number.isInteger(candidate.durationMinutes) && candidate.durationMinutes > 0 && candidate.durationMinutes < 1440 ? candidate.durationMinutes : 0;
      try {
        const end = new Date(zonedTimeToInstant(startDate, draft.startTime, timeZone).getTime() + (stated || 60) * 60_000);
        const parts = zonedParts(end, timeZone);
        draft.endDate = parts.date; draft.endTime = parts.time;
        assumptions.push(stated ? statedDurationNote(stated) : autoEndNote);
      } catch { /* Validation reports time-zone gaps or overlaps for review. */ }
    }
    if (candidate.endDate != null && !draft.endDate) assumptions.push('Choose an end date; the source end date was unclear.');
    return draft;
  });
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && value.length <= 2000 ? url.href : '';
  } catch { return ''; }
}

export function validateDraft(draft) {
  const issues = [];
  if (!draft || typeof draft !== 'object') return ['Invalid event.'];
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(draft.id || '')) issues.push('Invalid event identifier.');
  if (!cleanText(draft.title, 180)) issues.push('Enter an event title.');
  if (!isDate(draft.startDate)) issues.push('Choose a valid start date.');
  if (!isDate(draft.endDate)) issues.push('Choose a valid end date.');
  if (!isTimeZone(draft.timeZone)) issues.push('Choose a valid time zone.');
  if (typeof draft.allDay !== 'boolean') issues.push('Choose timed or all-day status.');
  if (draft.allDay === true) {
    if (isDate(draft.startDate) && isDate(draft.endDate) && draft.endDate < draft.startDate) issues.push('The final day must be on or after the start date.');
    return issues;
  }
  if (!isTime(draft.startTime)) issues.push('Enter a valid start time.');
  if (!isTime(draft.endTime)) issues.push('Enter a valid end time.');
  if (issues.length) return issues;
  try {
    const start = zonedTimeToInstant(draft.startDate, draft.startTime, draft.timeZone);
    const end = zonedTimeToInstant(draft.endDate, draft.endTime, draft.timeZone);
    if (end <= start) issues.push('End time must be after start time.');
  } catch (error) { issues.push(error.message); }
  return issues;
}

export function assertValid(draft) {
  const issues = validateDraft(draft);
  if (issues.length) throw new Error(issues.join(' '));
}

export function eventDescription(draft) {
  return [cleanText(draft.description), safeUrl(draft.source?.url) ? 'Source: ' + safeUrl(draft.source.url) : '']
    .filter(Boolean).join('\n\n');
}

export function toGoogleEvent(draft) {
  assertValid(draft);
  const times = draft.allDay ? {
    start: { date: draft.startDate }, end: { date: addDays(draft.endDate, 1) },
  } : {
    start: { dateTime: zonedTimeToInstant(draft.startDate, draft.startTime, draft.timeZone).toISOString(), timeZone: draft.timeZone },
    end: { dateTime: zonedTimeToInstant(draft.endDate, draft.endTime, draft.timeZone).toISOString(), timeZone: draft.timeZone },
  };
  return { summary: cleanText(draft.title, 180), location: cleanText(draft.location, 1000),
    description: eventDescription(draft), ...times };
}

export async function eventFingerprint(draft) {
  const event = toGoogleEvent(draft);
  const canonical = JSON.stringify([
    event.summary.toLowerCase().replace(/\s+/g, ' '), event.start.date || event.start.dateTime,
    event.end.date || event.end.dateTime, event.location.toLowerCase().replace(/\s+/g, ' '),
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
