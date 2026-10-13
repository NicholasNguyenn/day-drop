import { extractionInstructions, extractionSchema, parseExtraction } from '../shared/extraction.mjs';
import { ApiError } from './quota-core.mjs';
import { inspectImage } from './image-validation.mjs';

export function estimateInputTokens(input) {
  const bytes = Buffer.byteLength(extractionInstructions(input.context) + JSON.stringify(extractionSchema) + (input.text || '') + JSON.stringify(input.structuredEvents || []));
  if (!input.image) return bytes + 1024;
  const { width, height } = inspectImage(input.image);
  const crop = Math.max(1, Math.floor(Math.min(width, height) / 1.5));
  // Reserve above the documented tile estimate, plus a byte-based text bound.
  // This is a conservative budget, not an exact billable-token measurement.
  return bytes + 1024 + Math.max(8192, 4 * 258 * Math.ceil(width / crop) * Math.ceil(height / crop));
}
async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('INVALID_OUTPUT', 'The vision service returned no response body.', 502);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 262_144) { await reader.cancel(); throw new ApiError('INVALID_OUTPUT', 'The vision response was too large. No drafts were added.', 502); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError('INVALID_OUTPUT', 'The vision service returned invalid data.', 502); }
}

export class ServiceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export async function extractWithGemini(input, {
  apiKey = process.env.GEMINI_API_KEY, model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  fetcher = fetch, signal,
} = {}) {
  if (!apiKey) throw new ServiceError('Gemini service is not configured. Set GEMINI_API_KEY on the server before authorized live testing.', 503);
  if (!/^[a-zA-Z0-9.-]+$/.test(model)) throw new ServiceError('The server model setting is invalid.', 503);
  const parts = [{ text: 'SOURCE EVIDENCE\n' + (input.text || 'Read the attached screenshot.')
    + (input.structuredEvents?.length ? '\nPAGE EVENT DATA\n' + JSON.stringify(input.structuredEvents) : '') }];
  if (input.image) {
    const [, mimeType, data] = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(input.image);
    parts.push({ inlineData: { mimeType, data } });
  }
  const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: extractionInstructions(input.context) }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: extractionSchema, maxOutputTokens: 8192 },
    }),
  });
  if (response.status === 429) throw new ApiError('PROVIDER_QUOTA', 'Gemini’s free allowance is currently exhausted. Try later or add events manually.', 429);
  if (!response.ok) throw new ServiceError('Gemini could not analyze this input. Check the server key and model, then try again.', 502);
  const result = await boundedJson(response);
  const candidate = result.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new ApiError('INVALID_OUTPUT', 'Gemini did not finish the analysis. Use a smaller capture or add events manually.', 502);
  const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
  try { return { events: parseExtraction(text, input.context) }; }
  catch { throw new ServiceError('Gemini returned incomplete event data. Try a smaller capture or add an event manually.', 502); }
}
