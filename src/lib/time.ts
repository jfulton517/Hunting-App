// Time helpers that work in the *hunting location's* time zone, not the device's.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(epochMs: number, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(new Date(epochMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour % 24,
    minute: out.minute,
    second: out.second,
  };
}

/** "YYYY-MM-DD" in the given zone. */
export function dateKey(epochMs: number, tz: string): string {
  const p = localParts(epochMs, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Epoch of local midnight for the day containing epochMs. */
export function localMidnight(epochMs: number, tz: string): number {
  const p = localParts(epochMs, tz);
  let t = epochMs - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000;
  t -= t % 1000;
  // Correct for a DST shift between midnight and epochMs.
  const check = localParts(t, tz);
  if (check.hour !== 0) t -= (check.hour > 12 ? check.hour - 24 : check.hour) * HOUR;
  return t;
}

/** Local noon of the day containing epochMs (stable anchor for astronomy calculations). */
export function localNoon(epochMs: number, tz: string): number {
  return localMidnight(epochMs, tz) + 12 * HOUR;
}

/** Day of year (1-366) for a local date key. */
export function dayOfYear(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY) + 1;
}

export function formatTime(epochMs: number, tz: string): string {
  return new Date(epochMs).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
}

export function formatHour(epochMs: number, tz: string): string {
  return new Date(epochMs).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric' });
}

export function formatDay(epochMs: number, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...opts,
  });
}
