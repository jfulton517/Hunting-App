import * as SunCalc from 'suncalc';
import { HOUR, MINUTE } from './time';

export interface SunDay {
  sunrise: number;
  sunset: number;
  civilDawn: number;
  civilDusk: number;
  solarNoon: number;
}

export type MoonEventType = 'rise' | 'set' | 'overhead' | 'underfoot';

export interface MoonEvent {
  type: MoonEventType;
  time: number;
}

export interface MoonPhaseInfo {
  /** 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter */
  phase: number;
  /** 0-1 illuminated fraction */
  illumination: number;
  name: string;
  emoji: string;
}

/** Sun times for the solar day nearest `noonEpoch` (pass the local noon of the day you want). */
export function sunDay(noonEpoch: number, lat: number, lon: number): SunDay {
  const t = SunCalc.getTimes(new Date(noonEpoch), lat, lon);
  const v = (d: Date | null, fallback: number) => (!d || isNaN(d.getTime()) ? fallback : d.getTime());
  const noon = v(t.solarNoon, noonEpoch);
  // Polar day/night fallbacks keep the rest of the app working.
  return {
    sunrise: v(t.sunrise, noon - 6 * HOUR),
    sunset: v(t.sunset, noon + 6 * HOUR),
    civilDawn: v(t.dawn, noon - 6.5 * HOUR),
    civilDusk: v(t.dusk, noon + 6.5 * HOUR),
    solarNoon: noon,
  };
}

export function moonPhase(epoch: number): MoonPhaseInfo {
  const { phase, fraction } = SunCalc.getMoonIllumination(new Date(epoch));
  return { phase, illumination: fraction, ...phaseName(phase) };
}

export function phaseName(phase: number): { name: string; emoji: string } {
  const names: [string, string][] = [
    ['New Moon', '🌑'],
    ['Waxing Crescent', '🌒'],
    ['First Quarter', '🌓'],
    ['Waxing Gibbous', '🌔'],
    ['Full Moon', '🌕'],
    ['Waning Gibbous', '🌖'],
    ['Last Quarter', '🌗'],
    ['Waning Crescent', '🌘'],
  ];
  const idx = Math.round(phase * 8) % 8;
  return { name: names[idx][0], emoji: names[idx][1] };
}

/**
 * Finds moonrise, moonset, upper transit (moon overhead) and lower transit (moon underfoot)
 * between `start` and `end` by sampling the moon's altitude. These drive solunar
 * major (transits) and minor (rise/set) periods.
 */
export function moonEvents(start: number, end: number, lat: number, lon: number): MoonEvent[] {
  const step = 10 * MINUTE;
  const events: MoonEvent[] = [];
  const alt = (t: number) => SunCalc.getMoonPosition(new Date(t), lat, lon).altitude;
  // Moon's apparent horizon: refraction + semi-diameter - parallax ≈ +0.133°
  const horizon = (0.133 * Math.PI) / 180;

  let t0 = start - step;
  let a0 = alt(t0);
  let t1 = start;
  let a1 = alt(t1);
  for (let t2 = start + step; t2 <= end + step; t2 += step) {
    const a2 = alt(t2);
    // Horizon crossings between t0 and t1
    if ((a0 - horizon) * (a1 - horizon) < 0 && t1 >= start) {
      const frac = (horizon - a0) / (a1 - a0);
      events.push({ type: a1 > a0 ? 'rise' : 'set', time: t0 + frac * step });
    }
    // Local extrema at t1 -> transits (refined with a parabola fit)
    if (t1 >= start && t1 <= end) {
      const isMax = a1 > a0 && a1 >= a2;
      const isMin = a1 < a0 && a1 <= a2;
      if (isMax || isMin) {
        const denom = a0 - 2 * a1 + a2;
        const offset = denom !== 0 ? (0.5 * (a0 - a2)) / denom : 0;
        events.push({ type: isMax ? 'overhead' : 'underfoot', time: t1 + offset * step });
      }
    }
    t0 = t1;
    a0 = a1;
    t1 = t2;
    a1 = a2;
  }
  return events.filter((e) => e.time >= start && e.time <= end).sort((a, b) => a.time - b.time);
}

/**
 * Solunar activity at time t, 0-1. Major periods center on moon overhead/underfoot
 * (~2 hours wide), minor periods on moonrise/moonset (~1 hour wide).
 */
export function solunarStrength(t: number, events: MoonEvent[]): { value: number; label: string | null } {
  let best = 0;
  let label: string | null = null;
  for (const e of events) {
    const dt = Math.abs(t - e.time);
    if (dt > 3 * HOUR) continue;
    const major = e.type === 'overhead' || e.type === 'underfoot';
    const sigma = major ? 60 * MINUTE : 35 * MINUTE;
    const peak = major ? 1 : 0.65;
    const v = peak * Math.exp(-(dt * dt) / (2 * sigma * sigma));
    if (v > best) {
      best = v;
      label = major ? `Major solunar period (moon ${e.type})` : `Minor solunar period (moon${e.type})`;
    }
  }
  return { value: best, label: best > 0.35 ? label : null };
}

export function solunarPeriods(events: MoonEvent[]): { type: 'major' | 'minor'; start: number; end: number; center: number; event: MoonEventType }[] {
  return events.map((e) => {
    const major = e.type === 'overhead' || e.type === 'underfoot';
    const half = major ? HOUR : 30 * MINUTE;
    return { type: major ? 'major' : 'minor', start: e.time - half, end: e.time + half, center: e.time, event: e.type };
  });
}
