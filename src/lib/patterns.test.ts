import { describe, expect, it } from 'vitest';
import type { Camera, Deer, SightingConditions, Stand } from './data/types';
import { buildForecast } from './forecast';
import { learnPattern, recommendForDeer, timeBin, type PatternObs } from './patterns';
import { DAY, HOUR, localMidnight, localParts } from './time';
import type { HourWeather } from './weather';

const TZ = 'America/Chicago';
const NOW = Date.UTC(2026, 10, 26, 15);
const CAM: Camera = { id: 'cam-a', name: 'Ridge Cam', place_id: 'p', lat: 40.1, lon: -88.9, notes: '' };
const deer: Deer = { id: 'd1', name: 'Split G2', sex: 'buck', description: '', points: 10, age_class: 'mature', is_target: true, status: 'active', reference_sighting_id: null };

const cond = (over: Partial<SightingConditions>): SightingConditions => ({
  tempF: 35,
  tempChange24h: 0,
  windMph: 8,
  windDirDeg: 180,
  pressureHpa: 1018,
  pressureTrend3h: 0,
  cloudCover: 50,
  moonIllumination: 0.5,
  minutesFromSunrise: 300,
  minutesFromSunset: 300,
  ...over,
});

// Background: a month of hours with winds spread evenly around the compass.
const background: SightingConditions[] = Array.from({ length: 24 * 30 }, (_, i) =>
  cond({ windDirDeg: (i * 45) % 360, minutesFromSunrise: (i % 24) * 60 - 7 * 60, minutesFromSunset: 17 * 60 - (i % 24) * 60, pressureTrend3h: [-1, 0, 1][i % 3] }),
);

const dawnNW = (i: number): PatternObs => ({
  t: NOW - (i + 1) * 2 * DAY,
  cameraId: 'cam-a',
  c: cond({ windDirDeg: 315, minutesFromSunrise: 20, minutesFromSunset: 560, pressureTrend3h: 1.2 }),
});

describe('pattern learning', () => {
  it('classifies time of day', () => {
    expect(timeBin({ minutesFromSunrise: 10, minutesFromSunset: 600 })).toBe('dawn');
    expect(timeBin({ minutesFromSunrise: 500, minutesFromSunset: 60 })).toBe('dusk');
    expect(timeBin({ minutesFromSunrise: 300, minutesFromSunset: 300 })).toBe('midday');
    expect(timeBin({ minutesFromSunrise: -200, minutesFromSunset: 900 })).toBe('night');
  });

  it('finds a dawn, NW-wind, rising-pressure buck', () => {
    const obs = [...Array.from({ length: 7 }, (_, i) => dawnNW(i)), { t: NOW - 30 * DAY, cameraId: 'cam-a', c: cond({ windDirDeg: 180, minutesFromSunrise: -300, minutesFromSunset: 1000 }) }];
    const p = learnPattern(obs, background, NOW);
    expect(p.n).toBe(8);
    expect(p.daylight).toBe(7);
    expect(p.confidence).toBe('medium');
    expect(p.time.dawn.ratio).toBeGreaterThan(2);
    expect(p.wind.NW.ratio).toBeGreaterThan(2);
    expect(p.wind.S.ratio).toBeLessThan(1.2);
    expect(p.pressure.rising.ratio).toBeGreaterThan(1.5);
    expect(p.summary.join(' ')).toMatch(/dawn/);
    expect(p.summary.join(' ')).toMatch(/NW/);
  });

  it('shrinks toward no preference with little data', () => {
    const p = learnPattern([dawnNW(0)], background, NOW);
    expect(p.confidence).toBe('none');
    expect(p.wind.NW.ratio).toBeLessThan(2.2);
  });

  it('calls out a night-only buck', () => {
    const obs = Array.from({ length: 4 }, (_, i) => ({ t: NOW - i * DAY, cameraId: 'cam-a', c: cond({ minutesFromSunrise: -240, minutesFromSunset: 900 }) }));
    expect(learnPattern(obs, background, NOW).summary.join(' ')).toMatch(/at night/);
  });
});

describe('target buck recommendations', () => {
  // Forecast: alternate days of NW and S wind.
  const start = localMidnight(NOW, TZ) - 2 * DAY;
  const hours: HourWeather[] = Array.from({ length: 24 * 12 }, (_, i) => {
    const t = start + i * HOUR;
    const day = Math.floor(i / 24);
    return {
      time: t,
      tempF: 38,
      humidity: 70,
      pressureHpa: 1018 + (day % 2 === 0 ? (i % 24) * 0.3 : 0),
      windMph: 7,
      gustMph: 12,
      windDirDeg: day % 2 === 0 ? 315 : 180,
      precipIn: 0,
      precipProb: 0,
      snowIn: 0,
      cloudCover: 40,
      weatherCode: 2,
    };
  });
  const wxMap = new Map(hours.map((h) => [h.time, h]));
  const { days } = buildForecast({ lat: 40.1, lon: -88.9, species: 'deer', weather: { timezone: TZ, hours, fetchedAt: NOW }, normals: null, days: 9, now: NOW });
  const pattern = learnPattern(Array.from({ length: 8 }, (_, i) => dawnNW(i)), background, NOW);

  // NW-wind stand 150 m south-east of the camera (downwind on a NW wind) and a S-wind stand.
  const standNW: Stand = { id: 's1', name: 'Oak Flat', place_id: 'p', lat: 40.099, lon: -88.8988, winds: ['NW', 'N'], kind: 'stand', notes: '' };
  const standS: Stand = { id: 's2', name: 'South Ladder', place_id: 'p', lat: 40.1012, lon: -88.9, winds: ['S'], kind: 'stand', notes: '' };

  const recs = recommendForDeer({ deer, pattern, days, wx: wxMap, cameras: [CAM], stands: [standS, standNW] });

  it('ranks NW-wind mornings first', () => {
    expect(recs.length).toBeGreaterThan(2);
    const top = recs[0];
    expect(localParts(top.start, TZ).hour).toBeLessThan(10);
    expect(Math.round(top.windDeg!)).toBe(315);
  });

  it('places the hunter at a stand that suits the wind and stays downwind of his camera', () => {
    expect(recs[0].camera?.id).toBe('cam-a');
    expect(recs[0].stand?.id).toBe('s1');
    expect(recs[0].reasons.join(' ')).toMatch(/NW wind/);
  });

  it('gives setup advice when no stand fits the wind', () => {
    const r = recommendForDeer({ deer, pattern, days, wx: wxMap, cameras: [CAM], stands: [standS], limit: 9 });
    const nw = r.find((x) => Math.round(x.windDeg!) === 315)!;
    expect(nw.stand).toBeNull();
    expect(nw.setup).toMatch(/downwind/);
  });

  it('makes no recommendations without enough sightings', () => {
    expect(recommendForDeer({ deer, pattern: learnPattern([dawnNW(0)], background, NOW), days, wx: wxMap, cameras: [CAM], stands: [] })).toEqual([]);
  });
});
