# Daydrop Privacy Policy

Last updated: October 13, 2026

This policy describes the current Daydrop prototype, maintained by the owner of the [Daydrop repository](https://github.com/NicholasNguyenn/day-drop). It covers the Chrome extension, browser preview, and accompanying analysis service. That service runs either as the maintainer's hosted deployment on Cloudflare or, during development, on the developer's own computer; a build uses one or the other. Daydrop is not yet released in the Chrome Web Store. A future release with different providers or data handling will need an updated policy and appropriate notices before use.

## Before using live analysis

**Do not submit personal, sensitive, or confidential information to the current unpaid Gemini analysis feature.** Use synthetic examples or public event listings without personal information.

Google may use unpaid-service inputs and outputs to improve its services and involve human reviewers. Its terms prohibit personal, sensitive, or confidential submissions. Google's handling and retention are governed by the [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google Privacy Policy](https://policies.google.com/privacy). Daydrop cannot recall data already sent to Google or promise when Google deletes it.

Provider terms require adult users and restrict where this unpaid feature can be offered; it is not for users in the EEA, UK, or Switzerland. The hosted service refuses requests that Cloudflare attributes to those regions or cannot attribute to a country. That check is approximate, the development service has none, and there is no age check. Do not use live analysis where those terms prohibit it. This policy does not override the provider's restrictions.

## Information processed

| Information | How Daydrop handles it |
| --- | --- |
| Screenshots, pasted text, selected page text, and webpage event metadata | Read when you choose the corresponding capture or analysis action. In live mode, the selected content is sent to the analysis service and then Gemini to extract events. |
| Analysis date and time zone | Sent with the capture so relative dates can be interpreted consistently. |
| Draft events | Titles, dates, times, locations, notes, evidence excerpts, source details, selections, and review states are saved locally in your browser. Source details can include a page title, URL, or screenshot filename. |
| Preferences and installation identifier | Your time zone and a randomly generated installation identifier are saved locally. The identifier is sent to the service to maintain your allowance. |
| Request and network information | The service receives your connection's IP address, session credentials, request identifiers, and analysis timing. It stores pseudonymous identifiers derived from the installation and IP address, usage counts, expiry times, and request states for quotas and duplicate prevention. These records are not completely anonymous. On the hosted service, Cloudflare receives each request as the hosting provider and reports the connection's IP address and country; the country is used only for the regional restriction and is not stored. |

Daydrop does not continuously read your clipboard, monitor browsing history, or scan pages in the background. It reads an image from the clipboard when you paste into the panel. Page capture occurs when you choose a page-analysis or page-image action in the installed extension. Selecting an image previews it locally; **Find events** starts analysis of pasted images or text. Page-analysis and page-image actions start analysis directly.

The **Preview** mode uses simulated analysis and does not send captures to Google. Its local service still processes submitted test content and maintains allowance records. **Gemini vision** mode sends the selected capture to Google.

## Storage and retention

- **Drafts and preferences:** Stored using Chrome's local extension storage, or the preview site's browser storage. They remain until you remove them or clear that storage. Drafts may contain information copied from your source, including evidence and URLs. Daydrop does not upload saved drafts as a separate synchronization feature.
- **Original captures:** Images and pasted/page text are held in memory for preview and processing. They are not saved with drafts. The analysis service does not write captures, prompts, or model responses to its application database or application logs. The hosted deployment does not turn on Cloudflare's stored request logs; Cloudflare handles the traffic under its own [privacy policy](https://www.cloudflare.com/privacypolicy/) and may keep network and security records. Portions of a source may still be saved locally as draft evidence or notes.
- **Allowance records:** Stored in the service's database: for the hosted service, storage attached to it on Cloudflare in North America; in development, a file on the developer's computer. Session credentials expire after one hour. Request records become eligible for removal after 24 hours; usage counters expire at their applicable reset or throttle times. Expired records are removed when the service next processes a session or analysis, so an idle service can retain expired records longer. The service's signing secret remains until its installation is removed or the operator replaces it.
- **Files and calendar events:** Downloaded ICS files remain wherever you save them. Imported events remain in the destination calendar. Clearing Daydrop drafts does not remove either.

The current prototype has no hosted analytics, advertising SDK, or advertising use of your event content. Daydrop does not sell your information or use your captures to train its own models. Google's separate practices are described above. Device backups, browser behavior, and third-party services can affect retention outside Daydrop's control.

## Google Calendar and other calendar apps

Direct Google Calendar sign-in is only available in builds configured with a Google sign-in client, and its consent screen is still in Google's testing mode. Downloading an ICS file does not send events to a calendar provider automatically; you decide where to import or share it.

In a build with Google Calendar connection configured, Chrome handles authorization. Daydrop requests access to list your calendars, manage events in calendars you own, and create new calendars. The feature uses that access to display owned calendars, create a new calendar when you ask for one, check for previously imported events, and add the selected reviewed events after your explicit import action. The calendar you last chose is remembered on your device. Event titles, dates, locations, descriptions, and duplicate-prevention identifiers are sent directly to Google's Calendar API.

Daydrop does not ask for your Google password. It holds the access token in panel memory, while Chrome can maintain its own authorization cache. Google account tokens and Calendar API responses are not sent to the analysis service as part of this connection. Google handles calendar data under its own policies.

## Your choices

- Use manual drafts and ICS export without submitting a capture for AI analysis.
- Review an image locally and remove it before starting analysis.
- Remove individual drafts or use **Clear drafts**. Undo may retain recently removed drafts in panel memory until the next removal or panel close.
- Clear extension or preview-site storage to remove saved drafts, preferences, and the installation identifier. This does not delete existing service records or reset service-wide/network limits.
- Remove downloaded files and imported events in their respective locations.
- If you connect Google Calendar in a configured build, revoke Daydrop's access through your [Google account connections](https://myaccount.google.com/connections).

Canceling an analysis can stop Daydrop from waiting for a result, but cannot guarantee that Google stops processing a request already received.

## Security and sharing

The service's Gemini API key is kept outside the extension and source repository; the hosted service holds it as a Cloudflare secret. Requests to the hosted service, from the analysis service to Gemini, and optional calendar requests to Google, use HTTPS. A development build instead connects to a service on the same computer over loopback HTTP. Saved browser data and a local service database are not separately encrypted by Daydrop, so their protection depends on your device, browser profile, and operating-system security.

Selected live-analysis content is shared with Google for extraction; with the hosted service it passes through Cloudflare on the way. Calendar information is shared with your chosen provider when you import or share an ICS file, or explicitly use a configured Calendar connection. Information you email for support is handled by the maintainer and the email provider to respond to your request. Public GitHub issue content is visible to others.

This policy describes current handling; it is not a promise that the prototype meets every requirement for a public release. The present unpaid-AI data restrictions must be resolved before offering analysis of private personal calendars.

## Questions and requests

Contact the Daydrop maintainer at [nicholasnguyen1103@gmail.com](mailto:nicholasnguyen1103@gmail.com) for privacy questions or requests about service records. We may need information sufficient to locate a record, and may not be able to identify records associated with an otherwise anonymous session. Do not send passwords, account tokens, or API keys.

For general bug reports, use the [issue tracker](https://github.com/NicholasNguyenn/day-drop/issues). Do not include private screenshots or personal event details in public reports. If you accidentally send prohibited information to Google, contact the maintainer for assistance; Daydrop cannot promise to remove Google's copy.
