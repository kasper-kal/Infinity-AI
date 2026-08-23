/**
 * Widget intent detection + data hydration.
 * Given a user message (and settings), returns a typed Widget payload
 * to attach to the chat response.
 */

import { pooledClient } from "./llm-client";
import { geocodeLocation, fetchOpenMeteoForecast, wmoToWidgetCode, wmoCondition, degreesToCompass } from "./open-meteo";

// ─── Shared widget types ─────────────────────────────────────────────────────

export interface ClockTimezone { label: string; tz: string }

export interface ImageResult {
  url: string;          // full-size image
  thumbnail: string;    // proxy thumbnail
  title: string;
  source: string;       // flickr, wikimedia, etc.
  creator?: string;
  license: string;
  licenseUrl?: string;
  landingUrl?: string;  // page where the image lives
  width?: number;
  height?: number;
}

export interface DefineMeaning {
  partOfSpeech: string;
  definition: string;
  example?: string;
}

export interface MusicNote {
  note: string;   // "C4", "Eb3"...
  dur: number;    // beats
  time: number;   // beat offset
}

export interface MusicComposition {
  title: string;
  mood: 'happy' | 'chill' | 'epic' | 'sad';
  tempo: number;                 // BPM
  root: string;                  // key root e.g. "C"
  scale: number[];               // semitone offsets used for melody
  chords: string[];              // chord progression (root semitones + quality)
  bass: string[];                // bass note semitones per chord
  melody: MusicNote[];
  drumPattern: number[];         // 16 steps, 0/1 for kick, snare, hat
}

export type Widget =
  | { type: 'clock'; timezones: ClockTimezone[] }
  | { type: 'weather'; location: string; temp_c: number; temp_f: number; feelsLike_c: number; condition: string; conditionCode: number; humidity: number; windSpeed_kmh: number; windDir: string; isDay: boolean; forecast: ForecastDay[] }
  | { type: 'timer'; durationSeconds: number; label?: string; timerAction?: 'set' | 'add' | 'cancel'; deltaSeconds?: number }
  | { type: 'alarm'; time: string; label?: string }    // "HH:MM" 24-h
  | { type: 'calendar'; events: CalendarEvent[]; weekStart: string }
  | { type: 'images'; query: string; results: ImageResult[] }
  | { type: 'date' }
  | { type: 'calculator'; expression: string; result: string }
  | { type: 'define'; word: string; phonetic?: string; meanings: DefineMeaning[] }
  | { type: 'unit'; value: number; fromUnit: string; toUnit: string; category: string; label: string }
  | { type: 'currency'; from: string; to: string; amount: number; rate: number; updated: string }
  | { type: 'map'; query: string; lat: number; lon: number; displayName: string }
  | { type: 'random'; kind: 'dice' | 'coin' | 'number'; value: number; label: string }
  | { type: 'music'; composition: MusicComposition }


export interface ForecastDay {
  date: string;           // YYYY-MM-DD
  maxTemp_c: number;
  minTemp_c: number;
  condition: string;
  conditionCode: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;          // ISO datetime or YYYY-MM-DD for all-day
  end?: string;
  allDay: boolean;
  calendarName?: string;
}

// ─── Intent detection ────────────────────────────────────────────────────────

type Intent = 'clock' | 'weather' | 'timer' | 'timer_edit' | 'timer_cancel' | 'alarm' | 'calendar' | 'images' | 'date' | 'calculator' | 'define' | 'unit' | 'currency' | 'map' | 'random' | 'music' | null;

function detectIntent(msg: string): Intent {
  const t = msg.toLowerCase();

  if (/\b(what('?s| is) the time|what time is it|current time|time (right )?now|time in\b|time at\b|clock)\b/.test(t)) return 'clock';
  if (/\b(weather|temperature|how (hot|cold|warm)|forecast|raining|sunny|cloudy|humidity|wind speed)\b/.test(t)) return 'weather';
  // Timer cancel must be checked before edit/set to avoid misclassification
  if (/\b(cancel|stop|clear|dismiss|delete|remove)\s+(the\s+)?timer\b/.test(t)) return 'timer_cancel';
  // Timer edit: change/update/extend/shorten/add to existing timer
  if (/\b(change|update|extend|shorten|modify|adjust)\s+(the\s+)?timer\b/.test(t)) return 'timer_edit';
  if (/\badd\s+\d+.*\s*(more\s+)?(minutes?|mins?|seconds?|secs?|hours?|hrs?)\s+(to|on)\s+(the\s+)?timer\b/.test(t)) return 'timer_edit';
  if (/\b(subtract|remove|take off)\s+\d+.*\s*(minutes?|mins?|seconds?|secs?|hours?|hrs?)\s+(from|off)\s+(the\s+)?timer\b/.test(t)) return 'timer_edit';
  if (/\bset\s+(the\s+)?timer\s+to\b/.test(t)) return 'timer_edit';
  if (/\bmake\s+(the\s+)?timer\b/.test(t)) return 'timer_edit';
  // "set a 5 minute timer", "set a timer for pasta", "start a 30 second timer", etc.
  if (/\b(set|start)\s+(?:a\s+)?(?:\d+[\s\w]*?\s+)?timer\b/.test(t)) return 'timer';
  if (/\btimer\s+(for|of)\b/.test(t)) return 'timer';
  if (/\b(countdown|count down)\b/.test(t)) return 'timer';
  if (/\b(set( an?)? alarm|wake me up( at)?|alarm( at| for)?|remind me at)\b/.test(t)) return 'alarm';
  if (/\b(calendar|my schedule|agenda|upcoming events?|what('?s| is) (on|happening)|this week|next week|show me (my )?(events?|calendar))\b/.test(t)) return 'calendar';
  // Images, "show me an image of a dog" → REAL web image search (not generation)
  if (/\b(show|find|get|give)\s+(me\s+)?(a\s+|an\s+|some\s+)?(image|picture|photo|pic|pictures|photos|images)\s+of\b/.test(t)
    || /\b(what does|what does a|what does an)\s+[a-z]+.*\blook like\b/.test(t)
    || /\bshow me what .* looks like\b/.test(t)
    || /\b(picture|image|photo|pictures|images|photos)s?\s+of\b/.test(t)) return 'images';
  // Date, "what's the date", "what day is it", "today's date"
  if (/\b(what('?s| is) (the )?date|what day is it|today('?s)? date|date today|what date is it)\b/.test(t)) return 'date';
  // Calculator, "what is 15% of 200", "calculate 5*7+2"
  const hasMath = /[0-9]/.test(t) && /[+\-*/%^]|%\s+of/.test(t);
  const mathAsk = /\b(what('?s| is)|calculate|how much is|how much)\b/.test(t);
  if (hasMath && (mathAsk || /%\s+of\b/.test(t))) return 'calculator';
  // Define, "define serendipity", "what does serendipity mean"
  if (/\bdefine\b|\bmeaning of\b|\bwhat does [a-z]+ mean\b/.test(t)) return 'define';
  // Unit conversion, "convert 5 miles to km", "how many feet in 2 meters", "5kg in lbs"
  if (/\b(convert|how many|how much is|in)\b/.test(t) && /\b(km|kilometers?|kilometres?|miles?|meters?|metres?|feet|foot|inches?|pounds?|lbs?|kilograms?|kilos?|grams?|ounces?|liters?|litres?|gallons?|celsius|fahrenheit|°c|°f|cm|mm)\b/.test(t)) return 'unit';
  // Currency, "convert 100 usd to eur", "how much is 50 euros in dollars"
  if (/\b(usd|eur|gbp|yen|jpy|euros?|dollars?|pounds sterling|currency)\b/.test(t) && /\b(convert|how much|to|in)\b/.test(t)) return 'currency';
  // Map, "where is paris", "show me a map of tokyo", "map of london"
  if (/\b(where is|where's|show me (a map|the location)|map of|location of)\b/.test(t)) return 'map';
  // Random, "roll a dice", "flip a coin", "pick a random number between 1 and 100"
  if (/\b(roll|dice|die|flip|coin|heads|tails|random number|pick a number)\b/.test(t)) return 'random';
  // Music, "play some music", "make a song", "compose a beat", "play something chill/happy"
  if (/\b(play|make|compose|create|write|hear|sing)\s+(me\s+)?(some|a|an)?\s*(music|song|melody|beat|tune|track|jam|audio)\b/.test(t)
    || /\b(play something|some music|make music|music please)\b/.test(t)) return 'music';

  return null;
}

/**
 * LLM fallback for widget intent, catches natural phrasings the regex misses
 * ("is it hot in Berlin?", "what's the exchange rate today?", …).
 *
 * Only reached when `detectIntent` returns null, so regex hits keep their
 * zero-cost fast path. Time-boxed: if the LLM is slow or every key is cooling,
 * it resolves `null` and the message proceeds normally, the widget layer must
 * never block or break a chat turn.
 */
function detectWidgetIntentWithLLM(userMessage: string): Promise<Intent> {
  const intents = [
    'clock', 'weather', 'timer', 'timer_edit', 'timer_cancel', 'alarm',
    'calendar', 'images', 'date', 'calculator', 'define', 'unit',
    'currency', 'map', 'random', 'music',
  ];
  const prompt =
    'Classify this user message into EXACTLY ONE label. Reply with the label only, nothing else, no punctuation.\n\n' +
    'Labels:\n' +
    '- clock, asking the time, or the time in a city ("what time is it", "time in Tokyo")\n' +
    '- weather, weather, temperature, forecast, "is it hot/cold" ("is it hot in Berlin?")\n' +
    '- timer, setting a timer or countdown ("set a 20 minute timer")\n' +
    '- timer_edit, changing/extending an existing timer ("add 5 minutes to the timer")\n' +
    '- timer_cancel, cancelling/stopping a timer ("cancel the timer")\n' +
    '- alarm, setting an alarm or wake-up ("wake me at 7am")\n' +
    '- calendar, schedule, events, agenda ("what do I have on today")\n' +
    '- images, wanting to SEE real photos/pictures of something ("show me pictures of golden retrievers")\n' +
    '- date, today\'s date or day ("what day is it")\n' +
    '- calculator, doing math ("what is 15% of 200")\n' +
    '- define, definition of a word ("define serendipity")\n' +
    '- unit, converting units ("5 miles to km", "2 liters to cups")\n' +
    '- currency, converting money between currencies ("100 usd to eur")\n' +
    '- map, where a place is / its location ("where is Paris")\n' +
    '- random, dice, coin flip, random number ("roll a dice")\n' +
    '- music, composing/playing a song ("make a happy song")\n' +
    '- NONE, anything that does not clearly fit the above (general chat, questions, requests, commands)\n\n' +
    `Message: ${userMessage.slice(0, 500)}\n\nLabel:`;

  const classify = pooledClient()
    .chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 6,
      temperature: 0,
    } as never)
    .then((res) => {
      const label = (res.choices?.[0]?.message?.content ?? "").trim().toLowerCase();
      if (!label || label === "none") return null as Intent;
      return (intents.find((i) => label === i || label.startsWith(i)) as Intent) ?? null;
    })
    .catch(() => null as Intent);

  return Promise.race([
    classify,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
  ]);
}

// ─── Clock ───────────────────────────────────────────────────────────────────

const CITY_TZ: Record<string, { label: string; tz: string }> = {
  'tokyo':         { label: 'Tokyo',         tz: 'Asia/Tokyo' },
  'london':        { label: 'London',        tz: 'Europe/London' },
  'new york':      { label: 'New York',      tz: 'America/New_York' },
  'los angeles':   { label: 'Los Angeles',   tz: 'America/Los_Angeles' },
  'la':            { label: 'Los Angeles',   tz: 'America/Los_Angeles' },
  'paris':         { label: 'Paris',         tz: 'Europe/Paris' },
  'berlin':        { label: 'Berlin',        tz: 'Europe/Berlin' },
  'sydney':        { label: 'Sydney',        tz: 'Australia/Sydney' },
  'dubai':         { label: 'Dubai',         tz: 'Asia/Dubai' },
  'singapore':     { label: 'Singapore',     tz: 'Asia/Singapore' },
  'mumbai':        { label: 'Mumbai',        tz: 'Asia/Kolkata' },
  'delhi':         { label: 'Delhi',         tz: 'Asia/Kolkata' },
  'beijing':       { label: 'Beijing',       tz: 'Asia/Shanghai' },
  'shanghai':      { label: 'Shanghai',      tz: 'Asia/Shanghai' },
  'moscow':        { label: 'Moscow',        tz: 'Europe/Moscow' },
  'chicago':       { label: 'Chicago',       tz: 'America/Chicago' },
  'toronto':       { label: 'Toronto',       tz: 'America/Toronto' },
  'amsterdam':     { label: 'Amsterdam',     tz: 'Europe/Amsterdam' },
  'seoul':         { label: 'Seoul',         tz: 'Asia/Seoul' },
  'hong kong':     { label: 'Hong Kong',     tz: 'Asia/Hong_Kong' },
  'jakarta':       { label: 'Jakarta',       tz: 'Asia/Jakarta' },
  'bangkok':       { label: 'Bangkok',       tz: 'Asia/Bangkok' },
  'istanbul':      { label: 'Istanbul',      tz: 'Europe/Istanbul' },
  'cairo':         { label: 'Cairo',         tz: 'Africa/Cairo' },
  'johannesburg':  { label: 'Johannesburg',  tz: 'Africa/Johannesburg' },
  'denver':        { label: 'Denver',        tz: 'America/Denver' },
  'sao paulo':     { label: 'São Paulo',     tz: 'America/Sao_Paulo' },
  'mexico city':   { label: 'Mexico City',   tz: 'America/Mexico_City' },
  'auckland':      { label: 'Auckland',      tz: 'Pacific/Auckland' },
};

const DEFAULT_TIMEZONES: ClockTimezone[] = [
  { label: 'New York',    tz: 'America/New_York' },
  { label: 'London',      tz: 'Europe/London' },
  { label: 'Dubai',       tz: 'Asia/Dubai' },
  { label: 'Tokyo',       tz: 'Asia/Tokyo' },
  { label: 'Sydney',      tz: 'Australia/Sydney' },
];

/** Map a free-form location string to an IANA timezone, used for weather_location → clock tz */
function getTimezoneFromLocation(location: string): string {
  const t = location.toLowerCase().trim();
  // Direct city match
  for (const [city, info] of Object.entries(CITY_TZ)) {
    if (t.includes(city) || city.includes(t.split(',')[0].trim())) return info.tz;
  }
  // Country / region fallbacks
  const COUNTRY_TZ: Record<string, string> = {
    'uk': 'Europe/London', 'england': 'Europe/London', 'britain': 'Europe/London', 'scotland': 'Europe/London', 'wales': 'Europe/London',
    'usa': 'America/New_York', 'united states': 'America/New_York', 'america': 'America/New_York',
    'germany': 'Europe/Berlin', 'france': 'Europe/Paris', 'spain': 'Europe/Madrid',
    'italy': 'Europe/Rome', 'japan': 'Asia/Tokyo', 'china': 'Asia/Shanghai',
    'australia': 'Australia/Sydney', 'india': 'Asia/Kolkata', 'brazil': 'America/Sao_Paulo',
    'canada': 'America/Toronto', 'mexico': 'America/Mexico_City', 'russia': 'Europe/Moscow',
    'netherlands': 'Europe/Amsterdam', 'sweden': 'Europe/Stockholm', 'norway': 'Europe/Oslo',
    'denmark': 'Europe/Copenhagen', 'switzerland': 'Europe/Zurich', 'austria': 'Europe/Vienna',
    'poland': 'Europe/Warsaw', 'turkey': 'Europe/Istanbul', 'egypt': 'Africa/Cairo',
    'nigeria': 'Africa/Lagos', 'kenya': 'Africa/Nairobi', 'south africa': 'Africa/Johannesburg',
    'argentina': 'America/Argentina/Buenos_Aires', 'colombia': 'America/Bogota',
    'chile': 'America/Santiago', 'peru': 'America/Lima', 'new zealand': 'Pacific/Auckland',
    'portugal': 'Europe/Lisbon', 'ireland': 'Europe/Dublin', 'greece': 'Europe/Athens',
    'czech': 'Europe/Prague', 'hungary': 'Europe/Budapest', 'romania': 'Europe/Bucharest',
    'ukraine': 'Europe/Kiev', 'finland': 'Europe/Helsinki', 'israel': 'Asia/Jerusalem',
    'saudi': 'Asia/Riyadh', 'iran': 'Asia/Tehran', 'pakistan': 'Asia/Karachi',
    'bangladesh': 'Asia/Dhaka', 'thailand': 'Asia/Bangkok', 'vietnam': 'Asia/Ho_Chi_Minh',
    'malaysia': 'Asia/Kuala_Lumpur', 'philippines': 'Asia/Manila', 'indonesia': 'Asia/Jakarta',
  };
  for (const [key, tz] of Object.entries(COUNTRY_TZ)) {
    if (t.includes(key)) return tz;
  }
  return 'UTC';
}

function buildClockWidget(msg: string, settings: Record<string, string>): Extract<Widget, { type: 'clock' }> {
  const t = msg.toLowerCase();
  const found: ClockTimezone[] = [];
  for (const [city, info] of Object.entries(CITY_TZ)) {
    if (t.includes(city) && !found.some(f => f.tz === info.tz)) found.push(info);
  }
  if (found.length > 0) return { type: 'clock', timezones: found };

  // No specific city mentioned, use the user's weather location for local time
  const weatherLoc = settings['weather_location']?.trim();
  if (weatherLoc) {
    const tz = getTimezoneFromLocation(weatherLoc);
    const label = weatherLoc.split(',')[0].trim();
    return { type: 'clock', timezones: [{ label, tz }] };
  }

  return { type: 'clock', timezones: DEFAULT_TIMEZONES };
}

// ─── Weather (Open-Meteo, free, no API key) ──────────────────────────────────

async function fetchWeatherWidget(location: string): Promise<Extract<Widget, { type: 'weather' }> | null> {
  try {
    const geo = await geocodeLocation(location);
    if (!geo) return null;
    const data = await fetchOpenMeteoForecast(geo.latitude, geo.longitude);
    const cur = data?.current;
    if (!cur || cur.temperature_2m === undefined) return null;

    const code = cur.weather_code ?? 0;
    const daily = data?.daily;
    const forecast: ForecastDay[] = (daily?.time ?? []).map((date, i) => {
      const dayCode = daily?.weather_code?.[i] ?? code;
      return {
        date,
        maxTemp_c: daily?.temperature_2m_max?.[i] ?? 0,
        minTemp_c: daily?.temperature_2m_min?.[i] ?? 0,
        condition: wmoCondition(dayCode),
        conditionCode: wmoToWidgetCode(dayCode),
      };
    });

    return {
      type: 'weather',
      location: geo.name,
      temp_c: cur.temperature_2m,
      temp_f: (cur.temperature_2m * 9) / 5 + 32,
      feelsLike_c: cur.apparent_temperature ?? cur.temperature_2m,
      condition: wmoCondition(code),
      conditionCode: wmoToWidgetCode(code),
      humidity: cur.relative_humidity_2m ?? 0,
      windSpeed_kmh: cur.wind_speed_10m ?? 0,
      windDir: degreesToCompass(cur.wind_direction_10m ?? 0),
      isDay: (cur.is_day ?? 1) === 1,
      forecast,
    };
  } catch {
    return null;
  }
}

function extractWeatherLocation(msg: string, settingsLocation: string): string {
  // "weather in London", "weather for Paris", "weather at Tokyo"
  const m = msg.match(/weather\s+(in|for|at)\s+([a-zA-Z\s,]+?)(?:\s*\?|$)/i)
    ?? msg.match(/(?:how\s+(?:hot|cold|warm)|temperature)\s+(?:in|at)\s+([a-zA-Z\s,]+?)(?:\s*\?|$)/i);
  if (m) return (m[2] ?? m[1]).trim();
  return settingsLocation || 'London';
}

// ─── Timer ───────────────────────────────────────────────────────────────────

/** Parse a human-readable duration string into total seconds. Returns 0 if nothing found. */
function parseDurationSeconds(t: string): number {
  const hourMin = t.match(/(\d+)\s*h(?:our|r)?s?\s*(?:and\s*)?(\d+)\s*m(?:in(?:ute)?)?s?/);
  const minSec  = t.match(/(\d+)\s*m(?:in(?:ute)?)?s?\s*(?:and\s*)?(\d+)\s*s(?:ec(?:ond)?)?s?/);
  const hoursOnly = t.match(/(\d+)\s*h(?:our|r)?s?/);
  const minsOnly  = t.match(/(\d+)\s*m(?:in(?:ute)?)?s?/);
  const secsOnly  = t.match(/(\d+)\s*s(?:ec(?:ond)?)?s?/);

  if (hourMin) return parseInt(hourMin[1]) * 3600 + parseInt(hourMin[2]) * 60;
  if (minSec)  return parseInt(minSec[1])  * 60   + parseInt(minSec[2]);
  if (hoursOnly) return parseInt(hoursOnly[1]) * 3600;
  if (minsOnly)  return parseInt(minsOnly[1])  * 60;
  if (secsOnly)  return parseInt(secsOnly[1]);
  return 0;
}

function parseTimerWidget(msg: string): Extract<Widget, { type: 'timer' }> | null {
  const seconds = parseDurationSeconds(msg.toLowerCase());
  if (seconds <= 0) return null;

  // Extract optional label (e.g. "set a timer for pasta" → label="pasta")
  const labelMatch = msg.match(/(?:for|to)\s+([a-zA-Z\s]+?)(?:\s+timer|\s*\?|$)/i);
  const label = labelMatch?.[1]?.trim();

  return { type: 'timer', durationSeconds: seconds, label, timerAction: 'set' };
}

function parseTimerEditWidget(msg: string): Extract<Widget, { type: 'timer' }> | null {
  const t = msg.toLowerCase();

  // "cancel"/"stop" the timer
  if (/\b(cancel|stop|clear|dismiss|delete|remove)\s+(the\s+)?timer\b/.test(t)) {
    return { type: 'timer', durationSeconds: 0, timerAction: 'cancel' };
  }

  // "add X to the timer" / "extend by X"
  const addMatch = t.match(/(?:add|extend(?:\s+by)?)\s+([\d\s\w]+?)\s+(?:more\s+)?(?:to|on)\s+(?:the\s+)?timer/);
  if (addMatch) {
    const delta = parseDurationSeconds(addMatch[1]);
    if (delta > 0) return { type: 'timer', durationSeconds: 0, deltaSeconds: delta, timerAction: 'add' };
  }

  // "subtract/remove X from the timer"
  const subMatch = t.match(/(?:subtract|remove|take off)\s+([\d\s\w]+?)\s+(?:from|off)\s+(?:the\s+)?timer/);
  if (subMatch) {
    const delta = parseDurationSeconds(subMatch[1]);
    if (delta > 0) return { type: 'timer', durationSeconds: 0, deltaSeconds: delta, timerAction: 'add', };
    // Negative delta handled on frontend
  }

  // "change/set/make/update the timer to X" or "make it X"
  const seconds = parseDurationSeconds(t);
  if (seconds > 0) return { type: 'timer', durationSeconds: seconds, timerAction: 'set' };

  return null;
}

// ─── Alarm ───────────────────────────────────────────────────────────────────

function parseAlarmWidget(msg: string): Extract<Widget, { type: 'alarm' }> | null {
  const t = msg.toLowerCase();

  // Match "7:30 am", "7:30am", "7am", "19:45"
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!m) return null;

  let hours = parseInt(m[1]);
  const mins = m[2] ? parseInt(m[2]) : 0;
  const meridiem = m[3];

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  if (hours > 23 || mins > 59) return null;

  const time = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  return { type: 'alarm', time };
}

// ─── Images (real web image search via Openverse, free, no API key) ─────────

/** Extract the image-search query from a message like "show me an image of a dog". */
function extractImageQuery(msg: string): string | null {
  const t = msg.toLowerCase();
  const m = t.match(/(?:show|find|get|give)\s+(?:me\s+)?(?:a\s+|an\s+|some\s+)?(?:image|picture|photo|pic|pictures|photos|images)\s+of\s+(.+)/i)
    ?? t.match(/(?:picture|image|photo|pictures|images|photos)s?\s+of\s+(?:a\s+|an\s+|the\s+)?(.+)/i)
    ?? t.match(/what does (?:a\s+|an\s+|the\s+)?([a-z ,']+?)\s+look like/i)
    ?? t.match(/show me what ([a-z ,']+?) looks like/i);
  if (!m) return null;
  const q = (m[1] ?? m[0]).trim()
    .replace(/[?.!]+$/g, '')
    .replace(/\s+for me\s*$/i, '')
    .replace(/^to me\s*/i, '')
    .trim();
  return q.length >= 2 ? q : null;
}

async function fetchImagesWidget(msg: string): Promise<Extract<Widget, { type: 'images' }> | null> {
  const query = extractImageQuery(msg);
  if (!query) return null;
  try {
    const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=6&license_type=all`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'InfinityAssistant/1.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const results: ImageResult[] = (data.results ?? [])
      .slice(0, 6)
      .map((r) => ({
        url: String(r.url ?? r.thumbnail ?? ''),
        thumbnail: String(r.thumbnail ?? r.url ?? ''),
        title: String(r.title ?? ''),
        source: String(r.source ?? r.provider ?? ''),
        creator: r.creator ? String(r.creator) : undefined,
        license: String(r.license ?? ''),
        licenseUrl: r.license_url ? String(r.license_url) : undefined,
        landingUrl: r.foreign_landing_url ? String(r.foreign_landing_url) : undefined,
        width: typeof r.width === 'number' ? r.width : undefined,
        height: typeof r.height === 'number' ? r.height : undefined,
      }))
      .filter((r) => r.url);
    if (results.length === 0) return null;
    return { type: 'images', query, results };
  } catch {
    return null;
  }
}

// ─── Date ─────────────────────────────────────────────────────────────────────

function buildDateWidget(): Extract<Widget, { type: 'date' }> {
  return { type: 'date' };
}

// ─── Calculator (safe, no eval) ──────────────────────────────────────────────

/** Tiny safe arithmetic parser: + - * / ^ % and parentheses. */
function safeEvaluate(expr: string): number | null {
  const tokens = expr.replace(/\s+/g, '').match(/\d+\.?\d*|[+\-*/^%()]/g);
  if (!tokens || tokens.length === 0) return null;

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr(): number | null {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === '*') left = left * right;
      else if (op === '/') { if (right === 0) return null; left = left / right; }
      else left = left % right;
    }
    return left;
  }

  function parseFactor(): number | null {
    const tok = peek();
    if (tok === '(') {
      consume();
      const inner = parseExpr();
      if (inner === null || consume() !== ')') return null;
      return parsePow(inner);
    }
    const n = Number(consume());
    if (Number.isNaN(n)) return null;
    return parsePow(n);
  }

  function parsePow(base: number): number {
    if (peek() === '^') {
      consume();
      const exp = Number(consume());
      if (!Number.isNaN(exp)) return Math.pow(base, exp);
    }
    return base;
  }

  const result = parseExpr();
  if (result === null || pos !== tokens.length) return null;
  if (!Number.isFinite(result)) return null;
  return Math.round(result * 1e8) / 1e8;
}

function buildCalculatorWidget(msg: string): Extract<Widget, { type: 'calculator' }> | null {
  const t = msg.toLowerCase();

  // "15% of 200" → 15/100 * 200
  const pctOf = t.match(/(\d+(?:\.\d+)?)%\s+of\s+(\d+(?:\.\d+)?)/);
  if (pctOf) {
    const result = (parseFloat(pctOf[1]) / 100) * parseFloat(pctOf[2]);
    const rounded = Math.round(result * 1e6) / 1e6;
    return { type: 'calculator', expression: `${pctOf[1]}% of ${pctOf[2]}`, result: String(rounded) };
  }

  // Strip the question prefix, keep the expression
  const cleaned = t
    .replace(/^(what('?s| is| does)|calculate|how much is|how much)\s*/i, '')
    .replace(/\s*\?$/, '')
    .replace(/^(the answer to|solve)\s*/i, '')
    .trim();
  const result = safeEvaluate(cleaned);
  if (result === null) return null;
  return { type: 'calculator', expression: cleaned, result: String(result) };
}

// ─── Define (dictionaryapi.dev, free, no API key) ───────────────────────────

function extractDefineWord(msg: string): string | null {
  const t = msg.toLowerCase();
  const m = t.match(/\bdefine\s+([a-z][a-z'-]*)/)
    ?? t.match(/\bmeaning of\s+([a-z][a-z'-]*)/)
    ?? t.match(/\bwhat does\s+([a-z][a-z'-]*)\s+mean/);
  return m ? m[1] : null;
}

async function fetchDefineWidget(msg: string): Promise<Extract<Widget, { type: 'define' }> | null> {
  const word = extractDefineWord(msg);
  if (!word) return null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      headers: { 'User-Agent': 'InfinityAssistant/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<Record<string, unknown>>;
    const entry = data[0];
    if (!entry) return null;
    const meanings: DefineMeaning[] = [];
    for (const m of (entry.meanings as Array<{ partOfSpeech?: string; definitions?: Array<{ definition?: string; example?: string }> }> ?? [])) {
      for (const d of (m.definitions ?? []).slice(0, 2)) {
        if (!d.definition) continue;
        meanings.push({
          partOfSpeech: m.partOfSpeech ?? '',
          definition: d.definition,
          example: d.example,
        });
        if (meanings.length >= 3) break;
      }
      if (meanings.length >= 3) break;
    }
    if (meanings.length === 0) return null;
    return { type: 'define', word: String(entry.word ?? word), phonetic: entry.phonetic ? String(entry.phonetic) : undefined, meanings };
  } catch {
    return null;
  }
}

// ─── Unit converter ─────────────────────────────────────────────────────────────

const UNIT_ALIASES: Record<string, { unit: string; toMeters: number | null; toKg: number | null; toLiters: number | null; toCelsius: null | 'toF' | 'fromF' }> = {
  'km': { unit: 'km', toMeters: 1000, toKg: null, toLiters: null, toCelsius: null },
  'kilometer': { unit: 'km', toMeters: 1000, toKg: null, toLiters: null, toCelsius: null },
  'kilometers': { unit: 'km', toMeters: 1000, toKg: null, toLiters: null, toCelsius: null },
  'kilometre': { unit: 'km', toMeters: 1000, toKg: null, toLiters: null, toCelsius: null },
  'kilometres': { unit: 'km', toMeters: 1000, toKg: null, toLiters: null, toCelsius: null },
  'm': { unit: 'm', toMeters: 1, toKg: null, toLiters: null, toCelsius: null },
  'meter': { unit: 'm', toMeters: 1, toKg: null, toLiters: null, toCelsius: null },
  'meters': { unit: 'm', toMeters: 1, toKg: null, toLiters: null, toCelsius: null },
  'metre': { unit: 'm', toMeters: 1, toKg: null, toLiters: null, toCelsius: null },
  'metres': { unit: 'm', toMeters: 1, toKg: null, toLiters: null, toCelsius: null },
  'cm': { unit: 'cm', toMeters: 0.01, toKg: null, toLiters: null, toCelsius: null },
  'mm': { unit: 'mm', toMeters: 0.001, toKg: null, toLiters: null, toCelsius: null },
  'mile': { unit: 'mi', toMeters: 1609.344, toKg: null, toLiters: null, toCelsius: null },
  'miles': { unit: 'mi', toMeters: 1609.344, toKg: null, toLiters: null, toCelsius: null },
  'foot': { unit: 'ft', toMeters: 0.3048, toKg: null, toLiters: null, toCelsius: null },
  'feet': { unit: 'ft', toMeters: 0.3048, toKg: null, toLiters: null, toCelsius: null },
  'inch': { unit: 'in', toMeters: 0.0254, toKg: null, toLiters: null, toCelsius: null },
  'inches': { unit: 'in', toMeters: 0.0254, toKg: null, toLiters: null, toCelsius: null },
  'kg': { unit: 'kg', toMeters: null, toKg: 1, toLiters: null, toCelsius: null },
  'kilogram': { unit: 'kg', toMeters: null, toKg: 1, toLiters: null, toCelsius: null },
  'kilograms': { unit: 'kg', toMeters: null, toKg: 1, toLiters: null, toCelsius: null },
  'kilo': { unit: 'kg', toMeters: null, toKg: 1, toLiters: null, toCelsius: null },
  'kilos': { unit: 'kg', toMeters: null, toKg: 1, toLiters: null, toCelsius: null },
  'g': { unit: 'g', toMeters: null, toKg: 0.001, toLiters: null, toCelsius: null },
  'gram': { unit: 'g', toMeters: null, toKg: 0.001, toLiters: null, toCelsius: null },
  'grams': { unit: 'g', toMeters: null, toKg: 0.001, toLiters: null, toCelsius: null },
  'lb': { unit: 'lb', toMeters: null, toKg: 0.45359237, toLiters: null, toCelsius: null },
  'lbs': { unit: 'lb', toMeters: null, toKg: 0.45359237, toLiters: null, toCelsius: null },
  'pound': { unit: 'lb', toMeters: null, toKg: 0.45359237, toLiters: null, toCelsius: null },
  'pounds': { unit: 'lb', toMeters: null, toKg: 0.45359237, toLiters: null, toCelsius: null },
  'ounce': { unit: 'oz', toMeters: null, toKg: 0.028349523125, toLiters: null, toCelsius: null },
  'ounces': { unit: 'oz', toMeters: null, toKg: 0.028349523125, toLiters: null, toCelsius: null },
  'l': { unit: 'l', toMeters: null, toKg: null, toLiters: 1, toCelsius: null },
  'liter': { unit: 'l', toMeters: null, toKg: null, toLiters: 1, toCelsius: null },
  'liters': { unit: 'l', toMeters: null, toKg: null, toLiters: 1, toCelsius: null },
  'litre': { unit: 'l', toMeters: null, toKg: null, toLiters: 1, toCelsius: null },
  'litres': { unit: 'l', toMeters: null, toKg: null, toLiters: 1, toCelsius: null },
  'gallon': { unit: 'gal', toMeters: null, toKg: null, toLiters: 3.785411784, toCelsius: null },
  'gallons': { unit: 'gal', toMeters: null, toKg: null, toLiters: 3.785411784, toCelsius: null },
  'celsius': { unit: '°C', toMeters: null, toKg: null, toLiters: null, toCelsius: 'fromF' },
  '°c': { unit: '°C', toMeters: null, toKg: null, toLiters: null, toCelsius: 'fromF' },
  'centigrade': { unit: '°C', toMeters: null, toKg: null, toLiters: null, toCelsius: 'fromF' },
  'fahrenheit': { unit: '°F', toMeters: null, toKg: null, toLiters: null, toCelsius: 'toF' },
  '°f': { unit: '°F', toMeters: null, toKg: null, toLiters: null, toCelsius: 'toF' },
};

function findUnitToken(t: string): { alias: string; unit: string } | null {
  // longest-first so "kilometers" wins over "km" overlaps etc.
  const keys = Object.keys(UNIT_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`\\b${k.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) {
      const info = UNIT_ALIASES[k];
      return { alias: k, unit: info.unit };
    }
  }
  return null;
}

function buildUnitWidget(msg: string): Extract<Widget, { type: 'unit' }> | null {
  const t = msg.toLowerCase();
  const valueMatch = t.match(/(\d+(?:\.\d+)?)\s*(?:\s|$)/);
  const value = valueMatch ? parseFloat(valueMatch[1]) : 1;
  if (value <= 0) return null;

  // "convert 5 miles to km" / "5 miles in km" / "how many feet in 2 meters"
  const first = findUnitToken(t);
  if (!first) return null;
  let second: { alias: string; unit: string } | null = null;
  const rest = t.replace(new RegExp(`(convert\\s+)?\\d+(?:\\.\\d+)?\\s*${first.alias}\\s*(to|in|into)?\\s*`, 'i'), ' ').replace(/^\s+|\s+$/g, '');
  if (rest) second = findUnitToken(rest);
  if (!second || second.unit === first.unit) return null;

  const f = UNIT_ALIASES[first.alias];
  const sInfo = UNIT_ALIASES[second.alias];
  const category = f.toMeters !== null && sInfo.toMeters !== null ? 'length'
    : f.toKg !== null && sInfo.toKg !== null ? 'weight'
    : f.toLiters !== null && sInfo.toLiters !== null ? 'volume'
    : f.toCelsius && sInfo.toCelsius ? 'temperature' : null;
  if (!category) return null;

  return {
    type: 'unit',
    value,
    fromUnit: first.unit,
    toUnit: second.unit,
    category,
    label: `${value} ${first.unit} → ${second.unit}`,
  };
}

// ─── Currency (open.er-api.com, free, no key) ───────────────────────────────

const CURRENCY_ALIASES: Record<string, string> = {
  'usd': 'USD', 'dollar': 'USD', 'dollars': 'USD', '$': 'USD',
  'eur': 'EUR', 'euro': 'EUR', 'euros': 'EUR', '€': 'EUR',
  'gbp': 'GBP', 'pound': 'GBP', 'pounds': 'GBP', 'pounds sterling': 'GBP', '£': 'GBP',
  'jpy': 'JPY', 'yen': 'JPY', '¥': 'JPY',
  'cad': 'CAD', 'aud': 'AUD', 'chf': 'CHF', 'cny': 'CNY', 'inr': 'INR', 'brl': 'BRL',
  'krw': 'KRW', 'sgd': 'SGD', 'nzd': 'NZD', 'try': 'TRY', 'sek': 'SEK', 'nok': 'NOK',
  'dkk': 'DKK', 'pln': 'PLN', 'zar': 'ZAR',
};

function findCurrencyToken(t: string): string | null {
  const keys = Object.keys(CURRENCY_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (new RegExp(`\\b${k.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) {
      return CURRENCY_ALIASES[k];
    }
  }
  return null;
}

async function fetchCurrencyWidget(msg: string): Promise<Extract<Widget, { type: 'currency' }> | null> {
  const t = msg.toLowerCase();
  const amountMatch = t.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 1;

  const first = findCurrencyToken(t);
  if (!first) return null;
  let second: string | null = null;
  const rest = t.replace(new RegExp(`(convert\\s+)?\\d+(?:\\.\\d+)?\\s*${first === 'USD' ? '(usd|dollars?|\$)' : first.toLowerCase()}\\s*(to|in|into)?\\s*`, 'i'), ' ').replace(/^\s+|\s+$/g, '');
  if (rest) second = findCurrencyToken(rest);
  if (!second || second === first) return null;

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${first}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number>; time_last_update_utc?: string };
    const rate = data.rates?.[second];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    return {
      type: 'currency',
      from: first,
      to: second,
      amount,
      rate: Math.round(rate * 1e6) / 1e6,
      updated: data.time_last_update_utc ?? '',
    };
  } catch {
    return null;
  }
}

// ─── Map (Nominatim geocode → OSM embed, free) ───────────────────────────────

async function fetchMapWidget(msg: string): Promise<Extract<Widget, { type: 'map' }> | null> {
  const m = msg.match(/(?:where is|where's|map of|location of|show me (?:a map of|the location of))\s+([a-zA-Z ,'-]{2,60})/i);
  const query = m ? m[1].trim() : null;
  if (!query) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'InfinityAssistant/1.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const hit = data[0];
    if (!hit) return null;
    return {
      type: 'map',
      query,
      lat: parseFloat(hit.lat),
      lon: parseFloat(hit.lon),
      displayName: hit.display_name,
    };
  } catch {
    return null;
  }
}

// ─── Random (dice / coin / number) ───────────────────────────────────────────

function buildRandomWidget(msg: string): Extract<Widget, { type: 'random' }> | null {
  const t = msg.toLowerCase();
  if (/\b(dice|die|roll)\b/.test(t)) {
    const d = /\b(\d+)\s*d(?:ice)?\b/.exec(t);
    const sides = d ? Math.min(100, Math.max(2, parseInt(d[1]))) : 6;
    return { type: 'random', kind: 'dice', value: Math.floor(Math.random() * sides) + 1, label: `1d${sides}` };
  }
  if (/\b(flip|coin|heads|tails)\b/.test(t)) {
    return { type: 'random', kind: 'coin', value: Math.random() < 0.5 ? 0 : 1, label: 'coin flip' };
  }
  if (/\brandom number\b|\bpick a number\b|\bnumber between\b/.test(t)) {
    const range = t.match(/between\s+(\d+)\s+and\s+(\d+)/) ?? t.match(/(\d+)\s*(?:and|-|to)\s*(\d+)/);
    if (range) {
      const lo = Math.min(parseInt(range[1]), parseInt(range[2]));
      const hi = Math.max(parseInt(range[1]), parseInt(range[2]));
      if (hi - lo <= 1_000_000) {
        return { type: 'random', kind: 'number', value: lo + Math.floor(Math.random() * (hi - lo + 1)), label: `${lo}-${hi}` };
      }
    }
    return { type: 'random', kind: 'number', value: Math.floor(Math.random() * 100) + 1, label: '1-100' };
  }
  return null;
}

// ─── Music (mood-aware composition, played client-side with Web Audio) ─────

const NOTE_SEMITONES: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'F': 5,
  'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

/** Deterministic PRNG so the same request yields the same composition. */
function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const MOODS = {
  happy: { tempo: 128, root: 'C', scale: [0, 2, 4, 5, 7, 9, 11], chords: [0, 5, 7, 9], bass: [0, 5, 7, 9], title: 'Sunshine Groove', drum: [1,0,0,0, 1,0,1,0, 0,0,1,0, 1,0,1,1] },
  chill:  { tempo: 88,  root: 'A', scale: [0, 2, 3, 5, 7, 9, 10], chords: [9, 5, 7, 0], bass: [9, 5, 7, 0], title: 'Midnight Drive', drum: [1,0,0,1, 0,0,1,0, 1,0,0,0, 0,1,1,0] },
  epic:   { tempo: 140, root: 'D', scale: [0, 2, 3, 5, 7, 8, 10], chords: [5, 0, 7, 3], bass: [5, 0, 7, 3], title: 'Rise of Heroes', drum: [1,0,0,0, 1,1,0,0, 1,0,1,0, 1,1,1,0] },
  sad:    { tempo: 72,  root: 'E', scale: [0, 2, 3, 5, 7, 8, 10], chords: [0, 8, 5, 3], bass: [0, 8, 5, 3], title: 'Rainy Window', drum: [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,1] },
};

function buildMusicWidget(msg: string): Extract<Widget, { type: 'music' }> {
  const t = msg.toLowerCase();
  let mood: MusicComposition['mood'] = 'happy';
  if (/\b(sad|melancholy|depressing|rainy|down)\b/.test(t)) mood = 'sad';
  else if (/\b(epic|heroic|intense|action|dramatic)\b/.test(t)) mood = 'epic';
  else if (/\b(chill|calm|relax|ambient|lofi|slow|sleep)\b/.test(t)) mood = 'chill';

  const cfg = MOODS[mood];
  const seed = [...msg].reduce((a, c) => a + c.charCodeAt(0), 0) || 1;
  const rnd = seededRandom(seed);

  const scale = cfg.scale;
  // 4-bar chord progression, each chord 1 bar (4 beats at 16th-note grid = 16 steps/bar)
  const chordSemis = cfg.chords;
  const chords = chordSemis.map((semi) => `${cfg.root}${semi >= 12 ? 4 : 3}`);
  const bass = cfg.bass.map((semi) => `${cfg.root}${semi >= 12 ? 3 : 2}`);

  // Melody: 4 bars x 4 beats, pick from scale, occasional rests
  const melody: MusicNote[] = [];
  let time = 0;
  for (let bar = 0; bar < 4; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      if (rnd() < 0.28) { time += 1; continue; } // rest
      const semi = scale[Math.floor(rnd() * scale.length)];
      const oct = 4 + Math.floor(rnd() * 2); // mostly octave 4/5
      melody.push({ note: `${cfg.root}${oct}`, dur: 1, time });
      time += 1;
    }
  }

  return {
    type: 'music',
    composition: {
      title: cfg.title,
      mood,
      tempo: cfg.tempo,
      root: cfg.root,
      scale,
      chords,
      bass,
      melody,
      drumPattern: cfg.drum,
    },
  };
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export async function fetchCalendarWidget(calendars: { url: string; name?: string }[]): Promise<Extract<Widget, { type: 'calendar' }> | null> {
  if (calendars.length === 0) return null;

  const allEvents: CalendarEvent[] = [];

  await Promise.all(calendars.map(async (cal) => {
    try {
      const res = await fetch(cal.url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return;
      const text = await res.text();
      const events = parseIcsStructured(text, cal.name);
      allEvents.push(...events);
    } catch { /* skip failed calendar */ }
  }));

  // Sort by start
  allEvents.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  // Week start = Monday of current week
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

  return { type: 'calendar', events: allEvents, weekStart: weekStartStr };
}

function parseIcsStructured(icsText: string, calendarName?: string): CalendarEvent[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days ahead

  const eventBlocks = icsText.split('BEGIN:VEVENT').slice(1);
  const events: CalendarEvent[] = [];

  for (const block of eventBlocks) {
    const summary = extractProp(block, 'SUMMARY');
    const dtStart = extractProp(block, 'DTSTART');
    const dtEnd   = extractProp(block, 'DTEND');
    const uid     = extractProp(block, 'UID');
    if (!summary || !dtStart) continue;

    const startParsed = parseIcsDate(dtStart);
    if (!startParsed) continue;

    const endParsed = dtEnd ? parseIcsDate(dtEnd) : null;

    // Only include events in the window
    if (startParsed.date > cutoff) continue;
    if (endParsed && endParsed.date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) continue;
    if (!endParsed && startParsed.date < new Date(now.getFullYear(), now.getMonth(), now.getDate())) continue;

    events.push({
      id: uid ?? `${summary}-${dtStart}`,
      title: summary,
      start: startParsed.date.toISOString(),
      end: endParsed?.date.toISOString(),
      allDay: startParsed.allDay,
      calendarName,
    });
  }

  return events;
}

function extractProp(block: string, name: string): string | null {
  const regex = new RegExp(`\\n${name}[^:]*:([^\\n]*)`);
  const match = block.match(regex);
  if (!match) return null;
  return match[1].trim()
    .replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseIcsDate(value: string): { date: Date; allDay: boolean } | null {
  if (/^\d{8}$/.test(value)) {
    return { date: new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, min, s, z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${min}:${s}${z === 'Z' ? 'Z' : ''}`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return { date, allDay: false };
}

// ─── Google Calendar (via API) ───────────────────────────────────────────────

async function fetchGoogleCalendarWidget(): Promise<Extract<Widget, { type: 'calendar' }> | null> {
  try {
    const { fetchAllGoogleCalendars } = await import("./google-calendar");
    const events = await fetchAllGoogleCalendars();
    if (events.length === 0) return null;

    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;

    // Map to CalendarEvent format
    const calEvents: CalendarEvent[] = events.map(e => ({
      id: e.id,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      calendarName: e.calendarName,
    }));

    return { type: 'calendar', events: calEvents, weekStart: weekStartStr };
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function detectAndBuildWidget(
  userMessage: string,
  settings: Record<string, string>,
): Promise<Widget | null> {
  let intent = detectIntent(userMessage);
  if (!intent) {
    // Regex missed, let the LLM take one cheap shot before giving up. This is
    // time-boxed and failure-safe: `null` on any error/cooldown/timeout.
    intent = await detectWidgetIntentWithLLM(userMessage);
  }
  if (!intent) return null;

  switch (intent) {
    case 'clock':
      return buildClockWidget(userMessage, settings);

    case 'weather': {
      const location = extractWeatherLocation(userMessage, settings['weather_location'] ?? 'London');
      return await fetchWeatherWidget(location);
    }

    case 'timer': {
      return parseTimerWidget(userMessage);
    }

    case 'timer_edit': {
      return parseTimerEditWidget(userMessage);
    }

    case 'timer_cancel': {
      return { type: 'timer', durationSeconds: 0, timerAction: 'cancel' };
    }

    case 'alarm': {
      return parseAlarmWidget(userMessage);
    }

    case 'calendar': {
      // Try Google Calendar API first (if Gmail/Calendar is connected)
      if (settings['google_calendar_enabled'] !== 'false') {
        const gcal = await fetchGoogleCalendarWidget();
        if (gcal) return gcal;
      }
      // Fallback: iCal URLs
      const calendars: { url: string; name?: string }[] = [1, 2, 3, 4, 5]
        .map(n => ({ url: settings[`calendar_ics_url_${n}`], name: settings[`calendar_name_${n}`] || undefined }))
        .filter(c => c.url) as { url: string; name?: string }[];
      return await fetchCalendarWidget(calendars);
    }

    case 'images': {
      return await fetchImagesWidget(userMessage);
    }

    case 'date': {
      return buildDateWidget();
    }

    case 'calculator': {
      return buildCalculatorWidget(userMessage);
    }

    case 'define': {
      return await fetchDefineWidget(userMessage);
    }

    case 'unit': {
      return buildUnitWidget(userMessage);
    }

    case 'currency': {
      return await fetchCurrencyWidget(userMessage);
    }

    case 'map': {
      return await fetchMapWidget(userMessage);
    }

    case 'random': {
      return buildRandomWidget(userMessage);
    }

    case 'music': {
      return buildMusicWidget(userMessage);
    }

  }
}
