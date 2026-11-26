// Seasonal biology: whitetail rut phases and wild turkey breeding phases.
import { DAY } from './time';

export interface SeasonPhase {
  key: string;
  name: string;
  multiplier: number; // scales the hourly score
  /** Extra midday baseline activity (rutting bucks cruise all day) */
  middayBoost: number;
  note: string;
}

/**
 * Default peak-rut estimate by latitude for North American whitetails.
 * The northern rut is remarkably consistent (photoperiod driven); the southern rut
 * varies by region — users in the Southeast/Texas should set their local peak.
 */
export function defaultRutPeak(lat: number, year: number): Date {
  // [month (0-based), day]
  let md: [number, number];
  if (lat >= 37) md = [10, 12]; // ~Nov 12 across the Midwest/Northeast
  else if (lat >= 34) md = [10, 20];
  else if (lat >= 31) md = [11, 10]; // early-mid Dec typical for much of the Deep South
  else md = [11, 20];
  return new Date(Date.UTC(year, md[0], md[1], 12));
}

/** Rut peak closest to `date` (handles Southern ruts that spill into January). */
export function nearestRutPeak(date: number, lat: number, overrideMonthDay?: string | null): number {
  const y = new Date(date).getUTCFullYear();
  const candidates = [y - 1, y, y + 1].map((yr) => {
    if (overrideMonthDay) {
      const [m, d] = overrideMonthDay.split('-').map(Number);
      return Date.UTC(yr, m - 1, d, 12);
    }
    return defaultRutPeak(lat, yr).getTime();
  });
  return candidates.reduce((best, c) => (Math.abs(c - date) < Math.abs(best - date) ? c : best));
}

export function deerPhase(date: number, lat: number, rutOverride?: string | null): SeasonPhase & { daysFromPeak: number } {
  const peak = nearestRutPeak(date, lat, rutOverride);
  const d = Math.round((date - peak) / DAY);
  const base = { daysFromPeak: d };
  if (d < -35 || d > 75)
    return { ...base, key: 'early', name: 'Early season', multiplier: 0.85, middayBoost: 0, note: 'Deer are on predictable bed-to-food patterns. Hunt food sources in the evening.' };
  if (d < -18)
    return { ...base, key: 'lull', name: 'Early pre-rut', multiplier: 0.85, middayBoost: 0, note: 'Daylight movement tends to dip ("October lull"). A cold snap is your best trigger.' };
  if (d < -9)
    return { ...base, key: 'prerut', name: 'Pre-rut', multiplier: 1.0, middayBoost: 0.05, note: 'Rubs and scrapes are heating up. Hunt scrape lines and transition areas.' };
  if (d < -2)
    return { ...base, key: 'seeking', name: 'Seeking & chasing', multiplier: 1.2, middayBoost: 0.2, note: 'Bucks are on their feet all day searching for does. Sit all day if you can.' };
  if (d <= 8)
    return { ...base, key: 'peak', name: 'Peak breeding', multiplier: 1.1, middayBoost: 0.2, note: 'Bucks are locked down with does and movement is erratic. Hunt doe bedding areas and funnels.' };
  if (d <= 20)
    return { ...base, key: 'postrut', name: 'Post-rut', multiplier: 0.95, middayBoost: 0.05, note: 'Worn-down bucks are switching back to food. Late afternoons over food are best.' };
  if (d <= 35)
    return { ...base, key: 'secondrut', name: 'Second rut', multiplier: 1.05, middayBoost: 0.1, note: 'Unbred and yearling does come into estrus, which brings a brief second wave of chasing.' };
  return { ...base, key: 'late', name: 'Late season', multiplier: 0.95, middayBoost: 0.05, note: 'It is all about food and cold. Bitter cold afternoons over high-energy food are best.' };
}

/** Approximate date of peak spring gobbling by latitude (earlier in the South). */
export function peakGobbleDayOfYear(lat: number): number {
  // ~Mar 25 (DOY 84) at 28°N → ~May 1 (DOY 121) at 46°N
  const doy = 84 + (Math.min(Math.max(lat, 28), 48) - 28) * 2.05;
  return Math.round(doy);
}

export function turkeyPhase(date: number, lat: number): SeasonPhase & { season: 'spring' | 'fall' | 'off' } {
  const d = new Date(date);
  const doy = Math.round((date - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY) + 1;
  const peak = peakGobbleDayOfYear(lat);
  const rel = doy - peak;
  if (rel >= -28 && rel < -10)
    return { season: 'spring', key: 'breakup', name: 'Spring: flocks breaking up', multiplier: 1.0, middayBoost: 0, note: 'Toms are still with hens. Be patient. Gobbling builds every day.' };
  if (rel >= -10 && rel <= 10)
    return { season: 'spring', key: 'peakgobble', name: 'Spring: peak gobbling', multiplier: 1.15, middayBoost: 0.05, note: 'Breeding is in full swing and gobbling is at its peak. Be set up before fly-down.' };
  if (rel > 10 && rel <= 40)
    return { season: 'spring', key: 'nesting', name: 'Spring: hens nesting', multiplier: 1.05, middayBoost: 0.25, note: 'Hens leave toms mid-morning, so lonely gobblers respond well from 9 AM to 1 PM.' };
  const month = d.getUTCMonth();
  if (month >= 8 && month <= 11)
    return { season: 'fall', key: 'fall', name: 'Fall: family flocks', multiplier: 0.9, middayBoost: 0.1, note: 'Birds are in flocks and driven by food. Scatter a flock and call them back together, or pattern their feeding.' };
  return { season: 'off', key: 'off', name: 'Off-season', multiplier: 0.75, middayBoost: 0, note: 'Most states are closed right now, so this is a good time to scout and roost birds. Check your local regulations.' };
}
