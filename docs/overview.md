# Daydrop development plan

Updated October 8, 2026. This is the target architecture and redevelopment roadmap. It replaces the earlier plan that made local models the main screenshot path. The prototype now uses the keyless service contract with a clearly labeled local mock and enforced quotas. The public service has not been deployed. A separately enabled free-project live mode is implemented; actual recognition is awaiting owner configuration and testing.

## Product direction

Build a public Chrome extension that turns screenshots and webpage content into reviewed Google Calendar events or an ICS download. The main experience requires no user-supplied API key, model installation, local server, or command-line setup.

The extension owner operates a hosted vision analysis service and owns its provider key. Start with a limited free beta backed by an unbilled Gemini API project. Analysis has an allowance and can become temporarily unavailable when quotas are exhausted. Unlimited free inference is not a product promise. Hosting has separate costs and limits; a free AI tier does not make the complete service free to operate.

Use one hosted vision path. Local AI, model downloads, user API keys, and OCR fallback are out of scope. Manual entry, editing saved drafts, and ICS remain available when analysis is unavailable. The development mock uses a simple parser for text; this is labeled simulation, not live LLM analysis.

## Decisions to carry into development

| Area | Decision |
| --- | --- |
| Audience | Public Chrome Web Store users; personal testing comes first |
| Default screenshot analysis | Hosted vision LLM reading original pixels and layout |
| API credentials | Owner-managed backend secret; no shared key in extension code and no key required from users |
| Initial provider | Gemini; select the model through screenshot evaluation and verified free-tier availability |
| Cost model | Limited free beta with application caps, provider quotas, and no automatic paid fallback |
| Interface | Chrome side panel: capture, review, export |
| Accounts | No account for the first analysis beta or ICS; Google authorization only for Calendar integration |
| Calendar writes | Explicit action after review; the model never writes to calendars |
| Dates | Freeze the current date in the selected time zone when analysis begins |
| Analysis choices | One hosted service; no local AI, user keys, OCR fallback, or automatic paid fallback |
| Work authorized now | Local development and tests; no spending, provider uploads, deployment, or publication yet |

## Public user workflow

1. Install the extension and open its side panel.
2. Paste, drag, or choose a screenshot; analyze the current webpage; or enter event text.
3. See a concise explanation of where hosted analysis sends the selected content and the remaining free allowance.
4. Click Find events. Only the selected capture is sent for analysis.
5. Review editable drafts with titles, dates, times, locations, evidence, and visible assumptions. Mark extracted events reviewed.
6. Select events and download one ICS file, or connect Google Calendar and add them.

The default screen must not ask for an API key, service URL, or model download. The owner configures the backend URL at build/deployment time. Developer endpoints are configured in the build; no provider or endpoint selector appears in the user settings.

Show useful states: preparing capture, analyzing, found events, no events, invalid response, canceled, network unavailable, user/global allowance exhausted, and provider unavailable. Quota messages include reset times when known. Failures preserve drafts and offer a manual retry or manual event entry. Expensive calls do not retry automatically in the first beta.

If analysis is unavailable, users can still edit drafts, add events manually, parse simple text, and export ICS. Google Calendar setup is independent of AI access.

## Event and date behavior

The backend returns candidate data only. Shared application code normalizes and validates it before review. Calendar and ICS use the exact reviewed values.

- A visual date heading applies to the scheduled cards below it until the next heading. A match card is one event with both opponents in its title.
- Navigation controls, logos, publication dates, canceled events, and repeated competition footers do not become events. Competition and round labels can become notes.
- Today and tomorrow remain relative in model output and resolve from the frozen analysis date. Reopened drafts never shift dates.
- A yearless month/day heading can resolve when another event has a today/tomorrow heading and exactly one matching date lies within the next 31 days. Printed weekdays must agree. The inferred year remains visible for review. Other incomplete or conflicting dates stay unresolved.
- Missing start times require correction or an explicit All day choice. Date-only deadlines can be all-day events.
- A known start with no end gets the existing visibly labeled 60 minute default. Bo3 does not imply duration. Explicit unresolved end fields must stay unresolved.
- The selected time zone is visible. Missing source zones use it; explicit offsets convert consistently. Ambiguous/nonexistent daylight-saving times require correction.
- Preserve the 50-draft limit, deduplication, selection, review state, local persistence, and undo.

The reported schedule is an acceptance example: analysis on October 8, 2026 should create PRX vs T1 and NS vs 100T on October 9 at 04:00 and 07:00, then LOUD vs NRG and VIT vs G2 on October 10 at 04:00 and 07:00. All four remain reviewable. The current transcribed-response test verifies normalization; it is not evidence of live recognition accuracy.

## Target architecture

~~~mermaid
flowchart LR
  U[Chrome side panel] -->|Explicit selected capture| B[Hosted analysis backend]
  B -->|Owner secret and constrained request| V[Gemini vision API]
  V -->|Candidate JSON| B
  B -->|Validated candidates and usage status| U
  U --> R[Local draft review]
  R --> I[ICS download]
  R -->|Explicit import with user OAuth| G[Google Calendar]
  B <--> Q[Atomic quota and request-state store]
~~~

The backend holds the AI key. Calendar authorization stays in the extension and is never included in analysis requests. The model receives evidence and frozen date context, no tools, and no calendar token. Its output is untrusted data and cannot trigger actions.

Capture only after a user action. Prefer selected/readable page text and structured event data for page analysis; offer an explicit page-image action for visual layouts. Keep full source URLs and unnecessary metadata local. Do not monitor browsing in the background.

The production backend exposes a narrow analysis API rather than an arbitrary provider proxy. Validate text length, supported image types, decoded size, dimensions, date context, and output shape. Bound execution/output, fix allowed provider models, sanitize errors, and treat instructions embedded in captures as evidence. Client-side compression must preserve small text and be evaluated against extraction accuracy.

Reuse the Node server and Gemini adapter. Separate preview/static serving from the production handler as needed. Keep hosting and quota-store integrations replaceable until their limits and operating costs are checked.

### Proposed API contract

| Endpoint | Purpose |
| --- | --- |
| POST /v1/session | Register an anonymous installation and issue a short-lived signed analysis token, subject to abuse limits |
| GET /v1/usage | Return remaining allowance, reset time, and availability |
| POST /v1/analyses | Accept one bounded capture, frozen date context, and request ID; return candidates and updated allowance |

Use stable error codes for invalid capture, user/global quota exhaustion, provider quota exhaustion, timeout, unavailable service, and invalid output. Return reset times only when known. Never include credentials in responses or logs.

An installation identifier can be reset and is not a trusted identity. A signed session proves the service issued a token, not that the caller is a genuine Chrome installation. Extension IDs, CORS, and a client header are not authentication. Server-side limits must work when callers bypass the UI.

## Free beta and abuse controls

Use an unbilled provider project and models whose relevant image/text API calls are confirmed free for that project. Pricing currently lists free Gemini Flash and Flash-Lite tiers, but verify project availability and quotas before live use. Do not enable billing, paid fallbacks, search grounding, or other paid features during redevelopment. An API key alone does not reveal a project's billing status; verify configuration before live testing and release. [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)

Initial proposed beta controls, adjustable after checking real quotas:

- Five hosted analyses per installation per day. This is a starting proposal, not an advertised guarantee.
- IP burst limits and bounded concurrency. Account for shared household/school networks.
- A global daily cap below the verified provider allowance with headroom; use a provisional ceiling of 100 only if the project permits it.
- Enforce relevant request and token windows, not only daily totals. Limit capture size, output tokens, duration, and queued work.
- Reserve allowance atomically before dispatch. Requests that may have reached the provider, including uncertain timeouts, remain counted. Duplicate request IDs cannot dispatch a second concurrent call.
- Stop inference when a cap is reached or the quota store is unavailable. Provide a global analysis kill switch.

A shared atomic counter/request-state store is required before public launch. In-memory limits are acceptable for local tests only; restarts and multiple instances must not bypass public budgets. Installation allowances support fairness; global caps bound resources. Anonymous access cannot fully prevent installation resets or rotating IPs. Add stronger identity/challenge measures only if beta abuse requires them, without coupling AI access to Calendar permissions.

Compare Flash and Flash-Lite on the same fixtures, recording event count, field accuracy, unresolved assumptions, latency, and usage. Choose the smallest free-tier model meeting acceptance criteria. Do not assume API access itself guarantees better accuracy.

## Privacy and credentials

Before hosted analysis, explain that the selected screenshot/text goes to our service and Google Gemini. Google's free-tier pricing currently lists content as usable for product improvement; disclosures must reflect the actual provider and terms. There is no local AI option; manual entry and offline draft review/ICS remain available. [Data-use notes](https://ai.google.dev/gemini-api/docs/pricing)

Keep credentials in backend environment secrets, never in extension bundles, Git, responses, or logs. Restrict/rotate keys as supported. This follows Google's production key guidance. [API keys](https://ai.google.dev/gemini-api/docs/api-key)

Process raw captures transiently. Do not persist them in databases, analytics, request logs, or error traces. Audit hosting/proxy logs too. Store minimal quota/request-state metadata with documented expiry. Define retention/disclosure before adding response caching. Provider retention is separate from our own handling; do not claim zero retention without evidence.

Draft fields and short evidence stay in local browser storage and are removable. Images exist only for the active capture. Prefer minimal permissions: side panel, explicit active-tab access, local storage, the specific analysis origin, and required Google APIs. Broad optional host permissions have been removed; replace loopback access with the pinned production origin before distribution. Localhost access belongs in development configuration.

## Existing foundations and missing work

Reusable prototype components:

- Capture/review/export UI, editable drafts, selection, visible assumptions, persistence, review gating, and undo.
- Shared schema, date/time-zone normalization, validation, deduplication, Google event mapping, and RFC 5545 ICS serialization.
- Page text/structured capture and a retained Gemini adapter. Chrome AI, Ollama, and OCR have been removed.
- A local mock preview, signed anonymous sessions, persistent atomic quotas, duplicate prevention, concurrency bounds, and an operator pause switch.
- Automated coverage for normalization, ICS, Google import mocks, quotas, sessions, API failures, and the transcribed four-event fixture. See README for the verified test milestone.

The /v1/session, /v1/usage, and /v1/analyses contract is implemented against a local mock. The keyless panel displays usage and keeps existing drafts. A synthetic four-match fixture exercises review without sending a user screenshot externally. Real screenshot inputs are rejected in mock mode before the client reads their bytes. Public hosting, production abuse defenses, and live extraction accuracy remain open. Provider routing, container dimension/size checks and response bounds are implemented for explicitly enabled live mode. Installed-extension capture and Google OAuth need end-to-end validation.

## Redevelopment sequence and completion checks

### 1. Establish the service contract locally

Define API envelopes, errors, request IDs, quota status, and provider interfaces. Add a local mock hosted service with synthetic successful results and configurable quota/failure scenarios. It must not forward content externally.

Done when the extension receives four mock candidates and handles every error/allowance state through the target contract, without credentials, paid calls, or uploads. Mock results must be visibly labeled.

### 2. Implement bounded backend analysis

Put the Gemini adapter behind the new handler. Add validation, short-lived sessions, atomic quota reservations, concurrency bounds, sanitized errors, and a replaceable shared store. Keep the provider stubbed during development.

Done when tests prove restart/multi-instance limits, duplicate-call prevention, fail-closed quota behavior, no secret exposure, and fixed provider/model routing. Real calls remain disabled until separately authorized.

### 3. Redevelop the default side-panel flow

Make hosted vision the public-build default, with an honest cloud badge, transmission explanation, remaining allowance, actionable errors, and no user key/server setup. Remove local models/OCR and all user key/model/endpoint setup. Migrate preferences while preserving drafts and reuse review/export components. Develop against the local mock.

Done when a new install follows capture → review → ICS without a key/model, existing drafts survive migration, quota failures preserve editing/export, and the UI works at actual side-panel widths. Development builds identify mock analysis and disable real uploads by default.

### 4. Evaluate actual vision extraction

After external analysis is authorized and free-tier configuration verified, evaluate the agreed fixtures against candidate models. Include the four-match schedule, shared headings, columns, repeated cards, AM/PM, missing years, year boundaries, deadlines, ambiguous zones, malformed output, and instruction-like text in captures. Start with synthetic/public fixtures; private captures need explicit destination-specific authorization.

Done when the reported screenshot produces four correctly paired matches and dates/times, ambiguous fields stay reviewable, navigation/footer text is excluded, and measured latency/usage supports the beta limits. Distinguish mocked contract tests from real model evaluation.

### 5. Validate Chrome and Calendar integration

Test paste/drop/file input and webpage extraction in the installed extension. Finish OAuth configuration and test owned-calendar listing, reviewed imports, repeat protection, partial failures, and agreement with ICS. AI and ICS work independently of Calendar sign-in.

Done when installed capture/review/export passes and production packaging contains no provider secret, unintended developer endpoint, or unnecessary host permission. Calendar writes need explicit authorization during live tests.

### 6. Prepare a limited public beta

Choose hosting and a durable quota store after checking free tiers and potential charges. Prepare privacy policy, current Chrome Web Store disclosures, applicable OAuth verification, operator monitoring, quota messages, and shutdown/rollback procedures.

Done before launch when backend secrets, atomic caps, failure behavior, provider/hosting limits, extraction quality, and accurate disclosures have been verified, and deployment/publication explicitly authorized. This planning document does not authorize deployment or billing changes.

## Current implementation and next task

Phases 1–3 have a working local foundation: the versioned contract, simulated success/error responses, durable quota reservations, and keyless UI. Local AI and OCR are removed. The preview and default server use the mock even if a key exists in .env. Only npm run live reads the private owner provider.env and enables Gemini after free-project confirmation and quota configuration. Legacy extraction routes are removed to prevent bypassing the quota handler.

Development limits are five analyses per installation per UTC day, twenty per network per day, one hundred globally per day, six per network per minute, ten globally per minute, and two in flight. Session issuance is capped at ten per network per minute. Accepted failures and uncertain cancellation stay counted; invalid captures and rejected requests do not consume analysis allowance. These are provisional test limits, not a public free-tier promise.

SQLite uses transactions and a shared file across local processes; counters survive restart. Metadata contains HMAC identifiers, time buckets, request IDs and states, plus a development signing secret. Raw captures, raw IP addresses, model responses and provider keys are not stored. Expired quota/request metadata is cleaned on later session/reservation operations; the signing secret remains. The development database lives outside the repository in the local application-data directory. Before public launch, use a shared atomic store appropriate for hosting, specify retention and operational cleanup, configure trusted proxy addressing, and verify provider request/token limits. SQLite tests prove local durability and two-connection consistency, not distributed production readiness.

Free API integration is configured with the owner's private key. The selected AI Studio project showed Free tier and an inactive or unsupported billing account; its Flash-Lite limits were 15 RPM, 500 RPD and 250000 TPM. Live mode pins Gemini 3.5 Flash-Lite behind quota reservations, rejects development overrides, bounds image headers/file size and response fields, and has no paid fallback. The key remains outside the repository and extension; browser disclosure changes before live capture.

Live verification: Gemini extracted the four app-generated match cards, paired each opponent correctly, inherited date headings, and preserved 4:00/7:00 AM. The panel resolved Tomorrow from its frozen analysis context, required review of the one-hour default ends, and downloaded four reviewed events. Their ICS start/end instants and unique IDs were verified, and all 19 older drafts plus their selections were preserved. The schema's maxItems constraint caused HTTP400; removing that provider constraint fixed inference while prompt/parser limits remained intact. All 49 offline tests and syntax checks passed, and the Gemini-mode extension was rebuilt.

Next: evaluate varied authorized captures and validate the installed extension, then configure and test Google Calendar OAuth. Keep provider request and estimated-token rolling windows below supplied quotas, with a separate Pacific provider-day counter. Recheck billing and quotas before launch, pin the production origin, choose hosting/shared storage and prepare a limited public beta. The original private screenshot has not been sent externally and still needs destination-specific authorization. Public hosting and publication are not authorized.

Subscriptions, recurrence, background monitoring, automatic updates to imported events, mobile support, and monetization remain later scope. Revisit operating costs and abuse controls before expanding the beta.
