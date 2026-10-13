import { eventFingerprint, toGoogleEvent } from './shared/events.mjs';

export function googleConfigured() {
  return Boolean(globalThis.chrome?.runtime?.getManifest()?.oauth2?.client_id);
}

export async function connectGoogle() {
  if (!googleConfigured()) throw new Error('Google Calendar connection is not available in this build. Download an ICS file instead.');
  const result = await chrome.identity.getAuthToken({ interactive: true });
  if (!result?.token) throw new Error('Google Calendar connection was not completed.');
  return result.token;
}

export async function googleRequest(token, path, options = {}, fetcher = fetch) {
  const response = await fetcher('https://www.googleapis.com/calendar/v3/' + path, {
    ...options, headers: { ...options.headers, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (response.status === 401) {
    if (globalThis.chrome?.identity) await chrome.identity.removeCachedAuthToken({ token });
    throw new Error('Your Google connection expired. Connect again to retry.');
  }
  if (response.status === 409) return { duplicate: true };
  if (!response.ok) throw new Error(response.status === 403 ? 'Google did not grant access to this calendar.'
    : response.status === 429 ? 'Google Calendar is busy. Wait a moment and retry.' : 'Google Calendar request failed. You can safely retry.');
  return response.json();
}

export async function listCalendars(token, fetcher = fetch) {
  const calendars = []; let pageToken;
  do {
    const query = new URLSearchParams({ maxResults: '250' });
    if (pageToken) query.set('pageToken', pageToken);
    const data = await googleRequest(token, 'users/me/calendarList?' + query, {}, fetcher);
    calendars.push(...(data.items || []).filter(calendar => calendar.accessRole === 'owner' && !calendar.deleted));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return calendars.sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)));
}

export async function importGoogleEvents(drafts, calendarId, token, { fetcher = fetch, onResult = () => {} } = {}) {
  if (!drafts.length || !calendarId) throw new Error('Choose events and a calendar.');
  const results = [];
  for (const draft of drafts) {
    let result;
    try {
      const fingerprint = await eventFingerprint(draft);
      const path = 'calendars/' + encodeURIComponent(calendarId) + '/events';
      const duplicateQuery = new URLSearchParams({ privateExtendedProperty: 'autoCalendarFingerprint=' + fingerprint, maxResults: '1' });
      const existing = await googleRequest(token, path + '?' + duplicateQuery, {}, fetcher);
      if (existing.items?.some(event => event.status !== 'cancelled')) result = { id: draft.id, status: 'duplicate' };
      else {
        // The ID makes retries safe even if insertion succeeded but the response was lost.
        const resource = { ...toGoogleEvent(draft), id: 'ac' + fingerprint,
          extendedProperties: { private: { autoCalendarFingerprint: fingerprint } } };
        const added = await googleRequest(token, path, { method: 'POST', body: JSON.stringify(resource) }, fetcher);
        result = { id: draft.id, status: added.duplicate ? 'duplicate' : 'added', url: added.htmlLink || '' };
      }
    } catch (error) { result = { id: draft.id, status: 'failed', error: error.message }; }
    results.push(result); onResult(result);
  }
  return results;
}
