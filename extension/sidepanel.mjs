import { makeAnalysisContext, isTimeZone, isDate } from './shared/dates.mjs';
import { normalizeCandidates, validateDraft, eventFingerprint, safeUrl, autoEndNote, autoAllDayNote } from './shared/events.mjs';
import { serializeCalendar } from './shared/ics.mjs';
import { capturePage } from './providers.mjs';
import { AnalysisClient } from './service.mjs';
import { matchScheduleImage } from './demo.mjs';
import { serviceMode } from './service-config.mjs';
import { googleConfigured, connectGoogle, listCalendars, createCalendar, importGoogleEvents } from './google.mjs';

const $ = id => document.getElementById(id);
const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const isExtension = Boolean(globalThis.chrome?.scripting && globalThis.chrome?.runtime?.id);
const isMock = serviceMode === 'mock';
const state = { drafts: [], tab: 'screenshot', image: null, imageUrl: null, busy: false,
  timeZone: defaultZone, installationId: null, usage: null, fixture: null,
  token: null, calendars: [], results: new Map(), controller: null, undo: [] };
let analysisClient;
let saveQueue = Promise.resolve();
const needsReview = draft => !draft.reviewed && (draft.source?.type !== 'manual' || draft.assumptions.length > 0);

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showStatus(message, tone = 'info') {
  $('status').hidden = !message;
  $('status').textContent = message;
  $('status').dataset.tone = tone;
}

function persist() {
  const saved = structuredClone({ drafts: state.drafts, preferences: {
      version: 3, timeZone: state.timeZone, installationId: state.installationId, calendarId: state.calendarId,
    } });
  saveQueue = saveQueue.then(async () => {
      if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ autoCalendar: saved });
      else localStorage.setItem('autoCalendar', JSON.stringify(saved));
  }).catch(() => showStatus('Could not save drafts on this device. Export them before closing the panel.', 'error'));
}

function setBusy(value) {
  state.busy = value;
  for (const control of document.querySelectorAll('button, input, textarea, select')) control.disabled = value;
  $('cancel-analysis').hidden = !value || !state.controller;
  $('cancel-analysis').disabled = false;
  refreshActions();
}

function refreshActions() {
  const selected = state.drafts.filter(draft => draft.selected);
  const unresolved = selected.filter(draft => validateDraft(draft).length > 0).length;
  const unreviewed = selected.filter(draft => !validateDraft(draft).length && needsReview(draft)).length;
  $('selection-count').textContent = selected.length + (selected.length === 1 ? ' event selected' : ' events selected');
  $('selection-note').textContent = unresolved ? unresolved + (unresolved === 1 ? ' needs attention' : ' need attention') : unreviewed ? unreviewed + ' to review' : selected.length ? 'Ready to export' : 'Review before adding';
  $('download-ics').disabled = state.busy || selected.length === 0 || unresolved > 0 || unreviewed > 0;
  const googleReady = isExtension && googleConfigured();
  // Connecting is always allowed so calendars can be chosen during review; adding needs reviewed events.
  $('google-action').disabled = state.busy || !googleReady || (Boolean(state.token) && (selected.length === 0 || unresolved > 0 || unreviewed > 0));
  $('google-action').textContent = !googleReady ? 'Google setup' : state.token ? 'Add to Google ↗' : 'Connect Google ↗';
  $('google-action').title = googleReady ? '' : 'Google Calendar requires an installed extension and OAuth configuration. ICS is ready to use.';
  $('calendar-choice').hidden = !state.token;
  if (!state.token) $('new-calendar').hidden = true;
  $('analyze-input').disabled = state.busy || state.usage?.remaining === 0 || (state.tab === 'screenshot' ? !state.image : !$('source-text').value.trim());
  $('image-help').hidden = false;
  $('image-help-text').textContent = isMock ? 'Preview the four-match schedule below. Real screenshot recognition is not connected in mock mode.'
    : 'Gemini reads event cards and shared headings from the original image. Review every extracted event.';
  $('refresh-usage').disabled = state.busy;
  $('undo-remove').disabled = state.busy;
  $('review-next').disabled = state.busy || !selected.some(draft => validateDraft(draft).length || needsReview(draft));
  const step = !state.drafts.length ? 'capture' : selected.length && !unresolved && !unreviewed ? 'export' : 'review';
  for (const name of ['capture', 'review', 'export']) {
    if (name === step) $('step-' + name).setAttribute('aria-current', 'step');
    else $('step-' + name).removeAttribute('aria-current');
  }
  $('event-count').textContent = state.drafts.length;
  $('empty-state').hidden = state.drafts.length > 0;
  $('review-tools').hidden = state.drafts.length === 0;
  $('select-all').textContent = state.drafts.every(draft => draft.selected) ? 'Deselect all' : 'Select all';
  if (!isExtension) {
    for (const id of ['analyze-page', 'capture-page']) {
      $(id).disabled = true;
      $(id).title = 'Available when loaded as a Chrome extension.';
    }
  }
}

function dateLabel(draft) {
  if (!isDate(draft.startDate)) return 'Choose a date';
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(draft.startDate + 'T12:00:00Z'));
  if (draft.allDay) return formatted + ' · All day';
  if (!draft.startTime) return formatted + ' · Choose a time';
  const [hour, minute] = draft.startTime.split(':').map(Number);
  const time = (hour % 12 || 12) + ':' + String(minute).padStart(2, '0') + (hour >= 12 ? ' PM' : ' AM');
  let end = '';
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(draft.endTime || '')) {
    const [h, m] = draft.endTime.split(':').map(Number);
    end = ' – ' + (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h >= 12 ? ' PM' : ' AM');
    if (draft.endDate !== draft.startDate && isDate(draft.endDate)) end += ' (' + new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(draft.endDate + 'T12:00:00Z')) + ')';
  }
  return formatted + '\n' + time + end + ' · ' + draft.timeZone;
}

const fieldIssues = { title: /title/i, startDate: /start date/i, endDate: /end date|final day/i, timeZone: /time zone/i,
  startTime: /start time|does not exist|occurs twice/i, endTime: /end time/i };

function updateCard(card, draft) {
  card.querySelector('.event-title').textContent = draft.title || 'Untitled event';
  card.querySelector('.event-date').textContent = dateLabel(draft);
  const issues = validateDraft(draft);
  const result = state.results.get(draft.id);
  const badge = card.querySelector('.event-state');
  badge.className = 'event-state';
  badge.textContent = issues.length ? 'Needs attention' : needsReview(draft) ? draft.assumptions.length ? 'Review assumptions' : 'Review details' : draft.reviewed ? 'Reviewed' : 'Ready';
  if (issues.length) badge.classList.add('needs-review');
  if (result) {
    badge.textContent = result.status === 'added' ? 'Added to Google' : result.status === 'duplicate' ? 'Already added' : 'Import failed';
    if (result.status === 'failed') badge.classList.add('failed');
  }
  const issueList = card.querySelector('.issues');
  issueList.replaceChildren(...issues.map(issue => element('li', '', issue)));
  if (result?.error) issueList.append(element('li', '', result.error));
  card.querySelector('.issue-box').hidden = !issueList.children.length;
  // Matches validateDraft's wording; time-zone gap and overlap errors name the start time.
  for (const input of card.querySelectorAll('.event-fields [data-field]')) {
    input.parentElement.classList.toggle('invalid', issues.some(issue => fieldIssues[input.dataset.field]?.test(issue)));
  }
  const done = Boolean(draft.reviewed) && !issues.length;
  for (const review of card.querySelectorAll('.review-button')) {
    review.textContent = issues.length ? 'Fix ' + issues.length + (issues.length === 1 ? ' field' : ' fields') + ' to continue' : draft.reviewed ? 'Reviewed' : 'Mark reviewed';
    review.classList.toggle('primary', !done); review.classList.toggle('secondary', done);
  }
  card.querySelector('.review-button.quick').hidden = !issues.length && !needsReview(draft);
  card.querySelector('.event-select').setAttribute('aria-label', 'Select ' + (draft.title || 'untitled event'));
  refreshActions();
}

function renderDrafts() {
  $('event-list').replaceChildren();
  state.drafts.forEach((draft, index) => {
    const card = element('details', 'event-card'); card.dataset.id = draft.id;
    card.open = validateDraft(draft).length > 0;
    const summary = element('summary');
    const checkbox = element('input', 'event-select');
    checkbox.type = 'checkbox'; checkbox.checked = draft.selected;
    checkbox.addEventListener('change', () => { draft.selected = checkbox.checked; persist(); refreshActions(); });
    const info = element('div', 'event-info');
    info.append(element('span', 'event-title'), element('span', 'event-date'), element('span', 'event-state'));
    // Stays visible on a collapsed card so review never requires reopening it.
    const quickReview = element('button', 'button primary review-button quick'); quickReview.type = 'button';
    summary.append(checkbox, info, quickReview); card.append(summary);
    const body = element('div', 'card-body');
    const issueBox = element('div', 'issue-box');
    issueBox.append(element('strong', '', 'Fix these before exporting'), element('ul', 'issues')); body.append(issueBox);
    const fields = element('div', 'event-fields');
    function field(labelText, name, { type = 'text', wide = false, multiline = false, time = false } = {}) {
      const label = element('label', wide ? 'wide' : '');
      label.append(document.createTextNode(labelText));
      const input = element(multiline ? 'textarea' : 'input');
      input.dataset.field = name; input.value = draft[name] || '';
      if (!multiline) input.type = type; else input.rows = 2;
      if (name === 'title') input.maxLength = 180;
      if (name === 'location') input.maxLength = 1000;
      if (name === 'description') input.maxLength = 8000;
      if (name === 'timeZone') input.setAttribute('list', 'time-zones');
      if (time) label.hidden = draft.allDay;
      input.addEventListener('input', () => {
        draft[name] = input.value; draft.reviewed = false;
        state.results.delete(draft.id);
        updateCard(card, draft); persist();
      });
      label.append(input); fields.append(label);
    }
    field('Event title', 'title', { wide: true });
    const allDayLabel = element('label', 'all-day-label wide');
    const allDay = element('input'); allDay.type = 'checkbox'; allDay.checked = draft.allDay;
    allDay.addEventListener('change', () => { draft.allDay = allDay.checked; draft.reviewed = false; state.results.delete(draft.id); persist(); renderDrafts(); });
    allDayLabel.append(allDay, document.createTextNode('All day')); fields.append(allDayLabel);
    field('Start date', 'startDate', { type: 'date' }); field('Start time', 'startTime', { type: 'time', time: true });
    field(draft.allDay ? 'Final day (inclusive)' : 'End date', 'endDate', { type: 'date' });
    field('End time', 'endTime', { type: 'time', time: true });
    field('Time zone', 'timeZone', { wide: true }); field('Location', 'location', { wide: true });
    field('Notes', 'description', { wide: true, multiline: true });
    if (state.token && state.calendars.length) {
      // Empty means "follow the calendar chosen in the export bar".
      const label = element('label', 'wide'); label.append(document.createTextNode('Google calendar'));
      const choice = element('select', 'draft-calendar'); const fallback = element('option', '', defaultCalendarLabel()); fallback.value = '';
      choice.append(fallback, ...state.calendars.map(calendar => { const option = element('option', '', calendar.summary); option.value = calendar.id; return option; }));
      if (state.calendars.some(calendar => calendar.id === draft.calendarId)) choice.value = draft.calendarId;
      choice.addEventListener('change', () => { draft.calendarId = choice.value; state.results.delete(draft.id); persist(); updateCard(card, draft); });
      label.append(choice); fields.append(label);
    }
    body.append(fields);
    if (draft.evidence || draft.source?.url) {
      const evidence = element('div', 'evidence'); evidence.append(element('strong', '', 'Source evidence'));
      if (draft.evidence) evidence.append(element('p', '', draft.evidence));
      if (safeUrl(draft.source?.url)) {
        const link = element('a', '', draft.source.title || 'View source page');
        link.href = safeUrl(draft.source.url); link.target = '_blank'; link.rel = 'noreferrer'; evidence.append(link);
      }
      body.append(evidence);
    }
    if (draft.assumptions.length) {
      const assumptions = element('ul', 'assumptions');
      assumptions.append(...draft.assumptions.map(item => element('li', '', item)));
      const notes = element('div', 'evidence'); notes.append(element('strong', '', 'What Daydrop assumed'), assumptions); body.append(notes);
    }
    const bottom = element('div', 'card-bottom');
    const remove = element('button', 'text-button muted', 'Remove event'); remove.type = 'button';
    remove.addEventListener('click', () => removeDrafts([draft.id]));
    const reviewed = element('button', 'button primary review-button'); reviewed.type = 'button';
    for (const button of [reviewed, quickReview]) button.addEventListener('click', event => {
      event.preventDefault(); // inside <summary> a click would otherwise toggle the card
      const issues = validateDraft(draft);
      if (issues.length) {
        showStatus('Fix the highlighted fields before marking this event reviewed.', 'error'); card.open = true;
        const first = card.querySelector('label.invalid input'); first?.focus(); (first || issueBox).scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
      }
      draft.reviewed = true; persist(); updateCard(card, draft); card.open = false; focusNextReview();
      showStatus(state.drafts.some(item => item.selected && (validateDraft(item).length || needsReview(item)))
        ? 'Reviewed ' + draft.title + '. Continue reviewing the selected events.' : 'Selected events are reviewed and ready to export.');
    });
    bottom.append(reviewed, remove); body.append(bottom); card.append(body); $('event-list').append(card); updateCard(card, draft);
  });
  refreshActions();
}

function focusNextReview() {
  const draft = state.drafts.find(item => item.selected && (validateDraft(item).length || needsReview(item)));
  if (!draft) return;
  const card = [...$('event-list').children].find(item => item.dataset.id === draft.id);
  if (card) { card.open = true; card.querySelector('summary').focus(); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

function removeDrafts(ids) {
  state.undo = state.drafts.flatMap((draft, index) => ids.includes(draft.id) ? [{ draft, index }] : []);
  state.drafts = state.drafts.filter(draft => !ids.includes(draft.id));
  ids.forEach(id => state.results.delete(id));
  $('undo-message').textContent = state.undo.length + (state.undo.length === 1 ? ' draft removed.' : ' drafts removed.');
  $('undo-bar').hidden = !state.undo.length;
  persist(); renderDrafts();
}

function switchTab(tab) {
  $('capture-details').open = true;
  state.tab = tab;
  for (const name of ['screenshot', 'text']) {
    $(name + '-tab').classList.toggle('active', name === tab);
    $(name + '-tab').setAttribute('aria-selected', String(name === tab));
    $(name + '-tab').tabIndex = name === tab ? 0 : -1;
    $(name + '-panel').hidden = name !== tab;
  }
  refreshActions();
}

function setImage(file, fixture = null) {
  state.fixture = fixture;
  if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
  state.imageUrl = null; state.image = null;
  if (file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8_000_000) {
      showStatus('Use a PNG, JPEG, or WebP screenshot smaller than 8 MB.', 'error');
      $('image-preview').hidden = true; $('dropzone').hidden = false; refreshActions(); return;
    }
    state.image = file; state.imageUrl = URL.createObjectURL(file);
    $('preview-image').src = state.imageUrl; $('image-name').textContent = file.name || 'Pasted screenshot';
    switchTab('screenshot');
  } else { $('preview-image').removeAttribute('src'); $('image-file').value = ''; }
  $('image-preview').hidden = !state.image; $('dropzone').hidden = Boolean(state.image); refreshActions();
}

async function runAnalysis(inputFactory) {
  if (state.busy) return;
  if (state.drafts.length >= 50) { showStatus('Remove some drafts before analyzing more. Your allowance has not been used.', 'error'); return; }
  let context;
  try { context = makeAnalysisContext(state.timeZone); }
  catch (error) { showStatus(error.message, 'error'); return; }
  state.controller = new AbortController();
  const signal = AbortSignal.any([state.controller.signal, AbortSignal.timeout(95_000)]);
  setBusy(true); showStatus('Preparing your capture…');
  try {
    const input = await inputFactory();
    if (!input.text?.trim() && !input.image && !input.structuredEvents?.length) throw new Error('Paste a screenshot or enter event text first.');
    showStatus(isMock ? 'Running simulated analysis…' : 'Reading events with Gemini vision…');
    const candidates = await analysisClient.analyze({ ...input, context, signal, scenario: $('mock-scenario').value });
    const drafts = normalizeCandidates(candidates, context, isMock
      ? { ...input.source, type: 'sample', title: 'Simulated analysis · ' + (input.source?.title || 'capture') } : input.source);
    const fingerprints = new Set();
    for (const draft of state.drafts.filter(item => !validateDraft(item).length)) fingerprints.add(await eventFingerprint(draft));
    const fresh = [];
    for (const draft of drafts) {
      if (!validateDraft(draft).length) {
        const fingerprint = await eventFingerprint(draft);
        if (fingerprints.has(fingerprint)) continue;
        fingerprints.add(fingerprint);
      }
      fresh.push(draft);
    }
    if (state.drafts.length + fresh.length > 50) throw new Error('Keep at most 50 drafts at a time. Clear or remove some events before analyzing more.');
    state.drafts.unshift(...fresh); persist(); renderDrafts();
    if (candidates.length) {
      $('capture-summary').textContent = input.source?.title || 'Captured events';
      $('capture-details').open = false;
    }
    const label = isMock ? 'Simulated analysis: ' : 'Found ';
    const count = note => fresh.filter(draft => draft.assumptions.includes(note)).length;
    const defaults = [[count(autoEndNote), ' set to 1 hour (no end time)'], [count(autoAllDayNote), ' set to all day (no time)']]
      .filter(([total]) => total).map(([total, text]) => total + text).join(', ');
    showStatus(fresh.length ? label + fresh.length + (fresh.length === 1 ? ' event.' : ' events.') + (defaults ? ' ' + defaults + '.' : '') + ' Review the details before exporting.'
      : candidates.length ? 'Found ' + candidates.length + ' candidates already in your drafts.' : 'No events found. Try another capture or add an event manually.');
  } catch (error) {
    showStatus(state.controller.signal.aborted ? 'Analysis canceled. Your existing drafts are saved.'
      : signal.aborted ? 'Analysis took too long. No automatic retry was made.' : error.message + (error.resetAt ? ' Available again ' + new Date(error.resetAt).toLocaleString() + '.' : ''), 'error');
  } finally { state.controller = null; setBusy(false); void refreshUsage(); }
}

function preferencesChanged() {
  state.timeZone = $('default-zone').value.trim();
  $('mode-badge').lastChild.textContent = isMock ? 'Preview' : 'Gemini vision';
  $('capture-note').textContent = isMock ? 'Simulated results. No API key or model setup. No captures sent to Google.' : 'Find events sends this capture to our service and Google Gemini. No user API key needed.';
  $('analysis-privacy').textContent = isMock ? 'Development preview · simulated results. Screenshot recognition is not connected. No captures are sent to Google.'
    : 'Selected captures go through our service to Google Gemini when you click Find events. Google’s free tier may use content to improve its products. Review before exporting.';
  $('text-mode-help').textContent = isMock ? 'Preview uses a simple text parser' : 'No API key needed';
  $('mock-controls').hidden = !isMock;
  refreshActions();
  persist();
}

function addManual() {
  if (state.drafts.length >= 50) { showStatus('Remove an event before adding another draft.', 'error'); return; }
  let context;
  try { context = makeAnalysisContext(state.timeZone); } catch (error) { showStatus(error.message, 'error'); return; }
  const [draft] = normalizeCandidates([{ title: '', date: 'today', startTime: '09:00', endDate: null,
    endTime: '10:00', allDay: false, location: '', description: '', evidence: '', uncertainties: [] }], context, { type: 'manual' });
  draft.assumptions = [];
  state.drafts.unshift(draft); persist(); renderDrafts();
  $('event-list').querySelector('input[data-field="title"]')?.focus();
}

function addSamples() {
  let context;
  try { context = makeAnalysisContext(state.timeZone); } catch (error) { showStatus(error.message, 'error'); return; }
  if (state.drafts.length > 48) { showStatus('Clear some drafts before trying sample events.', 'error'); return; }
  const samples = [
    { title: 'Dinner with friends', date: 'tomorrow', startTime: '19:00', endTime: '20:30', allDay: false,
      location: 'Cafe Luna', evidence: 'Dinner with friends tomorrow, 7–8:30 PM at Cafe Luna.' },
    { title: 'Registration deadline', date: 'tomorrow', startTime: null, endTime: null, allDay: true,
      location: '', evidence: 'Registration closes tomorrow.' },
  ].map(item => ({ ...item, endDate: null, timeZone: null, description: '', uncertainties: [] }));
  state.drafts.push(...normalizeCandidates(samples, context, { type: 'sample', title: 'Sample events' }));
  persist(); renderDrafts(); showStatus('These are sample events for exploring review and export.');
}

$('screenshot-tab').addEventListener('click', () => switchTab('screenshot'));
$('text-tab').addEventListener('click', () => switchTab('text'));
document.querySelector('.tabs').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    event.preventDefault(); switchTab(state.tab === 'text' ? 'screenshot' : 'text'); $(state.tab + '-tab').focus();
  }
});
$('dropzone').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', () => setImage($('image-file').files[0]));
$('remove-image').addEventListener('click', () => setImage(null));
$('source-text').addEventListener('input', refreshActions);
$('demo-image').addEventListener('click', async () => {
  try {
    setImage(await matchScheduleImage(makeAnalysisContext(state.timeZone)), 'matches');
    showStatus(isMock ? 'Simulated four-match schedule loaded. Find events uses a fixture, not a vision model.' : 'Synthetic four-match schedule loaded. Find events will send this test image to Gemini.');
  } catch (error) { showStatus(error.message, 'error'); }
});
$('sample-text').addEventListener('click', () => {
  $('source-text').value = 'Dinner with friends tomorrow, 7–8:30 PM at Cafe Luna\nDentist on October 12, 2026 at 9:30 AM\nRegistration closes tomorrow';
  refreshActions(); $('source-text').focus();
});
$('undo-remove').addEventListener('click', () => {
  const currentIds = new Set(state.drafts.map(draft => draft.id));
  const restore = state.undo.filter(item => !currentIds.has(item.draft.id));
  if (state.drafts.length + restore.length > 50) { showStatus('Remove some drafts before restoring these events.', 'error'); return; }
  for (const item of restore) state.drafts.splice(Math.min(item.index, state.drafts.length), 0, item.draft);
  state.undo = []; $('undo-bar').hidden = true; persist(); renderDrafts(); showStatus('Drafts restored.');
});
document.addEventListener('paste', event => {
  if (state.busy) return;
  const item = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/'));
  if (item) { event.preventDefault(); setImage(item.getAsFile()); }
});
for (const name of ['dragenter', 'dragover']) $('dropzone').addEventListener(name, event => { event.preventDefault(); if (!state.busy) $('dropzone').classList.add('dragging'); });
$('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
$('dropzone').addEventListener('drop', event => {
  event.preventDefault(); $('dropzone').classList.remove('dragging');
  if (!state.busy) setImage(event.dataTransfer.files[0]);
});
$('analyze-input').addEventListener('click', () => runAnalysis(() => state.tab === 'screenshot'
  ? { image: state.image, fixture: state.fixture, source: { type: 'screenshot', title: state.image?.name || 'Pasted screenshot' } }
  : { text: $('source-text').value, source: { type: 'text', title: 'Pasted text' } }));
$('analyze-page').addEventListener('click', () => runAnalysis(() => capturePage(false)));
$('capture-page').addEventListener('click', () => runAnalysis(async () => {
  const input = await capturePage(true); setImage(input.image); return input;
}));
$('cancel-analysis').addEventListener('click', () => state.controller?.abort());
$('add-event').addEventListener('click', addManual);
$('review-next').addEventListener('click', focusNextReview);
$('sample-events').addEventListener('click', addSamples);
$('clear-drafts').addEventListener('click', () => removeDrafts(state.drafts.map(draft => draft.id)));
$('select-all').addEventListener('click', () => {
  const selected = !state.drafts.every(draft => draft.selected);
  state.drafts.forEach(draft => { draft.selected = selected; }); persist(); renderDrafts();
});
function updateUsage(usage) {
  state.usage = usage;
  $('usage-count').textContent = usage.remaining + ' of ' + usage.limit + ' free analyses left';
  $('usage-reset').textContent = 'Resets ' + new Date(usage.resetsAt).toLocaleString() + '. Manual drafts and ICS stay available.';
  refreshActions();
}
async function refreshUsage(requestPermission = false) {
  try { await analysisClient.usage({ requestPermission }); }
  catch (error) { $('usage-count').textContent = 'Allowance unavailable'; $('usage-reset').textContent = error.message; }
}
$('default-zone').addEventListener('change', preferencesChanged);
$('refresh-usage').addEventListener('click', () => refreshUsage(true));
$('download-ics').addEventListener('click', () => {
  try {
    const selected = state.drafts.filter(draft => draft.selected);
    const file = serializeCalendar(selected);
    const url = URL.createObjectURL(new Blob([file], { type: 'text/calendar;charset=utf-8' }));
    const link = element('a'); link.href = url; link.download = 'daydrop-events.ics';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000);
    showStatus('Downloaded ' + selected.length + (selected.length === 1 ? ' reviewed event.' : ' reviewed events.'));
  } catch (error) { showStatus(error.message, 'error'); }
});
const newCalendar = '__new__';
const defaultCalendarLabel = () => 'Same as all events (' + (state.calendars.find(calendar => calendar.id === $('calendar').value)?.summary || 'choose below') + ')';
function renderCalendars() {
  const options = state.calendars.map(calendar => { const option = element('option', '', calendar.summary); option.value = calendar.id; return option; });
  const create = element('option', '', 'New calendar…'); create.value = newCalendar;
  $('calendar').replaceChildren(...options, create);
  // The last calendar used is the default; otherwise Google's primary calendar, which is listed first.
  if (state.calendars.some(calendar => calendar.id === state.calendarId)) $('calendar').value = state.calendarId;
  $('new-calendar').hidden = true; renderDrafts();
}
async function loadCalendars(interactive) {
  const token = await connectGoogle(interactive);
  const calendars = await listCalendars(token);
  if (!calendars.length) throw new Error('No calendars owned by this account were found. You can download an ICS file.');
  state.token = token; state.calendars = calendars; renderCalendars();
}
$('calendar').addEventListener('change', () => {
  const value = $('calendar').value; $('new-calendar').hidden = value !== newCalendar;
  if (value === newCalendar) $('new-calendar-name').focus(); else { state.calendarId = value; persist(); }
  for (const option of document.querySelectorAll('.draft-calendar option[value=""]')) option.textContent = defaultCalendarLabel();
});
$('create-calendar').addEventListener('click', async () => {
  if (state.busy || !state.token) return;
  setBusy(true);
  try {
    const calendar = await createCalendar(state.token, $('new-calendar-name').value);
    state.calendars.push(calendar); state.calendarId = calendar.id; $('new-calendar-name').value = ''; persist(); renderCalendars();
    showStatus('Created “' + calendar.summary + '”. New events will go there.');
  } catch (error) {
    // A token issued before calendar creation was added cannot create calendars.
    if (/did not grant/.test(error.message)) {
      await chrome.identity.removeCachedAuthToken({ token: state.token }); state.token = null;
      showStatus('Google has not allowed Daydrop to create calendars yet. Click Connect Google and approve it.', 'error');
    } else showStatus(error.message, 'error');
  } finally { setBusy(false); }
});
$('google-action').addEventListener('click', async () => {
  if (state.busy) return;
  setBusy(true);
  try {
    if (!state.token) {
      await loadCalendars(true);
      showStatus('Google connected. Choose a calendar for all events, or set one on individual events.');
    } else {
      if ($('calendar').value === newCalendar) throw new Error('Create the new calendar first, or choose an existing one.');
      if (!state.calendars.some(calendar => calendar.id === $('calendar').value)) throw new Error('Choose a Google calendar first.');
      const selected = structuredClone(state.drafts.filter(draft => draft.selected));
      showStatus('Adding reviewed events to Google Calendar…');
      // Each event goes to its own calendar when one is set, otherwise to the one chosen for all.
      const groups = new Map();
      for (const draft of selected) {
        const id = state.calendars.some(calendar => calendar.id === draft.calendarId) ? draft.calendarId : $('calendar').value;
        groups.set(id, [...(groups.get(id) || []), draft]);
      }
      const results = [];
      for (const [calendarId, drafts] of groups) results.push(...await importGoogleEvents(drafts, calendarId, state.token, {
        onResult(result) { state.results.set(result.id, result); },
      }));
      if (results.some(result => result.error?.includes('expired'))) state.token = null;
      renderDrafts();
      const added = results.filter(result => result.status === 'added').length;
      const duplicate = results.filter(result => result.status === 'duplicate').length;
      const failed = results.filter(result => result.status === 'failed').length;
      showStatus(added + ' added · ' + duplicate + ' already added · ' + failed + ' failed.' + (failed ? ' You can safely retry.' : ''), failed ? 'error' : 'info');
    }
  } catch (error) { showStatus(error.message, 'error'); }
  finally { setBusy(false); }
});

async function initialize() {
  const zones = [...new Set([defaultZone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])];
  $('time-zones').replaceChildren(...zones.map(zone => { const option = element('option'); option.value = zone; return option; }));
  try {
    const saved = globalThis.chrome?.storage?.local ? (await chrome.storage.local.get('autoCalendar')).autoCalendar
      : JSON.parse(localStorage.getItem('autoCalendar') || 'null');
    if (saved) {
      state.drafts = Array.isArray(saved.drafts) ? saved.drafts.filter(draft => draft && typeof draft.id === 'string'
        && typeof draft.title === 'string' && Array.isArray(draft.assumptions)).slice(0, 50) : [];
      if (isTimeZone(saved.preferences?.timeZone)) state.timeZone = saved.preferences.timeZone;
      if (/^[0-9a-f-]{36}$/i.test(saved.preferences?.installationId || '')) state.installationId = saved.preferences.installationId;
      if (typeof saved.preferences?.calendarId === 'string' && saved.preferences.calendarId.length <= 300) state.calendarId = saved.preferences.calendarId;
    }
  } catch { showStatus('Saved drafts could not be loaded. You can start a new capture.', 'error'); }
  state.installationId ||= crypto.randomUUID();
  analysisClient = new AnalysisClient({ installationId: state.installationId, ...(isExtension ? {} : { origin: location.origin }), onUsage: updateUsage });
  $('default-zone').value = state.timeZone;
  $('google-help').textContent = isExtension && googleConfigured() ? 'Google Calendar is configured. Only selected, valid events will be added after you connect.'
    : 'Google Calendar needs the installed extension and OAuth setup from the README. Download ICS to use any calendar now.';
  preferencesChanged(); renderDrafts(); switchTab(state.tab);
  if (state.drafts.length) { $('capture-details').open = false; $('capture-summary').textContent = 'Add another capture'; }
  // Reconnect quietly if Google access was approved before, so calendar choices show straight away.
  if (isExtension && googleConfigured()) loadCalendars(false).then(refreshActions, () => {});
  await refreshUsage();
}
initialize().catch(error => showStatus('Could not initialize the panel: ' + error.message, 'error'));
