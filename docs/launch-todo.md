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
- [ ] Before rewriting anything for Cloudflare, deploy a throwaway test there that answers two questions: does a call to Gemini's free tier succeed from Cloudflare (others have hit "User location is not supported"), and does a 1 MB image request stay inside the free plan's processing limit
- [ ] Replace the local SQLite quota file with a shared store, unless the host is a single always-on instance with a disk
- [ ] Read the caller's address correctly behind the host's proxy, so per-network limits work
- [ ] Store the Gemini key as a host secret; confirm it never reaches logs or responses
- [ ] Confirm request logs never contain screenshots or text captures
- [ ] Keep the pause switch and test it
- [ ] Serve over HTTPS on a stable address

## 4. Decide free or paid Gemini

Checked against the [Gemini API terms](https://ai.google.dev/gemini-api/terms) (effective March 23, 2026) and [pricing page](https://ai.google.dev/gemini-api/docs/pricing) on October 12, 2026:

- The free tier may not be offered to users in the EEA, UK or Switzerland.
- On the free tier Google may use captures to improve its products, human reviewers may read them, and Google says not to submit personal, sensitive or confidential information.
- On either tier the app may not be aimed at, or likely to be used by, people under 18.
- Paid Flash-Lite costs $0.30 per million input tokens and $2.50 per million output tokens; captures are not used to improve Google's products.

To do:

- [x] **Decided October 13, 2026: stay on the free tier**, with a disclosure telling users not to capture personal information
- [ ] Exclude the EEA, UK and Switzerland in the Chrome Web Store's distribution settings, and refuse those countries on the server if the host reports the caller's country
- [ ] State that Daydrop is for adults in the listing and the privacy policy
- [ ] Set the global daily cap below the project's real limit, with headroom

## 5. Production build of the extension

- [ ] Point the build at the hosted address and remove the `127.0.0.1` permission
- [ ] Confirm the package contains no key, no local address, and no unused permission
- [ ] Set the version number

## 6. Consent and privacy in the product

- [x] Notice in the panel: what is sent, to whom, and how Google's free tier may use it
- [x] Link to the privacy policy from the panel (Settings; points at the public GitHub repository)
- [x] One-time acknowledgement before the first analysis: where captures go, no personal information, adults only, not offered in the EEA, UK or Switzerland
- [ ] Update the policy for the hosted service: what is logged, for how long, who to contact

## 7. Google sign-in for the public

- [ ] **(you)** Create a new OAuth client using the Chrome Web Store item ID (it differs from the unpacked ID)
- [ ] **(you)** Add the logo, home page and privacy policy link to the consent screen
- [ ] **(you)** Move the consent screen from Testing to Production and submit for verification. The calendar permissions are sensitive, so Google reviews them; expect to justify each one and possibly record a demo video
- [ ] Until verified: 100-user limit and the "unverified app" warning

## 8. Chrome Web Store

- [ ] **(you)** Register a developer account (one-time fee, about $5)
- [ ] Listing text, 128px icon (done), screenshots, small promo image
- [ ] Justify each permission and fill in the data-use disclosures to match the privacy policy
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
