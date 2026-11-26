// Weather & sky conditions for trail-cam photos, looked up in bulk.
import type { Camera, Sighting, SightingConditions } from './data/types';
import { cachedHistory, conditionsAt } from './history';
import { HOUR } from './time';
import { compass } from './weather';

type LatLon = { lat: number; lon: number };

export function sightingLocation(s: Sighting, cameras: Camera[], fallback: LatLon | null): LatLon | null {
  const cam = cameras.find((c) => c.id === s.camera_id);
  return cam?.lat != null && cam.lon != null ? { lat: cam.lat, lon: cam.lon } : fallback;
}

/**
 * Look up the weather at the moment each photo was taken. Photos are grouped by location
 * so each camera area needs only one or two weather requests, however many photos it has.
 * Returns the sightings that gained conditions (callers save them).
 */
export async function fillConditions(
  sightings: Sighting[],
  cameras: Camera[],
  fallback: LatLon | null,
  onProgress?: (done: number, total: number) => void,
  now = Date.now(),
): Promise<{ updated: Sighting[]; missing: number }> {
  const todo = sightings.filter((s) => !s.weather && Date.parse(s.taken_at) < now - HOUR);
  const groups = new Map<string, { loc: LatLon; items: Sighting[] }>();
  let missing = 0;
  for (const s of todo) {
    const loc = sightingLocation(s, cameras, fallback);
    if (!loc) {
      missing++;
      continue;
    }
    const key = `${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, { loc, items: [] });
    groups.get(key)!.items.push(s);
  }
  const updated: Sighting[] = [];
  let done = 0;
  for (const { loc, items } of groups.values()) {
    const times = items.map((s) => Date.parse(s.taken_at));
    const hours = await cachedHistory(loc.lat, loc.lon, Math.min(...times), Math.min(now, Math.max(...times) + HOUR));
    const map = new Map(hours.map((h) => [h.time, h]));
    for (const s of items) {
      const c = conditionsAt(Date.parse(s.taken_at), loc.lat, loc.lon, map);
      if (c) updated.push({ ...s, weather: c });
      else missing++;
      onProgress?.(++done, todo.length);
    }
  }
  return { updated, missing };
}

const trendArrow = (h: number) => (h > 0.7 ? '↑' : h < -0.7 ? '↓' : '→');

/** One-line summary, e.g. "31°F · NW 7 mph · pressure ↑ · 🌖" */
export function describeConditions(c: SightingConditions, short = false): string {
  const wind = c.windMph < 2 ? 'calm' : `${compass(c.windDirDeg)} ${Math.round(c.windMph)}${short ? '' : ' mph'}`;
  const moon = moonEmoji(c.moonIllumination);
  const drop = c.tempChange24h <= -5 ? (short ? ` ↓${Math.round(-c.tempChange24h)}°` : `, ${Math.round(-c.tempChange24h)}° colder than the day before`) : '';
  return short
    ? `${Math.round(c.tempF)}°${drop} · ${wind} · ${trendArrow(c.pressureTrend3h)}`
    : `${Math.round(c.tempF)}°F${drop} · wind ${wind} · pressure ${trendArrow(c.pressureTrend3h)} · ${moon} ${Math.round(c.moonIllumination * 100)}% moon`;
}

function moonEmoji(illum: number): string {
  return illum < 0.1 ? '🌑' : illum < 0.4 ? '🌒' : illum < 0.6 ? '🌓' : illum < 0.9 ? '🌔' : '🌕';
}
