import { isDate } from './dates.mjs';

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// A relative heading anchors a schedule. Resolve nearby yearless headings in code,
// rather than asking the model to do calendar arithmetic or silently choose a year.
export function resolveVisualDates(events, context) {
  if (!context || !isDate(context.anchorDate)) return events;
  const anchored = events.some(event => /^(today|tomorrow)$/i.test(event.date?.trim() || ''));
  const year = Number(context.anchorDate.slice(0, 4));
  const anchor = Date.parse(context.anchorDate + 'T00:00:00Z');
  return events.map(event => {
    const result = { ...event, uncertainties: [...event.uncertainties] };
    for (const field of ['date', 'endDate']) {
      const value = result[field];
      if (typeof value !== 'string') continue;
      const heading = value.trim().match(/^(?:(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tue|Wed|Thu|Fri|Sat)[,\s]+)?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?$/i);
      if (!heading) continue;
      const month = months.indexOf(heading[2].slice(0, 3).toLowerCase()) + 1;
      const matches = [];
      if (anchored) for (const candidateYear of [year - 1, year, year + 1]) {
        const date = candidateYear + '-' + String(month).padStart(2, '0') + '-' + heading[3].padStart(2, '0');
        if (!isDate(date)) continue;
        const instant = new Date(date + 'T00:00:00Z');
        const delta = (instant.getTime() - anchor) / 86_400_000;
        if (delta < 0 || delta > 31) continue;
        if (heading[1] && instant.getUTCDay() !== weekdays.indexOf(heading[1].slice(0, 3).toLowerCase())) continue;
        matches.push(date);
      }
      // Keep an explicit unresolved end visible to normalization, which either
      // flags it or applies the labelled one-hour default.
      result[field] = matches.length === 1 ? matches[0] : field === 'endDate' ? value : null;
      result.uncertainties.push(matches.length === 1
        ? 'Year inferred for “' + value + '” from the nearby relative date heading: ' + matches[0] + '. Confirm this schedule is current.'
        : '“' + value + '” has no year or does not match this current schedule. Choose its date.');
    }
    return result;
  });
}
