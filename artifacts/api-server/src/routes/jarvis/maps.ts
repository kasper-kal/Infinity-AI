import { Router, Request, Response } from "express";
import { randomUUID } from "node:crypto";

const router = Router();

// In-memory cache for places data (TTL: 5 minutes)
const placesCache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Overpass API endpoint (free, no key required)
const OVERPASS_API = "https://overpass-api.de/api/interpreter";
// Nominatim endpoint for geocoding (free, no key required)
const NOMINATIM_API = "https://nominatim.openstreetmap.org";

// Rate limiting for external API calls
const apiRateLimit = new Map<string, { count: number; resetAt: number }>();
const API_RATE_LIMIT_WINDOW = 60_000; // 1 minute
const API_RATE_LIMIT_MAX = 30; // 30 requests per minute per IP

function checkApiRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = apiRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    apiRateLimit.set(ip, { count: 1, resetAt: now + API_RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= API_RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function getCacheKey(lat: number, lon: number, radius: number, categories: string[]): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${radius},${categories.sort().join(",")}`;
}

function getCachedPlaces(key: string): any | null {
  const entry = placesCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    placesCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedPlaces(key: string, data: any): void {
  placesCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Category mapping for Overpass queries
const CATEGORY_TAGS: Record<string, string[]> = {
  food: ["amenity=restaurant", "amenity=cafe", "amenity=fast_food", "amenity=food_court"],
  coffee: ["amenity=cafe"],
  bar: ["amenity=bar", "amenity=pub"],
  attractions: ["tourism=attraction", "tourism=museum", "tourism=artwork"],
  park: ["leisure=park", "leisure=garden", "leisure=nature_reserve"],
  shopping: ["shop=mall", "shop=department_store", "shop=supermarket"],
  hotel: ["tourism=hotel", "tourism=hostel", "tourism=guest_house"],
  pharmacy: ["amenity=pharmacy"],
  atm: ["amenity=atm"],
  bank: ["amenity=bank"],
  fuel: ["amenity=fuel"],
  charging: ["amenity=charging_station"],
};

function buildOverpassQuery(lat: number, lon: number, radiusMeters: number, categories: string[]): string {
  const tags = categories.flatMap((cat) => CATEGORY_TAGS[cat] ?? []);
  if (tags.length === 0) {
    // Default to food if no categories specified
    tags.push(...CATEGORY_TAGS.food);
  }

  const tagFilters = tags.map((t) => `[${t}]`).join("");
  return `
    [out:json][timeout:25];
    (
      node${tagFilters}(around:${radiusMeters},${lat},${lon});
      way${tagFilters}(around:${radiusMeters},${lat},${lon});
      relation${tagFilters}(around:${radiusMeters},${lat},${lon});
    );
    out center tags;
  `;
}

async function fetchOverpassPlaces(lat: number, lon: number, radiusMeters: number, categories: string[]): Promise<any[]> {
  const query = buildOverpassQuery(lat, lon, radiusMeters, categories);

  try {
    const res = await fetch(OVERPASS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "InfinityAI/1.0",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      throw new Error(`Overpass API error: ${res.status}`);
    }

    const data = await res.json() as { elements: any[] };
    return data.elements ?? [];
  } catch (err) {
    console.error("[Maps] Overpass fetch failed:", err);
    throw err;
  }
}

async function geocodeLocation(query: string): Promise<{ lat: number; lon: number; displayName: string } | null> {
  try {
    const res = await fetch(`${NOMINATIM_API}/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
      headers: { "User-Agent": "InfinityAI/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const data = await res.json() as Array<{ lat: string; lon: string; display_name: string }>;
    const hit = data[0];
    if (!hit) return null;

    return {
      lat: parseFloat(hit.lat),
      lon: parseFloat(hit.lon),
      displayName: hit.display_name,
    };
  } catch (err) {
    console.error("[Maps] Geocoding failed:", err);
    return null;
  }
}

async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`${NOMINATIM_API}/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { "User-Agent": "InfinityAI/1.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const data = await res.json() as { display_name?: string };
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

function formatPlaces(elements: any[]): any[] {
  const places: any[] = [];

  for (const el of elements) {
    if (!el.tags || !el.tags.name) continue;

    let lat: number, lon: number;
    if (el.type === "node") {
      lat = el.lat;
      lon = el.lon;
    } else if (el.center) {
      lat = el.center.lat;
      lon = el.center.lon;
    } else {
      continue;
    }

    const tags = el.tags;
    let category = "other";

    if (tags.amenity === "restaurant" || tags.amenity === "fast_food" || tags.amenity === "food_court") category = "food";
    else if (tags.amenity === "cafe") category = "coffee";
    else if (tags.amenity === "bar" || tags.amenity === "pub") category = "bar";
    else if (tags.tourism === "attraction" || tags.tourism === "museum" || tags.tourism === "artwork") category = "attractions";
    else if (tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "nature_reserve") category = "park";
    else if (tags.shop === "mall" || tags.shop === "department_store" || tags.shop === "supermarket") category = "shopping";
    else if (tags.tourism === "hotel" || tags.tourism === "hostel" || tags.tourism === "guest_house") category = "hotel";
    else if (tags.amenity === "pharmacy") category = "pharmacy";
    else if (tags.amenity === "atm") category = "atm";
    else if (tags.amenity === "bank") category = "bank";
    else if (tags.amenity === "fuel") category = "fuel";
    else if (tags.amenity === "charging_station") category = "charging";

    // Calculate distance (approximate, using simple formula)
    // We don't have user location here, so we'll calculate on frontend

    places.push({
      id: `${el.type}/${el.id}`,
      name: tags.name,
      category,
      lat,
      lon,
      address: [
        tags["addr:housenumber"],
        tags["addr:street"],
        tags["addr:city"],
        tags["addr:postcode"],
      ].filter(Boolean).join(", ") || undefined,
      phone: tags.phone ?? tags["contact:phone"],
      website: tags.website ?? tags["contact:website"],
      openingHours: tags.opening_hours,
      cuisine: tags.cuisine,
      rating: undefined, // Overpass doesn't provide ratings
      wheelchair: tags.wheelchair,
      outdoorSeating: tags.outdoor_seating,
      takeaway: tags.takeaway,
      delivery: tags.delivery,
    });
  }

  // Deduplicate by name + location (approximate)
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.name.toLowerCase()}_${p.lat.toFixed(4)}_${p.lon.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 100); // Limit to 100 places
}

/**
 * Detect @Maps command or natural language location queries
 * @Maps <query> - explicit command
 * Natural language: "where should I eat", "find coffee near me", "pizza places nearby"
 */
function detectMapsCommand(text: string): { isMaps: boolean; query: string; lat?: number; lon?: number; radius?: number; categories?: string[] } {
  const trimmed = text.trim();

  // Explicit @Maps command
  const explicitMatch = trimmed.match(/^@Maps\s+(.+)$/i);
  if (explicitMatch) {
    return { isMaps: true, query: explicitMatch[1].trim() };
  }

  // Natural language patterns for location-based queries
  const t = trimmed.toLowerCase();

  const patterns = [
    // "where should I eat", "where to eat", "where can I eat"
    /\bwhere\s+(should|can|to)\s+(i|we)\s+eat\b/i,
    // "find coffee near me", "coffee near me", "cafes nearby"
    /\bfind\s+(coffee|cafe|food|restaurant|pizza|burger|sushi|ramen|pho|tacos)\s+(near|around|close\s+to)\s+(me|here|my\s+location)\b/i,
    /\b(coffee|cafe|food|restaurant|pizza|burger|sushi|ramen|pho|tacos)\s+(near|around|close\s+to)\s+(me|here|my\s+location)\b/i,
    // "pizza places nearby", "restaurants nearby", "bars near me"
    /\b(pizza|coffee|cafe|restaurant|bar|pub|food)\s+(places?|spots?)\s+(nearby|near\s+me)\b/i,
    // "I'm craving X", "craving X"
    /\b(i'?m|craving)\s+(pizza|coffee|burger|sushi|ramen|pho|tacos|chinese|italian|mexican|indian|thai)\b/i,
    // "where is the nearest X"
    /\bwhere\s+is\s+(the\s+)?(nearest|closest)\s+(coffee|cafe|restaurant|pizza|bar|atm|pharmacy|gas\s+station|charging)\b/i,
    // "show me X on map", "map of X near me"
    /\b(show|find)\s+me\s+(coffee|cafe|food|restaurant|pizza|bar)\s+on\s+(map|the\s+map)\b/i,
    /\bmap\s+of\s+(coffee|cafe|food|restaurant|pizza|bar)\s+(near|around)\s+(me|here)\b/i,
  ];

  for (const pattern of patterns) {
    if (pattern.test(t)) {
      return { isMaps: true, query: trimmed };
    }
  }

  return { isMaps: false, query: "" };
}

/**
 * Extract location intent and parameters from natural language
 */
function parseLocationQuery(query: string): { query: string; radius: number; categories: string[] } {
  const t = query.toLowerCase();
  let radius = 2000; // Default 2km
  let categories = ["food"]; // Default to food

  // Radius extraction
  const radiusMatch = t.match(/(\d+(?:\.\d+)?)\s*(km|kilometers?|m|meters?|mi|miles?)\b/);
  if (radiusMatch) {
    const value = parseFloat(radiusMatch[1]);
    const unit = radiusMatch[2];
    if (unit.startsWith("km")) radius = Math.round(value * 1000);
    else if (unit.startsWith("m") && !unit.startsWith("mi")) radius = Math.round(value);
    else if (unit.startsWith("mi")) radius = Math.round(value * 1609);
  } else if (t.includes("nearby") || t.includes("near me") || t.includes("close")) {
    radius = 1500; // 1.5km for "nearby"
  } else if (t.includes("walking distance") || t.includes("walk to")) {
    radius = 800; // 800m for walking
  } else if (t.includes("driving distance") || t.includes("drive to")) {
    radius = 5000; // 5km for driving
  }

  // Category extraction
  const categoryKeywords: Record<string, string[]> = {
    food: ["food", "restaurant", "eat", "dinner", "lunch", "meal"],
    coffee: ["coffee", "cafe", "espresso", "cappuccino", "latte"],
    pizza: ["pizza"],
    burger: ["burger", "hamburger"],
    sushi: ["sushi", "japanese"],
    ramen: ["ramen"],
    pho: ["pho", "vietnamese"],
    tacos: ["tacos", "mexican"],
    chinese: ["chinese"],
    italian: ["italian"],
    indian: ["indian"],
    thai: ["thai"],
    bar: ["bar", "pub", "drink", "cocktail", "beer", "wine"],
    attractions: ["attraction", "museum", "sightseeing", "landmark", "tourist"],
    park: ["park", "garden", "nature", "hike", "trail"],
    shopping: ["shop", "mall", "store", "market"],
    hotel: ["hotel", "hostel", "accommodation", "stay"],
    pharmacy: ["pharmacy", "drugstore", "medicine"],
    atm: ["atm", "cash", "money"],
    fuel: ["gas", "fuel", "petrol", "station"],
    charging: ["charging", "ev charging", "electric"],
  };

  const foundCategories = new Set<string>();
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    for (const kw of keywords) {
      if (t.includes(kw)) {
        foundCategories.add(cat);
      }
    }
  }

  // Map specific food types to broader categories
  if (foundCategories.has("pizza") || foundCategories.has("burger") ||
      foundCategories.has("sushi") || foundCategories.has("ramen") ||
      foundCategories.has("pho") || foundCategories.has("tacos") ||
      foundCategories.has("chinese") || foundCategories.has("italian") ||
      foundCategories.has("indian") || foundCategories.has("thai")) {
    foundCategories.add("food");
  }

  if (foundCategories.size > 0) {
    categories = Array.from(foundCategories);
  }

  // Clean up the query for display
  let displayQuery = query
    .replace(/^@maps\s+/i, "")
    .replace(/^(where\s+(should|can|to)\s+(i|we)\s+eat|find\s+(me\s+)?|show\s+me\s+|i'?m\s+craving\s+|craving\s+)/i, "")
    .trim();

  if (!displayQuery) displayQuery = "nearby places";

  return { query: displayQuery, radius, categories };
}

/**
 * GET /api/jarvis/maps/search
 * Search for places near a location
 */
router.get("/search", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

  if (!checkApiRateLimit(clientIp)) {
    return res.status(429).json({ error: "Too many requests, slow down" });
  }

  const { lat, lon, radius = "2000", categories = "food", q } = req.query as {
    lat?: string;
    lon?: string;
    radius?: string;
    categories?: string;
    q?: string;
  };

  // If query provided, geocode it first
  let searchLat: number, searchLon: number, displayName: string;

  if (q) {
    const geo = await geocodeLocation(q);
    if (!geo) {
      return res.status(404).json({ error: "Location not found" });
    }
    searchLat = geo.lat;
    searchLon = geo.lon;
    displayName = geo.displayName;
  } else if (lat && lon) {
    searchLat = parseFloat(lat);
    searchLon = parseFloat(lon);
    const reverse = await reverseGeocode(searchLat, searchLon);
    displayName = reverse ?? `${searchLat.toFixed(4)}, ${searchLon.toFixed(4)}`;
  } else {
    return res.status(400).json({ error: "Either 'q' (query) or 'lat'/'lon' required" });
  }

  const radiusMeters = Math.min(Math.max(parseInt(radius) || 2000, 100), 10000); // 100m - 10km
  const categoryList = categories.split(",").map(c => c.trim()).filter(Boolean);

  const cacheKey = getCacheKey(searchLat, searchLon, radiusMeters, categoryList);
  const cached = getCachedPlaces(cacheKey);

  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  try {
    const elements = await fetchOverpassPlaces(searchLat, searchLon, radiusMeters, categoryList);
    const places = formatPlaces(elements);

    const result = {
      center: { lat: searchLat, lon: searchLon },
      displayName,
      radius: radiusMeters,
      categories: categoryList,
      places,
      count: places.length,
    };

    setCachedPlaces(cacheKey, result);
    return res.json({ ...result, cached: false });
  } catch (err) {
    console.error("[Maps] Search failed:", err);
    return res.status(500).json({ error: "Failed to search places" });
  }
});

/**
 * GET /api/jarvis/maps/geocode
 * Geocode a location query
 */
router.get("/geocode", async (req: Request, res: Response) => {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

  if (!checkApiRateLimit(clientIp)) {
    return res.status(429).json({ error: "Too many requests, slow down" });
  }

  const { q } = req.query as { q?: string };

  if (!q) {
    return res.status(400).json({ error: "Query parameter 'q' required" });
  }

  const result = await geocodeLocation(q);

  if (!result) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json(result);
});

/**
 * POST /api/jarvis/maps/detect
 * Detect if a message should trigger the maps widget and return widget config
 * Used by chat.ts to determine if maps widget should be emitted
 */
router.post("/detect", async (req: Request, res: Response) => {
  const { message, userLat, userLon } = req.body as {
    message: string;
    userLat?: number;
    userLon?: number;
  };

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }

  const detection = detectMapsCommand(message);

  if (!detection.isMaps) {
    return res.json({ shouldTrigger: false });
  }

  const { query, radius, categories } = parseLocationQuery(detection.query);

  // Determine center: user location > geocoded query > default
  let centerLat: number, centerLon: number, displayName: string;

  if (userLat !== undefined && userLon !== undefined) {
    centerLat = userLat;
    centerLon = userLon;
    const reverse = await reverseGeocode(centerLat, centerLon);
    displayName = reverse ?? "Your location";
  } else if (detection.lat !== undefined && detection.lon !== undefined) {
    centerLat = detection.lat;
    centerLon = detection.lon;
    displayName = detection.query;
  } else {
    // Try to geocode the query for a center point
    const geo = await geocodeLocation(query);
    if (geo) {
      centerLat = geo.lat;
      centerLon = geo.lon;
      displayName = geo.displayName;
    } else {
      // Fallback: use a default location (will be overridden by browser geolocation on frontend)
      centerLat = 0;
      centerLon = 0;
      displayName = query;
    }
  }

  // Generate a request ID for tracking
  const requestId = randomUUID();

  return res.json({
    shouldTrigger: true,
    requestId,
    widget: {
      type: "maps",
      center: { lat: centerLat, lon: centerLon },
      displayName,
      radius,
      categories,
      query,
      useUserLocation: userLat === undefined && userLon === undefined,
    },
  });
});

export default router;