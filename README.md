# Daydrop

A Chrome side panel that turns screenshots and webpage content into reviewed calendar drafts. The target is a public extension with owner-operated vision analysis, no user API keys or model installation, and a limited free allowance. Read the [plan](docs/overview.md).

The default preview uses a clearly labeled local mock. An explicit live mode connects the owner-operated Gemini vision adapter behind the same backend quotas. It requires a private owner key, confirmation that the project has billing disabled, and the active model quotas. Local AI and OCR are removed. Live vision has extracted four matches from an app-generated screenshot; public hosting is not deployed.

## Run the preview

Use Node.js 24 or later; no npm dependencies, credentials, or model downloads are required.

~~~powershell
npm run build
npm run preview
~~~

Open [the preview](http://127.0.0.1:8788/sidepanel.html). Choose **Try the four-match schedule**, then **Find events** to create four simulated matches with shared date headings and morning times. Text analysis uses a simple parser and is labeled simulation. Arbitrary screenshots are rejected before the client reads their pixels. The mock is for testing the flow, not measuring recognition accuracy.

Review every extracted event, correct fields/assumptions, and mark it reviewed. Download one ICS containing the selected valid, reviewed events without signing in. Editing a field requires review again. Manual drafts remain available. New results appear first. Existing drafts, selections, time zones, and review states survive the preference migration. Removing drafts provides Undo until another removal or panel close.

Settings contain the default time zone and development response scenarios (normal, no events, unavailable, invalid output, timeout). Canceling or a failure preserves drafts. Screenshot files stay in memory and are not saved with drafts.

## Load the extension

In Chrome, open chrome://extensions, enable Developer mode, and load the generated dist/extension directory. Click the toolbar icon to open the side panel on a webpage. Page capture requires the installed extension. For this development build, run the preview service and click Refresh allowance to grant access to its loopback origin. There is no API key or model field.

The development service origin is bundled in extension/service-config.mjs. Production packaging must replace it with a pinned HTTPS origin and the corresponding narrow permission. The development build is not ready to publish.

## Owner setup for free vision

Only the extension owner needs an API key. Users of the public extension will not supply one.

1. Create a Gemini key in [Google AI Studio](https://aistudio.google.com/api-keys) using a project marked **Free**, with billing disabled. Do not enable billing or paid upgrades.
2. Run **npm run setup:provider**. Edit the resulting %LOCALAPPDATA%/AutoCalendar/development/provider.env outside this repository and OneDrive. Paste the key there, not into chat, extension code, or Git.
3. After checking the project, set GEMINI_FREE_TIER_CONFIRMED=true. Copy its active Flash-Lite RPM, RPD and TPM values from [AI Studio rate limits](https://aistudio.google.com/rate-limit?timeRange=last-28-days). Zero or missing values keep live mode disabled. This confirmation is your statement of the project's billing status; an API key cannot prove it.
4. Stop the mock preview, then run:

~~~powershell
npm run live
~~~

Reload the panel at the same localhost URL. Its badge changes to Gemini vision, development overrides disappear, and it explains transmission to Google before Find events. Use the synthetic four-match schedule for the first live test. Both npm run preview and npm start remain mock-only, even when a key exists. There is no automatic fallback to another model or paid service.

Gemini 3.5 Flash-Lite is pinned for initial testing. Its [current pricing](https://ai.google.dev/gemini-api/docs/pricing) lists free image/text input and output in the free tier; content may be used to improve Google's products. Availability and limits depend on the project. Recheck the project and published terms before launch.

Live mode uses at most ten global calls per application UTC day, two calls per rolling minute and one in flight, further reduced to 80% of the supplied provider quotas. Provider-day counters use midnight Pacific, including daylight saving; application allowances use UTC. A rolling input-token budget uses a conservative estimate, not exact provider usage. Google still enforces its actual quotas. Limits are shared by the project across keys and applications; use a dedicated project.

Images are limited to PNG/JPEG/still WebP, 8 MB decoded file size, 4096 pixels per side and 8 million pixels. Container headers are inspected without full image decompression; the provider validates image content. Page metadata is bounded, output tokens/response bytes are capped, oversized fields or unfinished JSON are rejected, redirects are refused, and no tools or grounding are enabled. Rejected input consumes no analysis allowance; uncertain provider failures remain counted.

For the installed development extension, build a live-mode package explicitly:

~~~powershell
$env:ANALYSIS_MODE = 'gemini'
npm run build
Remove-Item Env:ANALYSIS_MODE
~~~

The bundle contains the service origin and mode only. It never loads or copies provider.env. Production hosting, shared storage and OAuth/store release remain future work.

## Enforced development quotas

The server issues signed anonymous sessions. Every analysis reserves allowance inside a SQLite transaction before extraction. Changing the UI cannot bypass the server caps.

| Limit | Current development value |
| --- | --- |
| Installation | 5 analyses per UTC day |
| Network | 20 per UTC day; 6 per minute |
| Global | 100 per UTC day; 10 per minute |
| In flight | 2 |
| Session issuance | 10 per network per minute |

The panel shows remaining installation allowance and its reset time. Network/global caps can make analysis unavailable earlier. Accepted provider failures/timeouts and uncertain cancellations remain counted. Invalid input, rejected quota reservations, and duplicate request IDs do not consume a second analysis. Calls never automatically retry. A global operator pause is available with ANALYSIS_ENABLED=false or the server instance switch.

Daily counters and request IDs survive restart. SQLite supports multiple local connections using the same file; public multi-host deployment needs a shared atomic store. Anonymous installation IDs can be reset, so network/global limits remain necessary. These are test caps, to be adjusted below verified provider quotas before a free beta.

The development database is at %LOCALAPPDATA%/AutoCalendar/development/quota.sqlite (or the local state directory on other platforms), outside this repository. It stores pseudonymous quota/request metadata and a development signing secret, without raw captures, raw IPs, outputs, or provider keys. Expired metadata is removed on subsequent session/reservation operations. Do not reset this database to bypass quotas.

The API is POST /v1/session, GET /v1/usage, and POST /v1/analyses. Old /api/extract and /api/extract-local routes are removed. Browser preview CSP allows connections only to itself. CORS and extension IDs are origin restrictions, not caller identity. The prototype uses socket IPs and ignores untrusted forwarding headers; production proxy configuration is still required.

## Dates and review

Today/tomorrow resolve once from the selected time zone when analysis starts. A nearby yearless visual heading resolves conservatively when a relative heading anchors it and any weekday matches. Navigation labels and repeated competition footers are not events. One match card means one event containing both opponents. A missing end uses a visible 60 minute default; Bo3 never supplies duration. Ambiguous dates/times and daylight-saving transitions require correction. ICS and Google use the same reviewed fields.

## Google Calendar

Google sign-in and live imports are not configured or tested here. ICS works now. AI sessions never receive Google OAuth tokens.

For future installed-extension testing, configure an owner-managed Chrome Extension OAuth client tied to the extension ID. Set GOOGLE_CLIENT_ID in .env and rebuild. CHROME_EXTENSION_KEY, when used, is Chrome’s public extension key, never a private signing key. The generated manifest requests calendar.events.owned and calendar.calendarlist.readonly. Users connect their own Google account; the panel lists owned calendars and requires an explicit import action.

Imports use fingerprints and deterministic IDs to handle repeats and partial failures. Production requires applicable OAuth verification and accurate Chrome Web Store disclosures. Live calendar writes need separate authorization during development.

## Verification and remaining work

~~~powershell
npm test
npm run check
~~~

Verified milestone: 49 tests passed, and all JavaScript modules passed syntax checks. Automated tests use fixtures and simulated AI/Calendar responses. A separate live Gemini test extracted all four matches from the app-generated schedule, including their shared headings and 4:00/7:00 AM times. The browser resolved Tomorrow from the analysis date in America/Chicago, preserved all 19 older drafts, and downloaded four reviewed events as ICS. The downloaded file was checked for exact UTC start/end times and unique IDs; exporting later preserved the original analysis dates. The live-mode extension package was rebuilt. This verifies the synthetic sample, not accuracy across arbitrary screenshots. The provider schema omits maxItems, which caused HTTP400; the prompt and output parser still enforce the 50-event cap. Coverage includes quota persistence, shared local connections, token tampering/expiry, resets, burst/concurrency/global/network limits, duplicate prevention, cancellation, fail-closed checks, sanitized errors, date normalization, review/export fields and ICS.

Before public use: evaluate extraction on varied, explicitly authorized screenshots; choose hosting/shared storage and verify its costs; configure the production origin and abuse controls; test installed Chrome capture and OAuth; prepare privacy/store disclosures; explicitly authorize deployment/publication. Only app-generated synthetic captures have been sent to Gemini. No billing changes or publication have been performed.
