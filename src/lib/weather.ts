// Weather data from Open-Meteo (free, no API key): https://open-meteo.com
import { dateKey, dayOfYear } from './time';

export interface HourWeather {
  time: number; // epoch ms
  tempF: number;
  humidity: number;
  pressureHpa: number; // sea-level pressure
  windMph: number;
  gustMph: number;
  windDirDeg: number; // direction wind blows FROM
  precipIn: number;
  precipProb: number;
  snowIn: number;
  cloudCover: number; // %
  weatherCode: number;
}

export interface WeatherForecast {
  timezone: string;
  hours: HourWeather[];
  fetchedAt: number;
}

const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'pressure_msl',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'precipitation',
  'precipitation_probability',
  'snowfall',
  'cloud_cover',
  'weather_code',
];

export function forecastUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: HOURLY_VARS.join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '16',
    past_days: '2', // needed for pressure trends & front detection at the start of the window
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

interface OpenMeteoForecastResponse {
  timezone: string;
  hourly: Record<string, (number | null)[]>;
}

export function parseForecast(json: OpenMeteoForecastResponse): WeatherForecast {
  const h = json.hourly;
  const n = h.time.length;
  const num = (key: string, i: number, fallback = 0) => {
    const v = h[key]?.[i];
    return v == null || Number.isNaN(v) ? fallback : v;
  };
  const hours: HourWeather[] = [];
  for (let i = 0; i < n; i++) {
    if (h.temperature_2m?.[i] == null) continue; // trailing hours sometimes null
    hours.push({
      time: num('time', i) * 1000,
      tempF: num('temperature_2m', i),
      humidity: num('relative_humidity_2m', i, 60),
      pressureHpa: num('pressure_msl', i, 1015),
      windMph: num('wind_speed_10m', i),
      gustMph: num('wind_gusts_10m', i),
      windDirDeg: num('wind_direction_10m', i),
      precipIn: num('precipitation', i),
      precipProb: num('precipitation_probability', i),
      snowIn: num('snowfall', i) / 2.54, // Open-Meteo snowfall is cm even with inch units
      cloudCover: num('cloud_cover', i, 50),
      weatherCode: num('weather_code', i),
    });
  }
  return { timezone: json.timezone || 'UTC', hours, fetchedAt: Date.now() };
}

export async function fetchForecast(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherForecast> {
  const res = await fetch(forecastUrl(lat, lon), { signal });
  if (!res.ok) throw new Error(`Weather service error (${res.status})`);
  return parseForecast(await res.json());
}

/** Typical high/low for a day of year, from the last several years of observations. */
export interface Normals {
  byDayOfYear: Map<number, { highF: number; lowF: number }>;
}

export function normalsUrl(lat: number, lon: number, today: Date, years = 5): string {
  const end = new Date(today);
  end.setUTCFullYear(end.getUTCFullYear() - 1);
  end.setUTCDate(end.getUTCDate() + 70);
  const start = new Date(today);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  start.setUTCDate(start.getUTCDate() - 10);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: iso(start),
    end_date: iso(end),
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: 'auto',
  });
  return `https://archive-api.open-meteo.com/v1/archive?${q}`;
}

export function parseNormals(json: { daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] } }): Normals {
  const buckets = new Map<number, { hi: number[]; lo: number[] }>();
  const { time, temperature_2m_max: hi, temperature_2m_min: lo } = json.daily;
  time.forEach((key, i) => {
    if (hi[i] == null || lo[i] == null) return;
    const doy = dayOfYear(key);
    // Smooth with a ±3 day window so a single odd year doesn't dominate.
    for (let off = -3; off <= 3; off++) {
      const d = ((doy + off - 1 + 366) % 366) + 1;
      let b = buckets.get(d);
      if (!b) buckets.set(d, (b = { hi: [], lo: [] }));
      b.hi.push(hi[i]!);
      b.lo.push(lo[i]!);
    }
  });
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const byDayOfYear = new Map<number, { highF: number; lowF: number }>();
  for (const [d, b] of buckets) byDayOfYear.set(d, { highF: avg(b.hi), lowF: avg(b.lo) });
  return { byDayOfYear };
}

export async function fetchNormals(lat: number, lon: number, signal?: AbortSignal): Promise<Normals | null> {
  try {
    const res = await fetch(normalsUrl(lat, lon, new Date()), { signal });
    if (!res.ok) return null;
    return parseNormals(await res.json());
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null; // normals are a nice-to-have
  }
}

export function normalFor(normals: Normals | null, epoch: number, tz: string) {
  if (!normals) return null;
  return normals.byDayOfYear.get(dayOfYear(dateKey(epoch, tz))) ?? null;
}

export function describeWeatherCode(code: number): { label: string; icon: string } {
  if (code === 0) return { label: 'Clear', icon: '☀️' };
  if (code <= 2) return { label: 'Partly cloudy', icon: '⛅' };
  if (code === 3) return { label: 'Overcast', icon: '☁️' };
  if (code === 45 || code === 48) return { label: 'Fog', icon: '🌫️' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', icon: '🌦️' };
  if (code >= 61 && code <= 67) return { label: 'Rain', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { label: 'Snow', icon: '🌨️' };
  if (code >= 80 && code <= 82) return { label: 'Showers', icon: '🌧️' };
  if (code === 85 || code === 86) return { label: 'Snow showers', icon: '🌨️' };
  if (code >= 95) return { label: 'Thunderstorm', icon: '⛈️' };
  return { label: 'Unknown', icon: '·' };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function compass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}
export const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Compass8 = (typeof COMPASS_8)[number];
export function compass8(deg: number): Compass8 {
  return COMPASS_8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export const hpaToInHg = (hpa: number) => hpa * 0.02953;
