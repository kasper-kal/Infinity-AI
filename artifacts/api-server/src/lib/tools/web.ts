/**
 * Phase 22: Universal Tool Layer — Web Capability Integration
 *
 * Registers web-search and weather tools as universal registry capabilities.
 * These wrap existing implementations (Tavily in chat.ts, Open-Meteo in open-meteo.ts).
 */

import { registerTool } from "../tool-registry";
import { logger } from "../logger";
import { geocodeLocation, fetchOpenMeteoForecast, wmoCondition, degreesToCompass } from "../open-meteo";
import type { UniversalToolDefinition, ToolExecutionContext, UniversalToolResult } from "../tool-types";

/**
 * Web search via Tavily API (free tier).
 */
async function searchWeb(query: string, maxResults = 5): Promise<UniversalToolResult> {
  const apiKey = process.env["TAVILY_API_KEY"] ?? process.env["WEB_SEARCH_API_KEY"];
  if (!apiKey) {
    return { success: false, error: "No web search API key configured (TAVILY_API_KEY or WEB_SEARCH_API_KEY)." };
  }
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: true,
        max_results: Math.min(maxResults, 20),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { success: false, error: `Web search API returned ${res.status}` };
    }
    const data = (await res.json()) as {
      answer?: string;
      results?: { title: string; url: string; content: string }[];
    };
    if (!data.results || data.results.length === 0) {
      return { success: true, data: { query, answer: null, results: [] }, summary: `No results for "${query}"` };
    }
    const sources = data.results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
    }));
    return {
      success: true,
      data: { query, answer: data.answer ?? null, results: sources },
      summary: `Found ${sources.length} results for "${query}"`,
      artifacts: [{ type: "web_search", title: `Search: ${query}`, data: { query, sources } }],
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Web search failed" };
  }
}

/**
 * Weather forecast via Open-Meteo (free, no key).
 */
async function getWeather(location: string): Promise<UniversalToolResult> {
  try {
    const geo = await geocodeLocation(location, 5000);
    if (!geo) {
      return { success: false, error: `Could not geocode location: ${location}` };
    }
    const forecast = await fetchOpenMeteoForecast(geo.latitude, geo.longitude, 5000);
    if (!forecast) {
      return { success: false, error: `Could not fetch forecast for ${location}` };
    }
    const current = forecast.current;
    const daily = forecast.daily;
    const result = {
      location: geo.name,
      latitude: geo.latitude,
      longitude: geo.longitude,
      current: current
        ? {
            temperature: current.temperature_2m,
            apparentTemperature: current.apparent_temperature,
            condition: wmoCondition(current.weather_code),
            humidity: current.relative_humidity_2m,
            windSpeed: current.wind_speed_10m,
            windDirection: current.wind_direction_10m != null ? degreesToCompass(current.wind_direction_10m) : undefined,
            isDay: current.is_day === 1,
          }
        : null,
      daily: daily
        ? daily.time.map((t, i) => ({
            date: t,
            condition: wmoCondition(daily.weather_code[i]),
            tempMax: daily.temperature_2m_max[i],
            tempMin: daily.temperature_2m_min[i],
          }))
        : [],
    };
    return {
      success: true,
      data: result,
      summary: `Weather for ${geo.name}: ${result.current?.condition ?? "unknown"}, ${result.current?.temperature ?? "?"}°C`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Weather fetch failed" };
  }
}

export function registerWebTools(): void {
  const webSearch: UniversalToolDefinition = {
    name: "web.search",
    description: "Search the web for real-time information via Tavily. Returns sources with titles, URLs, and snippets. Use for current events, facts, recent info.",
    category: "web",
    risk: "READ",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        maxResults: { type: "number", description: "Max results (1-20, default 5)" },
      },
      required: ["query"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const query = String(args["query"] ?? "").trim();
      if (!query) return { success: false, error: "query is required" };
      return searchWeb(query, typeof args["maxResults"] === "number" ? args["maxResults"] : 5);
    },
  };

  const weather: UniversalToolDefinition = {
    name: "web.weather",
    description: "Get current weather and a 5-day forecast for any location via Open-Meteo (free, no key).",
    category: "web",
    risk: "READ",
    parameters: {
      type: "object",
      properties: { location: { type: "string", description: "City name or location" } },
      required: ["location"],
    },
    timeoutMs: 10000,
    execute: async (args, _ctx: ToolExecutionContext): Promise<UniversalToolResult> => {
      const location = String(args["location"] ?? "").trim();
      if (!location) return { success: false, error: "location is required" };
      return getWeather(location);
    },
  };

  registerTool(webSearch);
  registerTool(weather);
  logger.info("[tools/web] Registered web.search, web.weather");
}
