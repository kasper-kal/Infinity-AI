/**
 * Open-Meteo weather helpers — completely free, no API key required.
 * Shared by the widget layer (widget-detector) and live context (live-context).
 *
 * Geocoding: https://geocoding-api.open-meteo.com (location name -> lat/lon)
 * Forecast:  https://api.open-meteo.com
 */

const USER_AGENT = "InfinityAssistant/1.0";

/** WMO weather codes -> human-readable condition (Open-Meteo "weather_code"). */
export const WMO_CONDITIONS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Icy fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Rain showers",
  82: "Heavy rain showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail",
};

/**
 * Map a WMO weather code to the legacy wttr.in-style condition code that the
 * WeatherWidget icon renderer already understands, so the widget UI stays
 * unchanged:
 *   113 clear, 116 partly cloudy, 119 overcast, 143 fog,
 *   266 drizzle, 302 rain, 323 snow, 356 rain showers,
 *   374 snow showers, 395 thunderstorm
 */
export function wmoToWidgetCode(code: number): number {
  if (code === 0) return 113;
  if (code === 1 || code === 2) return 116;
  if (code === 3) return 119;
  if (code === 45 || code === 48) return 143;
  if (code >= 51 && code <= 57) return 266; // drizzle
  if (code >= 61 && code <= 67) return 302; // rain / freezing rain
  if (code >= 71 && code <= 77) return 323; // snow / snow grains
  if (code >= 80 && code <= 82) return 356; // rain showers
  if (code === 85 || code === 86) return 374; // snow showers
  if (code >= 95 && code <= 99) return 395; // thunderstorm
  return 113;
}

/** Wind direction in degrees -> 16-point compass string. */
export function degreesToCompass(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
}

/** Resolve a free-form location name to coordinates via Open-Meteo geocoding. */
export async function geocodeLocation(
  location: string,
  timeoutMs = 5000,
): Promise<GeocodeResult | null> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ name?: string; latitude?: number; longitude?: number }>;
    };
    const hit = data.results?.[0];
    if (!hit || typeof hit.latitude !== "number" || typeof hit.longitude !== "number") return null;
    return { name: hit.name || location, latitude: hit.latitude, longitude: hit.longitude };
  } catch {
    return null;
  }
}

export interface OpenMeteoCurrent {
  temperature_2m?: number;
  relative_humidity_2m?: number;
  apparent_temperature?: number;
  is_day?: number;
  weather_code?: number;
  wind_speed_10m?: number;
  wind_direction_10m?: number;
}

export interface OpenMeteoDaily {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
}

export interface OpenMeteoForecast {
  current?: OpenMeteoCurrent;
  daily?: OpenMeteoDaily;
}

/**
 * Fetch current conditions + a 5-day daily forecast for coordinates.
 * Free, no API key. Returns null on any failure.
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  timeoutMs = 5000,
): Promise<OpenMeteoForecast | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as OpenMeteoForecast;
  } catch {
    return null;
  }
}

/** Human condition string for a WMO code (falls back to "Unknown"). */
export function wmoCondition(code: number | undefined): string {
  return code === undefined ? "" : WMO_CONDITIONS[code] ?? "";
}
