# Daydrop public launch to-do

Written October 12, 2026. Ordered so each step unblocks the next. Items marked **(you)** need your account, money, or a decision; the rest is build work.

## 1. Visual overhaul

- [ ] Agree a direction for the panel (layout, colour, type, density) before touching code
- [ ] Redesign the three steps: capture, review, export
- [ ] Check it at real side-panel widths (about 320 to 500px) and in dark mode if wanted
- [ ] Retake screenshots for the store listing once it settles

## 2. Finish testing what exists

- [ ] Create a calendar from the panel and add events to it (new permission, not yet tried)
- [ ] Send two events to different calendars in one go
- [ ] Analyze a capture with a printed length (for example a film runtime) and confirm the end time
- [ ] Try awkward captures: no year, AM/PM missing, deadlines, several columns, text that looks like instructions
- [ ] Page capture and text entry in the installed extension
- [ ] Repeat an import and confirm nothing is added twice

## 3. Host the analysis service

- [ ] **(you)** Pick a host. Checked October 12, 2026: Render's free tier sleeps after 15 idle minutes, takes about a minute to wake, and loses local files, so the quota data would need an outside database. Cloudflare's free tier has no sleep but needs the service rewritten and allows only 10 ms of processing per request. A small always-on paid instance with a disk runs the current code almost unchanged
- [x] **Decided October 13, 2026: Cloudflare's free plan.** A throwaway test passed that day: Gemini's free tier answered from both the ordinary route (Dallas) and a component pinned to eastern North America (Atlanta), uploads of up to 4 MB were processed without hitting the limit, and Cloudflare reported the caller's country. Only US callers were tried
- [x] Port the service: one Worker in front of a single pinned component that holds the usage limits and makes every Gemini call, so calls always leave from the US. Built October 13, 2026 (`server/worker.mjs`, `wrangler.jsonc`); tested only against a local stand-in for Cloudflare's storage
- [x] **(you)** Deploy it, following "Host on Cloudflare" in `docs/development.md`. Live October 13, 2026: `/api/health` answers ready
- [ ] **(you)** Analyze a capture from the installed extension through the hosted service
- [x] Replace the local SQLite quota file with a shared store: the pinned component's own storage, with one writer
- [x] Read the caller's address correctly behind the host's proxy, so per-network limits work (Cloudflare's `CF-Connecting-IP`; not yet observed on the deployed service)
- [x] **(you)** Store the Gemini key as a host secret (the service only reports ready once it has one). Responses and the service's one log line never include it
- [x] Request logs never contain screenshots or text captures: stored logs are off, and the only line the service writes names a missing setting
- [ ] Keep the pause switch and test it (kept as `ANALYSIS_ENABLED`; not yet tested on the deployed service)
- [x] Serve over HTTPS on a stable address: `https://daydrop-api.nicknguye.workers.dev`

## 4. Decide free or paid Gemini

Checked against the [Gemini API terms](https://ai.google.dev/gemini-api/terms) (effective March 23, 2026) and [pricing page](https://ai.google.dev/gemini-api/docs/pricing) on October 12, 2026:

- The free tier may not be offered to users in the EEA, UK or Switzerland.
- On the free tier Google may use captures to improve its products, human reviewers may read them, and Google says not to submit personal, sensitive or confidential information.
- On either tier the app may not be aimed at, or likely to be used by, people under 18.
- Paid Flash-Lite costs $0.30 per million input tokens and $2.50 per million output tokens; captures are not used to improve Google's products.

To do:

- [x] **Decided October 13, 2026: stay on the free tier**, with a disclosure telling users not to capture personal information
- [ ] Exclude the EEA, UK and Switzerland in the Chrome Web Store's distribution settings
- [x] Refuse those countries, and callers with no known country, on the server (built October 13, 2026)
- [ ] State that Daydrop is for adults in the listing and the privacy policy
- [x] Set the global daily cap below the project's real limit, with headroom. Since October 13, 2026 all users together get 80% of the project's daily and per-minute limits, three analyses at a time (`liveConfiguration` in `server/service.mjs`). With the limits in `wrangler.jsonc` that is 400 a day and 12 a minute

## 5. Production build of the extension

- [x] Point the build at the hosted address and remove the `127.0.0.1` permission (done October 13, 2026; the command is in `docs/development.md`)
- [x] Confirm the package contains no key, no local address, and no unused permission. Checked `output/daydrop-0.1.0.zip` on October 13, 2026: no key; the manifest names only the hosted service and Google; every permission is used. The client code still accepts a localhost service for development builds, but none is configured
- [ ] Set the version number

## 6. Consent and privacy in the product

- [x] Notice in the panel: what is sent, to whom, and how Google's free tier may use it
- [x] Link to the privacy policy from the panel (Settings; points at the public GitHub repository)
- [x] One-time acknowledgement before the first analysis: where captures go, no personal information, adults only, not offered in the EEA, UK or Switzerland
- [x] Update the policy for the hosted service: what is logged, for how long, who to contact (October 13, 2026; reread it once the service is live)

## 7. Google sign-in for the public

- [ ] **(you)** Create a new OAuth client using the Chrome Web Store item ID (it differs from the unpacked ID)
- [ ] **(you)** Add the logo, home page and privacy policy link to the consent screen
- [ ] **(you)** Move the consent screen from Testing to Production and submit for verification. The calendar permissions are sensitive, so Google reviews them; expect to justify each one and possibly record a demo video
- [ ] Until verified: 100-user limit and the "unverified app" warning

## 8. Chrome Web Store

- [ ] **(you)** Register a developer account (one-time fee, about $5)
- [ ] Listing text (drafted in `docs/store-listing.md`), 128px icon (done), screenshots, small promo image
- [ ] Justify each permission and fill in the data-use disclosures to match the privacy policy (drafted in `docs/store-listing.md`; enter them in the dashboard)
- [ ] **(you)** Submit for review, starting as unlisted or with a small tester group

## 9. Running it

- [ ] Watch daily usage, errors and quota exhaustion
- [ ] Clear messages when the daily allowance or the provider is exhausted
- [ ] A way to roll back a bad release
- [ ] A support address that someone reads

## 10. Repository housekeeping

- [ ] **(you)** `git remote set-url origin git@github.com:NicholasNguyenn/day-drop.git`
- [ ] Create `main` on GitHub (the repository is public but has only the `codex/initial-extension` branch) and make it the default
- [ ] Decide whether `.claude/launch.json` is committed or ignored
- [ ] **(you)** Choose a licence, or state that there is none

## Not needed for launch

Recurring events, mobile, updating events already imported, guessing typical event lengths, and any paid tier.
