---
name: ICS calendar parsing
description: Parsing Google Calendar ICS feeds correctly for infinity-ai live context.
---

## Rule

When parsing iCal/ICS feeds from Google Calendar, treat `DTSTART` as potentially having a `TZID` parameter or a `Z` suffix, and treat all-day events (`VALUE=DATE:YYYYMMDD`) as date-only.

**Why:** Events exported from Google Calendar use the calendar's timezone (`TZID=America/New_York`) for timed events, and `VALUE=DATE` for all-day events. Treating both as raw local Date strings shifts times by several hours and makes all-day events look like they start at midnight with a time component.

**How to apply:**

1. Extract `DTSTART` with a regex that captures both parameters and value (`/\nDTSTART([^\n]*):(.*)/`).
2. Pull `TZID` from the parameters if present. Use it to format display times when a timezone library is available.
3. Detect all-day values (`/^\d{8}$/`) and format them as dates without hours.
4. Detect UTC values (`Z` suffix) and convert to local display time.
5. Show relative prefixes (`Today, `, `Tomorrow, `) for events within the next week.
6. Sort events by start time and slice to a reasonable maximum (e.g. 10).