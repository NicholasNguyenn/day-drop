// This function is serialized by Chrome; keep it self-contained.
export function readCurrentDocument() {
  const selection = window.getSelection()?.toString().trim() || '';
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  const text = (selection || root?.innerText || '').slice(0, 32000);
  const events = [];
  let visited = 0;
  function collect(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 8 || ++visited > 1000 || events.length >= 30) return;
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (types.some(type => typeof type === 'string' && /Event$/.test(type))) {
      events.push(Object.fromEntries(['name', 'startDate', 'endDate', 'location', 'description', 'eventStatus']
        .filter(key => key in value).map(key => [key, value[key]])));
    }
    for (const item of Object.values(value)) {
      if (Array.isArray(item)) item.forEach(child => collect(child, depth + 1));
      else if (item && typeof item === 'object') collect(item, depth + 1);
    }
  }
  if (!selection) for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
    if (script.textContent.length > 100000) continue;
    try { collect(JSON.parse(script.textContent)); } catch { /* Ignore invalid website markup. */ }
  }
  return { text, structuredEvents: events,
    title: document.title, url: location.href, type: selection ? 'selection' : 'page' };
}

export async function capturePage(asImage = false) {
  if (!globalThis.chrome?.scripting) throw new Error('Page capture works when this interface is loaded as a Chrome extension.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('Open a webpage to analyze.');
  if (asImage) {
    const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    return { image: await (await fetch(data)).blob(), source: { type: 'page-image', title: tab.title, url: tab.url } };
  }
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readCurrentDocument });
    if (!result?.result?.text.trim() && !result?.result?.structuredEvents?.length) throw new Error('This page has no readable text. Try Capture page image.');
    return { text: result.result.text, structuredEvents: result.result.structuredEvents,
      source: { type: result.result.type, title: result.result.title, url: result.result.url } };
  } catch (error) {
    if (error.message.includes('no readable text')) throw error;
    throw new Error('Chrome could not read this page. Click the extension toolbar icon on this tab and try again, or paste a screenshot.');
  }
}
