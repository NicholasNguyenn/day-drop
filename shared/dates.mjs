const formatters = new Map();

export function isTimeZone(value) {
  if (typeof value !== 'string' || value.length > 100) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; }
  catch { return false; }
}

export function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1000 && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isTime(value) {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function addDays(date, amount) {
  if (!isDate(date) || !Number.isInteger(amount)) throw new RangeError('Invalid calendar date.');
  const result = new Date(date + 'T00:00:00Z');
  result.setUTCDate(result.getUTCDate() + amount);
  const output = result.toISOString().slice(0, 10);
  if (!isDate(output)) throw new RangeError('Calendar date is outside the supported range.');
  return output;
}

export function zonedParts(instant, timeZone) {
  if (!isTimeZone(timeZone)) throw new RangeError('Choose a valid time zone.');
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) throw new RangeError('Invalid analysis timestamp.');
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(date)
    .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return {
    date: parts.year + '-' + parts.month + '-' + parts.day,
    time: parts.hour + ':' + parts.minute,
    second: Number(parts.second),
  };
}

export function makeAnalysisContext(timeZone, now = new Date()) {
  const analyzedAt = new Date(now).toISOString();
  return Object.freeze({ timeZone, analyzedAt, anchorDate: zonedParts(analyzedAt, timeZone).date });
}

export function resolveDate(expression, context) {
  const value = typeof expression === 'string' ? expression.trim().toLowerCase() : '';
  if (value === 'today') return context.anchorDate;
  if (value === 'tomorrow') return addDays(context.anchorDate, 1);
  return isDate(value) ? value : '';
}

// Check all nearby offsets, then round-trip. This detects gaps and repeated wall times.
export function zonedTimeToInstant(date, time, timeZone) {
  if (!isDate(date) || !isTime(time)) throw new RangeError('Enter a valid date and time.');
  if (!isTimeZone(timeZone)) throw new RangeError('Choose a valid time zone.');
  const target = Date.parse(date + 'T' + time + ':00Z');
  const offsets = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = target + hours * 3_600_000;
    const parts = zonedParts(sample, timeZone);
    const rendered = Date.parse(parts.date + 'T' + parts.time + ':' + String(parts.second).padStart(2, '0') + 'Z');
    offsets.add(rendered - sample);
  }
  const matches = [...offsets].map(offset => target - offset).filter(candidate => {
    const parts = zonedParts(candidate, timeZone);
    return parts.date === date && parts.time === time && parts.second === 0;
  });
  if (matches.length === 0) throw new RangeError('This time does not exist because the clock changes. Choose another time.');
  if (matches.length > 1) throw new RangeError('This time occurs twice because the clock changes. Choose an unambiguous time or use UTC.');
  return new Date(matches[0]);
}
