import { describe, expect, it } from 'vitest';
import { moonEvents } from './astro';
import { bestDays, buildForecast } from './forecast';
import { deerPhase, turkeyPhase } from './season';
import { DAY, HOUR, localMidnight, localParts } from './time';
import type { HourWeather, WeatherForecast } from './weather';
import { parseNormals } from './weather';

const LAT = 40.1;
const LON = -88.9;
const TZ = 'America/Chicago';
const NOW = Date.UTC(2026, 10, 26, 15); // Nov 26 2026, 9 AM CST

function syntheticWeather(opts: { days?: number; tweak?: (h: HourWeather, i: number) => void } = {}): WeatherForecast {
  const start = localMidnight(NOW, TZ) - 2 * DAY;
  const hours: HourWeather[] = [];
  const n = 24 * (opts.days ?? 18);
  for (let i = 0; i < n; i++) {
    const t = start + i * HOUR;
    const hod = localParts(t, TZ).hour;
    const h: HourWeather = {
      time: t,
      tempF: 35 + 10 * Math.sin(((hod - 9) / 24) * 2 * Math.PI),
      humidity: 70,
      pressureHpa: 1018,
      windMph: 7,
      gustMph: 12,
      windDirDeg: 315,
      precipIn: 0,
      precipProb: 5,
      snowIn: 0,
      cloudCover: 40,
      weatherCode: 2,
    };
    opts.tweak?.(h, i);
    hours.push(h);
  }
  return { timezone: TZ, hours, fetchedAt: NOW };
}

describe('time helpers', () => {
  it('finds local midnight across DST change', () => {
    const t = Date.UTC(2026, 2, 8, 18); // DST starts Mar 8 2026 in US
    const m = localMidnight(t, TZ);
    expect(localParts(m, TZ)).toMatchObject({ hour: 0, minute: 0, day: 8 });
  });
});

describe('moon events', () => {
  it('finds rises, sets and both transits over a few days', () => {
    const ev = moonEvents(NOW, NOW + 3 * DAY, LAT, LON);
    const count = (t: string) => ev.filter((e) => e.type === t).length;
    for (const t of ['overhead', 'underfoot']) expect(count(t)).toBeGreaterThanOrEqual(2);
    for (const t of ['rise', 'set']) expect(count(t)).toBeGreaterThanOrEqual(2);
  });
});

describe('season phases', () => {
  it('puts mid-November in the northern rut', () => {
    expect(['seeking', 'peak']).toContain(deerPhase(Date.UTC(2026, 10, 10), 42).key);
    expect(deerPhase(Date.UTC(2026, 8, 15), 42).key).toBe('early');
    expect(deerPhase(Date.UTC(2026, 11, 10), 32).key).toMatch(/seeking|peak/);
  });
  it('honors a rut override', () => {
    expect(deerPhase(Date.UTC(2027, 0, 8), 32, '01-10').key).toBe('peak');
  });
  it('knows turkey seasons', () => {
    expect(turkeyPhase(Date.UTC(2026, 3, 20), 40).season).toBe('spring');
    expect(turkeyPhase(Date.UTC(2026, 9, 20), 40).season).toBe('fall');
    expect(turkeyPhase(Date.UTC(2026, 6, 20), 40).season).toBe('off');
  });
});

describe('deer scoring', () => {
  const { days } = buildForecast({ lat: LAT, lon: LON, species: 'deer', weather: syntheticWeather(), normals: null, days: 21, now: NOW });

  it('builds 24 hours per day and marks legal light', () => {
    expect(days).toHaveLength(21);
    expect(days[0].hours.length).toBe(24);
    const legal = days[0].hours.filter((h) => h.legal);
    expect(legal.length).toBeGreaterThanOrEqual(10);
    expect(legal.length).toBeLessThanOrEqual(12);
  });

  it('rates dawn and dusk above midday', () => {
    const d = days[1];
    const at = (h: number) => d.hours.find((x) => localParts(x.t, TZ).hour === h)!.score;
    const dawn = Math.max(at(6), at(7));
    const dusk = Math.max(at(15), at(16));
    expect(dawn).toBeGreaterThan(at(12) + 15);
    expect(dusk).toBeGreaterThan(at(12) + 15);
  });

  it('switches to astronomy-only estimates past the forecast', () => {
    expect(days[3].estimated).toBe(false);
    expect(days[18].estimated).toBe(true);
    expect(days[18].confidence).toBe('low');
    expect(days[18].hours.every((h) => h.factors.every((f) => !['wind', 'pressure'].includes(f.key)))).toBe(true);
  });

  it('penalizes a stormy, windy day', () => {
    const stormDay = 3;
    const wx = syntheticWeather({
      tweak: (h, i) => {
        if (Math.floor(i / 24) === stormDay + 2) Object.assign(h, { windMph: 28, gustMph: 45, precipIn: 0.4, weatherCode: 63 });
      },
    });
    const f = buildForecast({ lat: LAT, lon: LON, species: 'deer', weather: wx, normals: null, days: 6, now: NOW });
    expect(f.days[stormDay].score).toBeLessThan(days[stormDay].score - 20);
    expect(f.days[stormDay].highlights.some((h) => h.effect === 'bad')).toBe(true);
  });

  it('rewards a post-cold-front day', () => {
    const frontDay = 4;
    const wx = syntheticWeather({
      tweak: (h, i) => {
        const day = Math.floor(i / 24) - 2;
        if (day >= frontDay) {
          h.tempF -= 15;
          h.pressureHpa += 8;
        }
      },
    });
    const f = buildForecast({ lat: LAT, lon: LON, species: 'deer', weather: wx, normals: null, days: 6, now: NOW });
    expect(f.days[frontDay].score).toBeGreaterThan(days[frontDay].score);
    expect(bestDays(f.days, 1)[0].key).toBe(f.days[frontDay].key);
  });

  it('uses historical normals for temperature anomalies', () => {
    const normals = parseNormals({
      daily: {
        time: ['2025-11-20', '2025-11-25', '2025-11-28', '2025-12-01', '2025-12-05'],
        temperature_2m_max: [55, 55, 55, 55, 55],
        temperature_2m_min: [40, 40, 40, 40, 40],
      },
    });
    const f = buildForecast({ lat: LAT, lon: LON, species: 'deer', weather: syntheticWeather(), normals, days: 3, now: NOW });
    expect(f.days[1].tempAnomaly).toBeLessThan(-5); // synthetic ~35°F vs normal 47.5°F
    expect(f.days[1].highlights.some((h) => /colder|Temperature/.test(h.text))).toBe(true);
  });
});

describe('turkey scoring', () => {
  it('favors early morning in spring and hates wind', () => {
    const spring = Date.UTC(2026, 3, 20, 15);
    const mk = (wind: number) => {
      const start = localMidnight(spring, TZ) - 2 * DAY;
      const hours: HourWeather[] = Array.from({ length: 24 * 6 }, (_, i) => ({
        time: start + i * HOUR,
        tempF: 55,
        humidity: 60,
        pressureHpa: 1020,
        windMph: wind,
        gustMph: wind + 5,
        windDirDeg: 180,
        precipIn: 0,
        precipProb: 0,
        snowIn: 0,
        cloudCover: 10,
        weatherCode: 0,
      }));
      return buildForecast({ lat: LAT, lon: LON, species: 'turkey', weather: { timezone: TZ, hours, fetchedAt: spring }, normals: null, days: 2, now: spring });
    };
    const calm = mk(3);
    const windy = mk(22);
    const d = calm.days[1];
    expect(d.morning!.score).toBeGreaterThan(d.evening!.score);
    expect(localParts(d.morning!.start, TZ).hour).toBeLessThanOrEqual(7);
    expect(windy.days[1].score).toBeLessThan(d.score - 20);
  });
});

describe('zoned time parsing', () => {
  it('round-trips local wall-clock times', async () => {
    const { zonedToEpoch, epochToLocalInput } = await import('./time');
    const t = zonedToEpoch('2026-11-20T06:45', 'America/Chicago')!;
    expect(t).toBe(Date.UTC(2026, 10, 20, 12, 45));
    expect(epochToLocalInput(t, 'America/Chicago')).toBe('2026-11-20T06:45');
    expect(zonedToEpoch('2026-07-04T18:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 4, 22, 0));
  });
});
