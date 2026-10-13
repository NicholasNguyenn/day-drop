# Chrome Web Store submission

Text to paste into the [developer dashboard](https://chrome.google.com/webstore/devconsole). Drafted October 13, 2026 from the code and [privacy policy](../PRIVACY.md); the answers under "Privacy practices" are your statements to Google, so read them before submitting. The name and the one-line summary come from the package's manifest.

## Package

Upload `output/daydrop-0.1.0.zip` (the hosted build, zipped with `manifest.json` at the top level). To rebuild it, run the hosted build in [development.md](development.md) and zip the contents of `dist/extension`, not the folder itself.

## Store listing

**Category:** Workflow & Planning. **Language:** English.

**Description:**

> Daydrop turns a screenshot or a web page into calendar events you check before saving.
>
> Open the side panel, paste or choose a screenshot, or capture the page you are on. Daydrop lists the events it finds, with the text each one came from. Correct anything that is wrong, mark the events you want, then add them to Google Calendar or download an ICS file for any calendar app.
>
> • Works with schedules, fixtures, timetables, invitations and event pages
> • Every event is reviewed by you before it is saved; nothing is added automatically
> • Relative dates such as "tomorrow" are resolved in your time zone
> • Drafts stay in your browser
> • ICS download needs no sign-in
>
> Please read before using:
>
> • Analysis is free and limited: 5 analyses a day per installation, and the shared daily allowance can run out. Editing, manual events and ICS download keep working.
> • The capture you choose is sent to Daydrop's analysis service and then to Google's Gemini API on its free tier. Google may use that content to improve its products, and human reviewers may read it. Do not capture personal, sensitive or confidential information.
> • Daydrop is for adults (18+) and is not offered in the European Economic Area, the United Kingdom or Switzerland.

**Screenshots:** at least one, 1280×800 or 640×400. Three 1280×800 images are in `output/` (not in Git): capture, review and export. They show the real panel code beside a made-up community-centre page, with sample events supplied locally instead of by Gemini. Replace them with captures of the installed extension if the panel changes.

**Store icon:** `extension/icons/icon-128.png`.

**Support URL:** `https://github.com/NicholasNguyenn/day-drop/issues`

## Privacy practices

**Single purpose:**

> Daydrop finds events in a screenshot or web page the user chooses, lets the user review and correct them, and saves the reviewed events to a calendar.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| sidePanel | Daydrop's whole interface is a side panel, so the user can review events beside the page they came from. |
| activeTab | When the user clicks the toolbar icon and chooses a page action, Daydrop reads that one tab: its text, or a picture of the part that is visible. It has no access to other tabs or to pages the user has not invoked it on. |
| scripting | Used with activeTab to read the visible text and event metadata of the page the user asked Daydrop to analyze. |
| storage | Saves the user's draft events, time zone and a random installation identifier on the device. |
| identity | Signs the user in with Google only when they choose to add reviewed events to Google Calendar. |
| Host permission `https://www.googleapis.com/*` | Calls the Google Calendar API to list the user's calendars and add the events they selected. |
| Optional host permission `https://daydrop-api.nicknguye.workers.dev/*` | Requested at first use to send the chosen capture to Daydrop's own analysis service. |

**Remote code:** No. All code is in the package.

**Data usage — tick:**

- **Website content.** The screenshot or page text the user chooses to analyze is sent to the analysis service and to Google's Gemini API.
- **Location.** The service receives the connection's IP address. It uses it for usage limits (stored only as a keyed hash) and for the regional restriction.

Leave the others unticked: Daydrop does not transmit browsing history, activity, health, financial, authentication or communications data to its service. Calendar events go straight from the browser to the user's own Google account.

**Certifications:** the three statements are true of Daydrop itself: data is not sold, not used for anything beyond the single purpose, and not used for creditworthiness. Note the one caveat below before ticking them.

**Privacy policy URL:** `https://github.com/NicholasNguyenn/day-drop/blob/HEAD/PRIVACY.md`

### Caveat: the free Gemini tier

The store's Limited Use rules restrict passing user data to third parties and letting people read it without the user's agreement. On the free tier Google may use captures to improve its products and reviewers may read them. Daydrop asks for a one-time acknowledgement that says so before the first analysis, and the description above repeats it. A reviewer could still object; the paid tier removes the issue.

## Distribution

- **Payments:** free of charge.
- **Visibility:** Unlisted for the first release, so only people with the link can install it.
- **Regions:** all regions except the 27 EU countries, Iceland, Liechtenstein, Norway, the United Kingdom and Switzerland.

## After the first upload

The draft was uploaded on October 13, 2026. Its item ID is `kefkefhbfklpbffcfnhncpfeckfmbgib`.

1. Create a Google OAuth client of type "Chrome Extension" for that ID, set it as `GOOGLE_CLIENT_ID` in `.env`, rebuild, zip and upload again. If the dashboard refuses the same version, raise `version` in `extension/manifest.json`.
2. Set `ALLOWED_EXTENSION_ID` in `wrangler.jsonc` to that ID and run `npx wrangler deploy`. Unpacked copies of the extension stop working with the hosted service once this is set.
3. Submit for review.
