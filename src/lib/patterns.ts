// Learn a specific deer's movement pattern from confirmed trail-cam sightings, then
// match that pattern against the forecast to recommend when and where to hunt him.
import type { Camera, Deer, SightingConditions, Stand } from './data/types';
import type { DayForecast } from './forecast';
import { distanceM, formatDistance, targetIsDownwind } from './geo';
import { compass, compass8, type Compass8, type HourWeather } from './weather';
import { DAY, HOUR, MINUTE } from './time';

export type TimeBin = 'dawn' | 'midday' | 'dusk' | 'night';
export type Trend = 'rising' | 'steady' | 'falling';
export type TempTrend = 'colder' | 'similar' | 'warmer';
export type MoonBin = 'dark' | 'partial' | 'bright';

export function timeBin(c: Pick<SightingConditions, 'minutesFromSunrise' | 'minutesFromSunset'>): TimeBin {
  if (c.minutesFromSunrise >= -60 && c.minutesFromSunrise <= 120) return 'dawn';
  if (c.minutesFromSunset >= -45 && c.minutesFromSunset <= 150) return 'dusk';
  if (c.minutesFromSunrise > 120 && c.minutesFromSunset > 150) return 'midday';
  return 'night';
}
export const pressureBin = (c: SightingConditions): Trend => (c.pressureTrend3h > 0.7 ? 'rising' : c.pressureTrend3h < -0.7 ? 'falling' : 'steady');
export const tempBin = (c: SightingConditions): TempTrend => (c.tempChange24h <= -5 ? 'colder' : c.tempChange24h >= 5 ? 'warmer' : 'similar');
export const moonBin = (c: SightingConditions): MoonBin => (c.moonIllumination < 0.25 ? 'dark' : c.moonIllumination > 0.75 ? 'bright' : 'partial');
export const windBin = (c: SightingConditions): Compass8 | null => (c.windMph < 2 ? null : compass8(c.windDirDeg));

/** Typical share of hours in each time bin, used when no local baseline is available. */
const TIME_PRIOR: Record<TimeBin, number> = { dawn: 3 / 24, midday: 6 / 24, dusk: 3.25 / 24, night: 11.75 / 24 };

/** How strongly a factor's bins are favored: >1 means seen more often than conditions occur. */
export type Affinity<K extends string> = Record<K, { count: number; ratio: number }>;

export interface PatternObs {
  t: number;
  cameraId: string | null;
  c: SightingConditions;
  /** Photos in this visit (a burst of photos is one sighting) */
  photos?: number;
}

export interface DeerPattern {
  /** Separate sightings (visits), not photos */
  n: number;
  photos: number;
  daylight: number;
  lastSeen: number | null;
  confidence: 'none' | 'low' | 'medium' | 'high';
  time: Affinity<TimeBin>;
  wind: Affinity<Compass8>;
  pressure: Affinity<Trend>;
  temp: Affinity<TempTrend>;
  moon: Affinity<MoonBin>;
  cameras: { cameraId: string; n: number; daylight: number; recent: number; bins: Record<TimeBin, number> }[];
  summary: string[];
}


function affinity<K extends string>(keys: readonly K[], observed: (K | null)[], baseline: Record<K, number>): Affinity<K> {
  const valid = observed.filter((k): k is K => k != null);
  const n = valid.length;
  // Pseudo-observations pulling sparse data toward "no preference"; more bins need more evidence.
  const alpha = 2 * keys.length;
  const out = {} as Affinity<K>;
  for (const k of keys) {
    const count = valid.filter((v) => v === k).length;
    const p = Math.max(baseline[k], 0.01);
    const ratio = (count + alpha * p) / (n + alpha) / p;
    out[k] = { count, ratio: Math.min(3, Math.max(0.3, ratio)) };
  }
  return out;
}

function frequencies<K extends string>(keys: readonly K[], values: (K | null)[]): Record<K, number> {
  const valid = values.filter((v): v is K => v != null);
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = valid.length ? (valid.filter((v) => v === k).length + 0.5) / (valid.length + 0.5 * keys.length) : 1 / keys.length;
  return out;
}

const TIME_KEYS = ['dawn', 'midday', 'dusk', 'night'] as const;
const WIND_KEYS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const TREND_KEYS = ['rising', 'steady', 'falling'] as const;
const TEMP_KEYS = ['colder', 'similar', 'warmer'] as const;
const MOON_KEYS = ['dark', 'partial', 'bright'] as const;

/**
 * @param obs confirmed sightings of this deer, with conditions at the time
 * @param background conditions for every hour over the same period (what *could* have happened),
 *   so a buck seen on NW winds in a month of NW winds isn't mistaken for a NW-wind buck
 */
export function learnPattern(obs: PatternObs[], background: SightingConditions[] = [], now = Date.now()): DeerPattern {
  const n = obs.length;
  const cs = obs.map((o) => o.c);
  const bins = cs.map(timeBin);
  const daylight = bins.filter((b) => b !== 'night').length;

  const bg = background.length >= 48;
  const time = affinity(TIME_KEYS, bins, bg ? frequencies(TIME_KEYS, background.map(timeBin)) : TIME_PRIOR);
  const wind = affinity(WIND_KEYS, cs.map(windBin), frequencies(WIND_KEYS, bg ? background.map(windBin) : []));
  const pressure = affinity(TREND_KEYS, cs.map(pressureBin), frequencies(TREND_KEYS, bg ? background.map(pressureBin) : []));
  const temp = affinity(TEMP_KEYS, cs.map(tempBin), frequencies(TEMP_KEYS, bg ? background.map(tempBin) : []));
  const moon = affinity(MOON_KEYS, cs.map(moonBin), frequencies(MOON_KEYS, bg ? background.map(moonBin) : []));

  const camMap = new Map<string, DeerPattern['cameras'][number]>();
  obs.forEach((o, i) => {
    if (!o.cameraId) return;
    let c = camMap.get(o.cameraId);
    if (!c) camMap.set(o.cameraId, (c = { cameraId: o.cameraId, n: 0, daylight: 0, recent: 0, bins: { dawn: 0, midday: 0, dusk: 0, night: 0 } }));
    c.n++;
    c.bins[bins[i]]++;
    if (bins[i] !== 'night') c.daylight++;
    if (now - o.t < 21 * DAY) c.recent++;
  });
  const cameras = [...camMap.values()].sort((a, b) => camWeight(b) - camWeight(a));

  const confidence = n < 3 ? 'none' : n < 6 ? 'low' : n < 12 ? 'medium' : 'high';
  const pattern: DeerPattern = {
    n,
    photos: obs.reduce((sum, o) => sum + (o.photos ?? 1), 0),
    daylight,
    lastSeen: n ? Math.max(...obs.map((o) => o.t)) : null,
    confidence,
    time,
    wind,
    pressure,
    temp,
    moon,
    cameras,
    summary: [],
  };
  pattern.summary = summarize(pattern);
  return pattern;
}

const camWeight = (c: { n: number; daylight: number; recent: number }) => c.n + 2 * c.daylight + 2 * c.recent;

function favored<K extends string>(a: Affinity<K>, minCount = 2): K[] {
  return (Object.keys(a) as K[]).filter((k) => a[k].count >= minCount && a[k].ratio >= 1.35).sort((x, y) => a[y].ratio - a[x].ratio);
}

function summarize(p: DeerPattern): string[] {
  if (p.n === 0) return ['No confirmed sightings yet. Tag trail-cam photos of this deer to learn his pattern.'];
  const out: string[] = [];
  out.push(`${p.n} separate sighting${p.n === 1 ? '' : 's'}${p.photos > p.n ? ` (${p.photos} photos)` : ''}, ${p.daylight} in daylight.`);
  if (p.n >= 3 && p.daylight === 0)
    out.push("Every visit so far has been at night. That's typical of a mature buck. Your best odds are cold fronts, the chasing phase of the rut, or setting up closer to his bedding.");
  const t = favored(p.time).filter((k) => k !== 'night');
  if (t.length) out.push(`Daylight movement favors ${t.join(' and ')} (${t.map((k) => p.time[k].count).join(' + ')} sightings).`);
  const w = favored(p.wind);
  if (w.length) out.push(`Shows up most on ${w.slice(0, 3).join('/')} winds.`);
  const pr = favored(p.pressure);
  if (pr.length) out.push(`Moves more on ${pr[0]} pressure.`);
  const tp = favored(p.temp);
  if (tp.includes('colder')) out.push('Responds to temperature drops.');
  else if (tp.includes('warmer')) out.push('Has moved on warmer-than-yesterday days.');
  const m = favored(p.moon);
  if (m.length) out.push(`Seen more often around ${m[0]} moon phases.`);
  if (p.confidence === 'none') out.push('He needs at least 3 separate sightings before the app can make recommendations. Several photos from one walk past the camera count as one.');
  else if (p.confidence === 'low') out.push('Pattern confidence is low. It gets better with every photo you tag.');
  return out;
}

// ------------------------------------------------------------------ recommendations

export interface Recommendation {
  dayKey: string;
  start: number;
  end: number;
  rating: number; // 0..100 (shown as 1–10)
  camera: Camera | null;
  stand: Stand | null;
  setup: string;
  reasons: string[];
  windDeg: number | null;
}

function forecastConditions(t: number, wx: Map<number, HourWeather>, day: DayForecast): SightingConditions | null {
  const w = wx.get(t);
  if (!w) return null;
  const w3 = wx.get(t - 3 * HOUR);
  const w24 = wx.get(t - 24 * HOUR);
  const mid = t + 30 * MINUTE;
  return {
    tempF: w.tempF,
    tempChange24h: w24 ? w.tempF - w24.tempF : 0,
    windMph: w.windMph,
    windDirDeg: w.windDirDeg,
    pressureHpa: w.pressureHpa,
    pressureTrend3h: w3 ? w.pressureHpa - w3.pressureHpa : 0,
    cloudCover: w.cloudCover,
    moonIllumination: day.moon.illumination,
    minutesFromSunrise: Math.round((mid - day.sun.sunrise) / MINUTE),
    minutesFromSunset: Math.round((day.sun.sunset - mid) / MINUTE),
  };
}

function pickStand(camera: Camera | null, stands: Stand[], windDeg: number | null): { stand: Stand | null; setup: string } {
  if (!camera) return { stand: null, setup: 'Set a location for his cameras to get stand recommendations.' };
  const dir = windDeg != null ? compass8(windDeg) : null;
  const linked = camera.stand_id ? stands.find((s) => s.id === camera.stand_id) ?? null : null;
  const nearby = stands
    .map((s) => ({ s, d: s.id === linked?.id ? 0 : camera.lat != null && s.lat != null && s.lon != null ? distanceM(s.lat, s.lon, camera.lat, camera.lon!) : null }))
    .filter(({ s, d }) => (d != null ? d <= 1200 : s.place_id != null && s.place_id === camera.place_id));
  const ok = nearby.filter(({ s }) => {
    if (dir && s.winds.length && !s.winds.includes(dir)) return false;
    if (windDeg != null && camera.lat != null && s.lat != null && s.lon != null && targetIsDownwind({ lat: s.lat, lon: s.lon }, { lat: camera.lat, lon: camera.lon! }, windDeg)) return false;
    return true;
  });
  ok.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
  const side = windDeg != null ? compass((windDeg + 180) % 360) : null;
  if (ok.length) {
    const { s, d } = ok[0];
    const where = s.id === linked?.id ? `, the stand at ${camera.name}` : d != null ? `, ${formatDistance(d)} from ${camera.name}` : '';
    return { stand: s, setup: `${s.name}${where}. The ${dir ?? 'forecast'} wind keeps your scent off his travel route.` };
  }
  if (linked && dir)
    return {
      stand: null,
      setup: `${linked.name} (the stand at ${camera.name}) is set for ${linked.winds.length ? linked.winds.join('/') : 'no'} winds, and this is a ${dir} wind. Hunt it on a better wind, or set up on the ${compass((windDeg! + 180) % 360)} (downwind) side of the camera.`,
    };
  return {
    stand: null,
    setup: side ? `None of your saved stands fit a ${compass(windDeg!)} wind near ${camera.name}. Set up on the ${side} (downwind) side of the camera area.` : `Hunt near ${camera.name}.`,
  };
}

/**
 * Rank upcoming hunting windows for a target deer: hourly Huntability × how well each
 * hour's conditions match his pattern, placed at the camera he favors with a stand that
 * suits the wind.
 */
export function recommendForDeer(opts: {
  deer?: Deer;
  pattern: DeerPattern;
  days: DayForecast[];
  wx: Map<number, HourWeather>;
  cameras: Camera[];
  stands: Stand[];
  limit?: number;
}): Recommendation[] {
  const { pattern, days, wx, cameras, stands } = opts;
  if (pattern.confidence === 'none') return [];
  const camById = new Map(cameras.map((c) => [c.id, c]));

  // Best affinity any hour could reach for this deer, so "pattern match" is a 0..1 fraction.
  const maxOf = <K extends string>(a: Affinity<K>) => Math.max(...(Object.values(a) as { ratio: number }[]).map((x) => x.ratio));
  const maxAff =
    maxOf(pattern.time) * maxOf(pattern.wind) ** 0.7 * maxOf(pattern.pressure) ** 0.5 * maxOf(pattern.temp) ** 0.5 * maxOf(pattern.moon) ** 0.3;

  type Scored = { t: number; v: number; bin: TimeBin; c: SightingConditions; base: number };
  const perDay: { day: DayForecast; hours: Scored[] }[] = [];
  for (const day of days) {
    if (day.estimated) continue;
    const hours: Scored[] = [];
    for (const h of day.hours) {
      if (!h.legal) continue;
      const c = forecastConditions(h.t, wx, day);
      if (!c) continue;
      const bin = timeBin(c);
      const wb = windBin(c);
      const aff =
        pattern.time[bin].ratio ** 1.0 *
        (wb ? pattern.wind[wb].ratio : 1) ** 0.7 *
        pattern.pressure[pressureBin(c)].ratio ** 0.5 *
        pattern.temp[tempBin(c)].ratio ** 0.5 *
        pattern.moon[moonBin(c)].ratio ** 0.3;
      // Rating: geometric blend of general Huntability and how well the hour fits his pattern.
      const match = Math.min(1, aff / maxAff);
      hours.push({ t: h.t, v: Math.sqrt((h.score / 100) * match), bin, c, base: h.score });
    }
    if (hours.length) perDay.push({ day, hours });
  }

  // Best 2-hour window per day.
  const windows: { day: DayForecast; a: Scored; b: Scored; v: number }[] = [];
  for (const { day, hours } of perDay) {
    let best: (typeof windows)[number] | null = null;
    for (let i = 0; i + 1 < hours.length; i++) {
      if (hours[i + 1].t - hours[i].t !== HOUR) continue;
      const v = (hours[i].v + hours[i + 1].v) / 2;
      if (!best || v > best.v) best = { day, a: hours[i], b: hours[i + 1], v };
    }
    if (best) windows.push(best);
  }
  windows.sort((x, y) => y.v - x.v);

  return windows.slice(0, opts.limit ?? 5).map(({ day, a, b, v }) => {
    const bin = a.bin;
    // Camera: his most-used camera, preferring ones where he's shown up at this time of day.
    const cam =
      pattern.cameras
        .map((pc) => ({ pc, w: camWeight(pc) * (1 + pc.bins[bin]) }))
        .sort((x, y) => y.w - x.w)
        .map(({ pc }) => camById.get(pc.cameraId))
        .find(Boolean) ?? null;
    const windDeg = a.c.windMph >= 2 ? a.c.windDirDeg : null;
    const { stand, setup } = pickStand(cam, stands, windDeg);
    const reasons: string[] = [];
    if (pattern.time[bin].ratio >= 1.2 && pattern.time[bin].count) reasons.push(`He's been seen at ${bin} ${pattern.time[bin].count} time${pattern.time[bin].count === 1 ? '' : 's'}`);
    const wb = windBin(a.c);
    if (wb && pattern.wind[wb].ratio >= 1.2 && pattern.wind[wb].count) reasons.push(`${wb} wind matches ${pattern.wind[wb].count} of his sightings`);
    const pb = pressureBin(a.c);
    if (pattern.pressure[pb].ratio >= 1.2 && pattern.pressure[pb].count) reasons.push(`${pb[0].toUpperCase()}${pb.slice(1)} pressure, which he's moved on before`);
    const tb = tempBin(a.c);
    if (tb === 'colder') reasons.push(`${Math.round(-a.c.tempChange24h)}° colder than the day before`);
    reasons.push(`Huntability ${(Math.max(10, (a.base + b.base) / 2) / 10).toFixed(1)}`);
    return {
      dayKey: day.key,
      start: a.t,
      end: b.t + HOUR,
      rating: Math.round(Math.min(1, v) * 100),
      camera: cam,
      stand,
      setup,
      reasons,
      windDeg,
    };
  });
}
