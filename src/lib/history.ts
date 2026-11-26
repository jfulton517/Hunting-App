// Past hourly weather (for the moment each trail-cam photo was taken) from Open-Meteo.
import { moonPhase, sunDay } from './astro';
import type { SightingConditions } from './data/types';
import { DAY, HOUR, MINUTE } from './time';
import { parseForecast, type HourWeather } from './weather';

const VARS = 'temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover,weather_code';

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

function url(base: string, lat: number, lon: number, start: number, end: number) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: VARS,
    start_date: iso(start),
    end_date: iso(end),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    timeformat: 'unixtime',
  });
  return `${base}?${q}`;
}

/**
 * Hourly weather between two times. Recent weeks come from the forecast API (which
 * keeps ~3 months of past data); older dates come from the historical archive.
 */
export async function fetchHourlyHistory(lat: number, lon: number, start: number, end: number, now = Date.now()): Promise<HourWeather[]> {
  start -= DAY; // room for 24h comparisons
  const recentCutoff = now - 80 * DAY;
  const ranges: [string, number, number][] = [];
  if (start < recentCutoff) ranges.push(['https://archive-api.open-meteo.com/v1/archive', start, Math.min(end, recentCutoff)]);
  if (end >= recentCutoff) ranges.push(['https://api.open-meteo.com/v1/forecast', Math.max(start, recentCutoff), Math.min(end, now)]);
  const out = new Map<number, HourWeather>();
  for (const [base, s, e] of ranges) {
    const res = await fetch(url(base, lat, lon, s, e));
    if (!res.ok) throw new Error(`Weather history unavailable (${res.status})`);
    for (const h of parseForecast(await res.json()).hours) out.set(h.time, h);
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

// Past weather is fetched once per area and date range per session.
const cache = new Map<string, Promise<HourWeather[]>>();
export function cachedHistory(lat: number, lon: number, start: number, end: number): Promise<HourWeather[]> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.floor(start / DAY)},${Math.floor(end / DAY)}`;
  if (!cache.has(key))
    cache.set(
      key,
      fetchHourlyHistory(lat, lon, start, end).catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  return cache.get(key)!;
}

/** Conditions at time t, from an hour-indexed weather map. Null if weather is missing. */
export function conditionsAt(t: number, lat: number, lon: number, wx: Map<number, HourWeather>): SightingConditions | null {
  const hour = Math.round(t / HOUR) * HOUR;
  const w = wx.get(hour);
  if (!w) return null;
  const w3 = wx.get(hour - 3 * HOUR);
  const w24 = wx.get(hour - 24 * HOUR);
  const sun = sunDay(t, lat, lon);
  return {
    tempF: w.tempF,
    tempChange24h: w24 ? w.tempF - w24.tempF : 0,
    windMph: w.windMph,
    windDirDeg: w.windDirDeg,
    pressureHpa: w.pressureHpa,
    pressureTrend3h: w3 ? w.pressureHpa - w3.pressureHpa : 0,
    cloudCover: w.cloudCover,
    moonIllumination: moonPhase(t).illumination,
    minutesFromSunrise: Math.round((t - sun.sunrise) / MINUTE),
    minutesFromSunset: Math.round((sun.sunset - t) / MINUTE),
  };
}
