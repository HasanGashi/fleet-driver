import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export interface TruckProfile {
  height: number;
  width: number;
  length: number;
  weight: number;
  axleCount: number;
}

export interface RouteResult {
  polyline: { lat: number; lon: number }[];
  distanceMeters: number;
  durationSeconds: number;
}

const DEFAULT_TRUCK: TruckProfile = Constants.expoConfig?.extra?.truck ?? {
  height: 300, // cm — 3m, typical rigid box truck
  width: 220, // cm — 2.2m
  length: 750, // cm — 7.5m
  weight: 7500, // kg — 7.5 tonne GVW
  axleCount: 2,
};

function getHereApiKey(): string {
  return Constants.expoConfig?.extra?.hereApiKey ?? "";
}

// ─── In-memory caches (live for the app session) ────────────────────────────
// Keyed by the raw address string. Means identical addresses across different
// orders are never geocoded more than once per session.
const geocodeCache = new Map<
  string,
  { lat: number; lon: number; title: string }
>();

// Keyed by "pickupLat,pickupLon->destLat,destLon" so the same origin/dest pair
// is never routed more than once per session.
const routeCache = new Map<string, RouteResult>();

// ─── DB-backed route cache helpers ──────────────────────────────────────────

/** Round coordinate to 4 decimal places (~11 m) for stable DB key matching. */
function roundCoord(v: number): number {
  return Math.round(v * 10000) / 10000;
}

async function fetchRouteFromDB(
  oLat: number,
  oLon: number,
  dLat: number,
  dLon: number,
): Promise<RouteResult | null> {
  const { data, error } = await supabase
    .from("route_cache")
    .select("distance_m, duration_s, polyline")
    .eq("origin_lat", roundCoord(oLat))
    .eq("origin_lon", roundCoord(oLon))
    .eq("dest_lat", roundCoord(dLat))
    .eq("dest_lon", roundCoord(dLon))
    .maybeSingle();

  if (error || !data) return null;
  return {
    distanceMeters: data.distance_m as number,
    durationSeconds: data.duration_s as number,
    polyline: data.polyline as { lat: number; lon: number }[],
  };
}

function saveRouteToDB(
  oLat: number,
  oLon: number,
  dLat: number,
  dLon: number,
  route: RouteResult,
): void {
  supabase
    .from("route_cache")
    .upsert(
      {
        origin_lat: roundCoord(oLat),
        origin_lon: roundCoord(oLon),
        dest_lat: roundCoord(dLat),
        dest_lon: roundCoord(dLon),
        distance_m: route.distanceMeters,
        duration_s: route.durationSeconds,
        polyline: route.polyline,
      },
      { onConflict: "origin_lat,origin_lon,dest_lat,dest_lon" },
    )
    .then(({ error }) => {
      if (error) console.error("[route_cache] DB save failed:", error.message);
      else console.log("[route_cache] saved to DB");
    });
}

/**
 * Geocodes a free-text address to {lat, lon} using HERE Geocoding API.
 * Returns null if geocoding fails.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lon: number; title: string } | null> {
  const cached = geocodeCache.get(address);
  if (cached) {
    console.log("[geocodeAddress] cache hit:", address);
    return cached;
  }

  const apiKey = getHereApiKey();
  if (!apiKey) return null;

  const url = `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(address)}&in=countryCode:ITA&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.error(`[geocodeAddress] HTTP ${res.status}:`, body);
    return null;
  }

  const json = await res.json();
  const item = json?.items?.[0];
  if (!item) {
    console.error("[geocodeAddress] No results for:", address);
    return null;
  }

  const result = {
    lat: item.position.lat,
    lon: item.position.lng,
    title: item.title as string,
  };
  geocodeCache.set(address, result);
  return result;
}

/**
 * Decodes a HERE flexible-polyline encoded string into an array of {lat, lon}.
 * Implements the HERE flexible polyline algorithm (precision 5).
 */
function decodeFlexiblePolyline(
  encoded: string,
): { lat: number; lon: number }[] {
  // Header: first two chars encode precision and type
  const FORMAT_VERSION = 1;
  let idx = 0;

  function decodeHeader(): { precision: number } {
    // First varint: version
    const version = decodeUnsignedVarint();
    if (version !== FORMAT_VERSION) throw new Error("Invalid FP version");
    // Second varint: lower 4 bits = lat/lng precision, upper bits = 3D type (ignored for 2D)
    const header2 = decodeUnsignedVarint();
    const precision = header2 & 0x0f;
    return { precision };
  }

  function decodeChar(c: string): number {
    const charCode = c.charCodeAt(0);
    if (charCode >= 65 && charCode <= 90) return charCode - 65; // A-Z
    if (charCode >= 97 && charCode <= 122) return charCode - 97 + 26; // a-z
    if (charCode >= 48 && charCode <= 57) return charCode - 48 + 52; // 0-9
    if (c === "-") return 62;
    if (c === "_") return 63;
    throw new Error("Invalid char: " + c);
  }

  function decodeUnsignedVarint(): number {
    let result = 0;
    let shift = 0;
    let bitCombined: number;
    do {
      bitCombined = decodeChar(encoded[idx++]);
      result |= (bitCombined & 0x1f) << shift;
      shift += 5;
    } while (bitCombined >= 0x20);
    return result;
  }

  function decodeSignedVarint(): number {
    const value = decodeUnsignedVarint();
    // zig-zag decode
    return value & 1 ? ~(value >> 1) : value >> 1;
  }

  const { precision } = decodeHeader();
  const multiplier = Math.pow(10, precision);

  const coords: { lat: number; lon: number }[] = [];
  let lat = 0;
  let lon = 0;

  while (idx < encoded.length) {
    lat += decodeSignedVarint();
    lon += decodeSignedVarint();
    coords.push({ lat: lat / multiplier, lon: lon / multiplier });
  }

  return coords;
}

/**
 * Fetches a truck-safe route from HERE Routing API v8.
 * Returns polyline coordinates, total distance (m) and duration (s).
 */
export async function fetchTruckRoute(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  truck: TruckProfile = DEFAULT_TRUCK,
): Promise<RouteResult | null> {
  const apiKey = getHereApiKey();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    transportMode: "truck",
    origin: `${originLat},${originLon}`,
    destination: `${destLat},${destLon}`,
    "vehicle[height]": String(truck.height),
    "vehicle[width]": String(truck.width),
    "vehicle[length]": String(truck.length),
    "vehicle[grossWeight]": String(truck.weight),
    "vehicle[axleCount]": String(truck.axleCount),
    return: "polyline,summary",
    apiKey,
  });

  const url = `https://router.hereapi.com/v8/routes?${params.toString()}`;
  const cacheKey = `${originLat},${originLon}->${destLat},${destLon}`;

  // 1. In-memory cache (fastest — same session)
  const cached = routeCache.get(cacheKey);
  if (cached) {
    console.log("[fetchTruckRoute] memory cache hit:", cacheKey);
    return cached;
  }

  // 2. DB cache (survives app restarts & shared across orders)
  const dbResult = await fetchRouteFromDB(
    originLat,
    originLon,
    destLat,
    destLon,
  );
  if (dbResult) {
    console.log("[fetchTruckRoute] DB cache hit:", cacheKey);
    routeCache.set(cacheKey, dbResult); // warm in-memory cache for this session
    return dbResult;
  }

  // 3. HERE API (last resort — costs money)
  console.log(
    `[fetchTruckRoute] HERE API call origin=(${originLat},${originLon}) dest=(${destLat},${destLon})`,
  );
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.error(`[fetchTruckRoute] HTTP ${res.status}:`, body);
    return null;
  }

  const json = await res.json();
  const section = json?.routes?.[0]?.sections?.[0];
  if (!section) {
    console.error(
      "[fetchTruckRoute] No section in response:",
      JSON.stringify(json),
    );
    return null;
  }

  const polyline = decodeFlexiblePolyline(section.polyline);
  const distanceMeters: number = section.summary?.length ?? 0;
  const durationSeconds: number = section.summary?.duration ?? 0;

  const routeResult: RouteResult = {
    polyline,
    distanceMeters,
    durationSeconds,
  };
  routeCache.set(cacheKey, routeResult); // in-memory
  saveRouteToDB(originLat, originLon, destLat, destLon, routeResult); // DB (fire-and-forget)
  return routeResult;
}

/**
 * Deep-links into Sygic Truck or TomTom GO Truck.
 * Falls back to Google Maps if neither app is installed.
 */
export async function openTruckNav(
  lat: number,
  lon: number,
  app: "sygic" | "tomtom",
): Promise<void> {
  // Sygic Truck: same deep-link scheme on both platforms
  // TomTom GO Truck: different scheme per platform
  const urls: Record<"sygic" | "tomtom", string> = {
    sygic: `com.sygic.aura://coordinate|${lon}|${lat}|drive`,
    tomtom:
      Platform.OS === "ios"
        ? `tomtomgo://navigate?lat=${lat}&lon=${lon}`
        : `tomtomgotruckandroid://navigate?lat=${lat}&lon=${lon}`,
  };
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
  try {
    await Linking.openURL(urls[app]);
  } catch {
    // App not installed or intent not resolved — fall back to Google Maps
    await Linking.openURL(fallback);
  }
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(0)} km`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return `${h}h ${m}min`;
}
