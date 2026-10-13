# Daydrop

Turn screenshots and webpage content into calendar events you can review, edit, and keep.

## Availability

Daydrop is an early prototype. There is no Chrome Web Store listing or public analysis service yet. If you have a configured test build, open Daydrop from Chrome's toolbar. The browser preview supports draft review and calendar-file downloads; reading the current webpage requires the installed extension.

## What you can do

- Paste, drop, or choose a screenshot of an event listing.
- Extract events from a webpage or selected text in the Chrome extension.
- Review titles, dates, times, locations, and the supporting source text.
- Create or edit events manually.
- Download selected, reviewed events in one `.ics` file for your calendar app.

Direct Google Calendar sign-in is not enabled in the current prototype. You can [import the downloaded ICS file into Google Calendar](https://support.google.com/calendar/answer/37118?hl=en).

## Before you analyze anything

**Use synthetic examples or public listings without personal information in the current live-analysis build. Do not upload personal, sensitive, or confidential information.**

When you start an analysis, your selected screenshot or text is sent through Daydrop's analysis service to Google Gemini. Google's unpaid-service terms allow Google to use submissions to improve its services and involve human reviewers, and prohibit sending personal, sensitive, or confidential information. Read the [Privacy Policy](PRIVACY.md) and [Gemini terms](https://ai.google.dev/gemini-api/terms) before uploading.

The **Preview** badge means results are simulated and captures are not sent to Google. **Gemini vision** means analysis uses Google's service. A privacy notice does not make prohibited uploads acceptable.

## How to use Daydrop

1. Choose your time zone in **Settings**.
2. Paste a screenshot, enter event text, or use **Analyze this page** in the extension. PNG, JPEG, and still WebP screenshots smaller than 8 MB are supported.
3. Click **Find events** for pasted screenshots or text. The page-analysis and page-image buttons start analysis directly.
4. Check each event's details and assumptions, then click **Mark reviewed**. You must correct missing or invalid details before exporting.
5. Select the events you want and click **Download .ics**. Import that file into your preferred calendar app.

You can try **Try the four-match schedule** to explore the workflow with an example image.

## Dates and accuracy

“Today” and “tomorrow” use the date in your chosen time zone when analysis starts. They do not change later when you export. If the source omits an end time, Daydrop suggests a one-hour duration and flags it for review.

AI can miss events or misread details. Check every date, time, time zone, and duration before adding events to your calendar. Editing an event requires you to review it again.

## Your drafts and free allowance

Drafts and settings are saved in your browser on your device. Use **Remove event** or **Clear drafts** to delete them. Downloaded files and events already imported into a calendar are separate and must be deleted there.

The current test build allows five analyses per installation per day. The panel shows your remaining allowance and reset time. Service limits may stop analysis sooner, and some failed or canceled requests count toward your allowance. Manual drafts, editing, and ICS downloads remain available when analysis is unavailable.

## Privacy and support

[Privacy Policy](PRIVACY.md) · [Contact](mailto:nicholasnguyen1103@gmail.com) · [Report a problem](https://github.com/NicholasNguyenn/auto-calendar/issues)

Do not post private screenshots, account tokens, or personal event details in public issue reports.
