import { moonEvents, moonPhase, solunarPeriods, sunDay, type MoonEvent, type MoonPhaseInfo, type SunDay } from './astro';
import { scoreHour, type Factor, type HourScore, type Species } from './scoring';
import { deerPhase, turkeyPhase, type SeasonPhase } from './season';
import { DAY, HOUR, dateKey, localMidnight, localNoon } from './time';
import { normalFor, type HourWeather, type Normals, type WeatherForecast } from './weather';

export interface ScoreWindow {
  start: number;
  end: number;
  score: number;
}

export type Confidence = 'high' | 'good' | 'moderate' | 'low';

export interface DaySummary {
  highF: number;
  lowF: number;
  maxWindMph: number;
  precipIn: number;
  precipProbMax: number;
  weatherCode: number;
  pressureChangeHpa: number; // midnight → midnight
}

export interface Highlight {
  text: string;
  effect: 'good' | 'bad';
}

export interface DayForecast {
  key: string;
  midnight: number;
  leadDays: number;
  sun: SunDay;
  moon: MoonPhaseInfo;
  moonEvents: MoonEvent[];
  solunar: ReturnType<typeof solunarPeriods>;
  phase: SeasonPhase;
  hours: HourScore[];
  score: number;
  morning: ScoreWindow | null;
  evening: ScoreWindow | null;
  best: ScoreWindow | null;
  estimated: boolean;
  confidence: Confidence;
  summary: DaySummary | null;
  normal: { highF: number; lowF: number } | null;
  tempAnomaly: number | null;
  highlights: Highlight[];
  /** Mean wind direction (from) during the morning / evening windows, degrees */
  windDir: { morning: number | null; evening: number | null };
}

export interface ForecastInput {
  lat: number;
  lon: number;
  species: Species;
  weather: WeatherForecast | null;
  normals: Normals | null;
  days: number;
  now?: number;
  timezone?: string;
  rutPeak?: string | null; // "MM-DD"
}

const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function circularMean(degs: number[]): number | null {
  if (!degs.length) return null;
  const x = avg(degs.map((d) => Math.cos((d * Math.PI) / 180)));
  const y = avg(degs.map((d) => Math.sin((d * Math.PI) / 180)));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function bestWindow(hours: HourScore[], width = 2): ScoreWindow | null {
  let best: ScoreWindow | null = null;
  for (let i = 0; i + width <= hours.length; i++) {
    const slice = hours.slice(i, i + width);
    if (slice[width - 1].t - slice[0].t !== (width - 1) * HOUR) continue; // must be contiguous
    const s = avg(slice.map((h) => h.score));
    if (!best || s > best.score) best = { start: slice[0].t, end: slice[width - 1].t + HOUR, score: Math.round(s) };
  }
  if (!best && hours.length) {
    const h = hours.reduce((a, b) => (b.score > a.score ? b : a));
    best = { start: h.t, end: h.t + HOUR, score: h.score };
  }
  return best;
}

function confidenceFor(lead: number, estimated: boolean): Confidence {
  if (estimated) return 'low';
  if (lead <= 2) return 'high';
  if (lead <= 6) return 'good';
  return 'moderate';
}

/** Prefer the explanatory sentence ("why") over the raw reading. */
const why = (s: string) => {
  const parts = s.split(/(?<=\.)\s/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]).replace(/\.$/, '');
};

function highlightsFor(windowHours: HourScore[], day: Pick<DayForecast, 'tempAnomaly' | 'moon' | 'phase'>, species: Species): Highlight[] {
  const out: Highlight[] = [];
  const byKey = new Map<string, Factor[]>();
  for (const h of windowHours) for (const fa of h.factors) {
    if (fa.key === 'time' || fa.key === 'season' || fa.key === 'moon') continue;
    if (!byKey.has(fa.key)) byKey.set(fa.key, []);
    byKey.get(fa.key)!.push(fa);
  }
  for (const [, list] of byKey) {
    const mean = avg(list.map((x) => x.score));
    const rep = list.reduce((a, b) => (Math.abs(b.score - mean) < Math.abs(a.score - mean) ? b : a));
    if (mean >= 0.88 && rep.key !== 'precip' && rep.key !== 'solunar' && /\.\s\S/.test(rep.detail)) out.push({ text: `${rep.label}: ${why(rep.detail)}`, effect: 'good' });
    else if (rep.key === 'solunar' && mean >= 0.8) out.push({ text: 'A solunar major period overlaps prime time', effect: 'good' });
    else if (mean <= 0.5 && rep.key !== 'solunar') out.push({ text: `${rep.label}: ${why(rep.detail)}`, effect: 'bad' });
  }
  if (windowHours.some((h) => h.notes.some((n) => n.startsWith('Post-cold-front'))))
    out.unshift({ text: 'A cold front just passed, so expect strong movement', effect: 'good' });
  if (species === 'deer' && day.tempAnomaly != null && day.tempAnomaly <= -6 && !out.some((h) => h.text.startsWith('Temperature')))
    out.push({ text: `${Math.round(-day.tempAnomaly)}° colder than normal`, effect: 'good' });
  if (species === 'deer' && day.tempAnomaly != null && day.tempAnomaly >= 8 && !out.some((h) => h.text.startsWith('Temperature')))
    out.push({ text: `${Math.round(day.tempAnomaly)}° warmer than normal`, effect: 'bad' });
  if (species === 'deer' && (day.phase.key === 'seeking' || day.phase.key === 'peak')) out.push({ text: day.phase.name, effect: 'good' });
  return out.slice(0, 5);
}

export function buildForecast(input: ForecastInput): { tz: string; days: DayForecast[] } {
  const now = input.now ?? Date.now();
  const tz = input.weather?.timezone ?? input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const wxByTime = new Map<number, HourWeather>();
  for (const h of input.weather?.hours ?? []) wxByTime.set(h.time, h);
  const lastWx = input.weather?.hours.at(-1)?.time ?? 0;

  const todayMidnight = localMidnight(now, tz);
  const days: DayForecast[] = [];

  for (let i = 0; i < input.days; i++) {
    const noon = localNoon(todayMidnight + i * DAY + 12 * HOUR, tz);
    const midnight = localMidnight(noon, tz);
    const nextMidnight = localMidnight(noon + DAY, tz);
    const key = dateKey(noon, tz);
    const sun = sunDay(noon, input.lat, input.lon);
    const moon = moonPhase(noon);
    const mEvents = moonEvents(midnight - 4 * HOUR, nextMidnight + 4 * HOUR, input.lat, input.lon);
    const phase = input.species === 'deer' ? deerPhase(noon, input.lat, input.rutPeak) : turkeyPhase(noon, input.lat);

    const dayWx: HourWeather[] = [];
    for (let t = midnight; t < nextMidnight; t += HOUR) {
      const w = wxByTime.get(t);
      if (w) dayWx.push(w);
    }
    const hasWx = dayWx.length >= 20;
    const normal = normalFor(input.normals, noon, tz);
    const tempAnomaly = hasWx && normal ? avg(dayWx.map((w) => w.tempF)) - (normal.highF + normal.lowF) / 2 : null;

    const hours: HourScore[] = [];
    for (let t = midnight; t < nextMidnight; t += HOUR) {
      const wx = hasWx ? (wxByTime.get(t) ?? null) : null;
      const prev3 = [1, 2, 3].map((k) => wxByTime.get(t - k * HOUR)?.precipIn ?? 0).reduce((a, b) => a + b, 0);
      hours.push(
        scoreHour(input.species, {
          t,
          wx,
          wx3hAgo: wxByTime.get(t - 3 * HOUR) ?? null,
          wx24hAgo: wxByTime.get(t - 24 * HOUR) ?? null,
          precipPrev3h: prev3,
          sun,
          moonEvents: mEvents,
          moon,
          phase,
          tempAnomaly,
        }),
      );
    }

    const legal = hours.filter((h) => h.legal);
    const morningHours = legal.filter((h) => h.t + HOUR / 2 < sun.solarNoon);
    const eveningHours = legal.filter((h) => h.t + HOUR / 2 >= sun.solarNoon);
    const morning = bestWindow(morningHours);
    const evening = bestWindow(eveningHours);
    const best = [morning, evening].filter(Boolean).reduce<ScoreWindow | null>((a, b) => (!a || b!.score > a.score ? b : a), null);
    const legalMean = avg(legal.map((h) => h.score));
    const [wm, we, wa] = input.species === 'deer' ? [0.42, 0.42, 0.16] : [0.65, 0.15, 0.2];
    const score = Math.round(wm * (morning?.score ?? 0) + we * (evening?.score ?? 0) + wa * legalMean);

    const inWin = (w: ScoreWindow | null) => (h: HourScore) => !!w && h.t >= w.start && h.t < w.end;
    const windowHours = hours.filter((h) => inWin(morning)(h) || inWin(evening)(h));
    const dirs = (w: ScoreWindow | null) =>
      circularMean(dayWx.filter((x) => w && x.time >= w.start && x.time < w.end).map((x) => x.windDirDeg));

    const daylightWx = dayWx.filter((w) => w.time >= sun.sunrise - HOUR && w.time <= sun.sunset);
    const codeCounts = new Map<number, number>();
    for (const w of daylightWx) codeCounts.set(w.weatherCode, (codeCounts.get(w.weatherCode) ?? 0) + (w.weatherCode >= 51 ? 2 : 1));
    const summary: DaySummary | null = hasWx
      ? {
          highF: Math.max(...dayWx.map((w) => w.tempF)),
          lowF: Math.min(...dayWx.map((w) => w.tempF)),
          maxWindMph: Math.max(...daylightWx.map((w) => w.windMph), 0),
          precipIn: dayWx.reduce((s, w) => s + w.precipIn, 0),
          precipProbMax: Math.max(...dayWx.map((w) => w.precipProb)),
          weatherCode: [...codeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0,
          pressureChangeHpa: dayWx.at(-1)!.pressureHpa - dayWx[0].pressureHpa,
        }
      : null;

    const leadDays = i;
    const estimated = !hasWx;
    const partial = { tempAnomaly, moon, phase };
    days.push({
      key,
      midnight,
      leadDays,
      sun,
      moon,
      moonEvents: mEvents.filter((e) => e.time >= midnight && e.time < nextMidnight),
      solunar: solunarPeriods(mEvents.filter((e) => e.time >= midnight && e.time < nextMidnight)),
      phase,
      hours,
      score,
      morning,
      evening,
      best,
      estimated,
      confidence: confidenceFor(leadDays, estimated || (lastWx > 0 && lastWx < nextMidnight - 2 * HOUR && !hasWx)),
      summary,
      normal,
      tempAnomaly,
      highlights: highlightsFor(windowHours, partial, input.species),
      windDir: { morning: dirs(morning), evening: dirs(evening) },
    });
  }
  return { tz, days };
}

/** Top N days by score, ties broken by earlier date. */
export function bestDays(days: DayForecast[], n: number, filter: (d: DayForecast) => boolean = () => true): DayForecast[] {
  return days
    .filter(filter)
    .slice()
    .sort((a, b) => b.score - a.score || a.midnight - b.midnight)
    .slice(0, n);
}
