import * as Linking from "expo-linking";
import Constants from "expo-constants";
import { Platform } from "react-native";

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

/**
 * Geocodes a free-text address to {lat, lon} using HERE Geocoding API.
 * Returns null if geocoding fails.
 */
export async function geocodeAddress(
  address: string,
): Promise<{ lat: number; lon: number; title: string } | null> {
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

  return {
    lat: item.position.lat,
    lon: item.position.lng,
    title: item.title as string,
  };
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
  console.log(
    `[fetchTruckRoute] origin=(${originLat},${originLon}) dest=(${destLat},${destLon})`,
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

  return { polyline, distanceMeters, durationSeconds };
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
