/**
 * Live context utilities, fetches real-world data to inject into Jarvis's system prompt.
 * All sources are free and require no API keys unless noted.
 */
import { geocodeLocation, fetchOpenMeteoForecast, wmoCondition } from "./open-meteo";

/** Formatted current date + time */
export function getCurrentDatetime(): string {
  const now = new Date();
  return now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** Current weather via Open-Meteo, completely free, no API key required */
export async function getWeather(location: string): Promise<string> {
  try {
    const geo = await geocodeLocation(location, 4000);
    if (!geo) return "Weather unavailable";
    const data = await fetchOpenMeteoForecast(geo.latitude, geo.longitude, 4000);
    const cur = data?.current;
    if (!cur || cur.temperature_2m === undefined) return "Weather unavailable";

    const condition = wmoCondition(cur.weather_code);
    const parts = [`${geo.name}: ${Math.round(cur.temperature_2m)}°C`];
    if (cur.apparent_temperature !== undefined) {
      parts.push(`feels like ${Math.round(cur.apparent_temperature)}°C`);
    }
    if (condition) parts.push(condition.toLowerCase());
    if (cur.relative_humidity_2m !== undefined) {
      parts.push(`humidity ${Math.round(cur.relative_humidity_2m)}%`);
    }
    if (cur.wind_speed_10m !== undefined) {
      parts.push(`wind ${Math.round(cur.wind_speed_10m)} km/h`);
    }
    return parts.join(", ");
  } catch {
    return "Weather unavailable";
  }
}

/** Parse upcoming events from a Google Calendar iCal/ICS URL (free secret address) */
export async function getCalendarEvents(
  icsUrl: string,
  days = 7,
): Promise<string> {
  try {
    const res = await fetch(icsUrl, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "Calendar unavailable";
    const text = await res.text();
    return parseIcsEvents(text, days);
  } catch {
    return "Calendar unavailable";
  }
}

function parseIcsEvents(icsText: string, days: number): string {
  const now = new Date();
  // Look ahead window: start of today to end of cutoff day
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cutoff = new Date(startOfToday.getTime() + days * 24 * 60 * 60 * 1000);

  // Split into VEVENT blocks
  const eventBlocks = icsText.split("BEGIN:VEVENT").slice(1);
  const events: { start: Date; summary: string; allDay: boolean }[] = [];

  for (const block of eventBlocks) {
    const summary = extractIcsProp(block, "SUMMARY");
    const dtStart = extractIcsProp(block, "DTSTART");
    const rrule = extractIcsProp(block, "RRULE");
    if (!summary || !dtStart) continue;

    const parsed = parseIcsDate(dtStart);
    if (!parsed) continue;

    const { date, allDay } = parsed;

    // Skip recurring events that we don't expand, keep the first instance if it falls in range
    if (rrule && (date < startOfToday || date > cutoff)) continue;

    if (date >= startOfToday && date <= cutoff) {
      events.push({ start: date, summary: summary.value, allDay });
    }
  }

  if (events.length === 0) return `No events in the next ${days} days`;

  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  return events
    .slice(0, 10)
    .map((e) => {
      const prefix = relativeDayPrefix(e.start);
      const dateStr = e.allDay
        ? e.start.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })
        : e.start.toLocaleString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          });
      return `• ${prefix}${dateStr}: ${e.summary}`;
    })
    .join("\n");
}

function extractIcsProp(block: string, name: string): { value: string; tzid?: string } | null {
  const regex = new RegExp(`\\n${name}([^\\n]*):(.*)`);
  const match = block.match(regex);
  if (!match) return null;
  const params = match[1];
  const value = match[2]
    .trim()
    .replace(/\\,/g, ",")
    .replace(/\\n/g, " ")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
  const tzid = params.match(/TZID=([^;:\n]+)/)?.[1];
  return { value, tzid };
}

function parseIcsDate(raw: { value: string; tzid?: string }): { date: Date; allDay: boolean } | null {
  const { value, tzid } = raw;

  // All-day: VALUE=DATE:YYYYMMDD
  if (/^\d{8}$/.test(value)) {
    return { date: new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`), allDay: true };
  }

  // DateTime: YYYYMMDDTHHmmss or YYYYMMDDTHHmmssZ
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;

  const [, y, mo, d, h, min, s, z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${min}:${s}${z === "Z" ? "Z" : ""}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;

  // If the ICS declared a specific timezone (TZID), and the value is not UTC,
  // we can't convert it perfectly without a timezone library, but we can try to
  // format it later with the declared TZID if supported by the runtime.
  // For now, we mark it as a timed event with the local/UTC interpretation that
  // new Date() gives us. Floating local times are interpreted as local time.
  return { date, allDay: false };
}

function relativeDayPrefix(date: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((date.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (diff === 0) return "Today, ";
  if (diff === 1) return "Tomorrow, ";
  if (diff > 1 && diff < 7) return date.toLocaleDateString("en-US", { weekday: "long" }) + ", ";
  return "";
}

/** Build the full live context string to inject into system prompt */
export async function buildLiveContext(opts: {
  weatherLocation?: string;
  /** @deprecated use calendars */
  calendarIcsUrls?: string[];
  calendars?: { url: string; name?: string }[];
  includeGmail?: boolean;
}): Promise<string> {
  const parts: string[] = [`Current date/time: ${getCurrentDatetime()}`];

  // Run all async sources in parallel
  const [weatherResult, gmailResult] = await Promise.all([
    opts.weatherLocation ? getWeather(opts.weatherLocation) : Promise.resolve(null),
    opts.includeGmail
      ? import("./gmail-context").then(m => m.getGmailContext()).catch(() => null)
      : Promise.resolve(null),
  ]);

  if (weatherResult) parts.push(`Weather: ${weatherResult}`);

  // Support both old calendarIcsUrls and new named calendars
  const calendars: { url: string; name?: string }[] = opts.calendars?.length
    ? opts.calendars
    : (opts.calendarIcsUrls ?? []).filter(Boolean).map((url) => ({ url }));

  if (calendars.length > 0) {
    const results = await Promise.all(
      calendars.map((cal, i) => {
        const label = cal.name || (calendars.length > 1 ? `Calendar ${i + 1}` : "Calendar");
        return getCalendarEvents(cal.url).then(
          (events) => `${label}:\n${events}`,
        );
      }),
    );
    parts.push(`Upcoming calendar events (next 7 days):\n${results.join("\n\n")}`);
  }

  if (gmailResult) parts.push(gmailResult);

  // Google Calendar via API (if connected and calendar scope granted)
  if (calendars.length === 0) {
    try {
      const { getGoogleCalendarContext } = await import("./google-calendar");
      const gcalResult = await getGoogleCalendarContext().catch(() => null);
      if (gcalResult) parts.push(gcalResult);
    } catch { /* google-calendar not available */ }
  }

  return `=== LIVE CONTEXT ===\n${parts.join("\n\n")}\n===================`;
}
