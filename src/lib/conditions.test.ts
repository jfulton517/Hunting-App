import { afterEach, describe, expect, it, vi } from 'vitest';
import { fillConditions } from './conditions';
import type { Camera, Sighting } from './data/types';
import { HOUR, MINUTE } from './time';

const NOW = Date.UTC(2026, 10, 26, 17, 58);
const cam: Camera = { id: 'c1', name: 'Water Through', place_id: null, lat: null, lon: null, notes: '' };
const sighting = (id: string, t: number): Sighting => ({ id, camera_id: 'c1', deer_id: null, taken_at: new Date(t).toISOString(), time_source: 'stamp', photo_path: null, kind: 'buck', status: 'confirmed', ai: null, weather: null, notes: '' });

function mockOpenMeteo() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const u = new URL(url);
      const s = Date.parse(u.searchParams.get('start_date') + 'T00:00:00Z');
      const e = Date.parse(u.searchParams.get('end_date') + 'T00:00:00Z') + 30 * HOUR;
      const time: number[] = [];
      for (let t = s; t < e; t += HOUR) time.push(t / 1000);
      const col = (v: number) => time.map(() => v);
      return new Response(JSON.stringify({ timezone: 'America/Chicago', hourly: { time, temperature_2m: col(41), relative_humidity_2m: col(60), pressure_msl: col(1015), wind_speed_10m: col(6), wind_direction_10m: col(300), wind_gusts_10m: col(10), precipitation: col(0), cloud_cover: col(20), weather_code: col(1) } }));
    }),
  );
}

describe('weather for photos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fills in weather for photos taken minutes ago (falls back to the hunting location)', async () => {
    mockOpenMeteo();
    const photos = [sighting('a', NOW - 53 * MINUTE), sighting('b', NOW - 47 * MINUTE)];
    const r = await fillConditions(photos, [cam], { lat: 40.69, lon: -89.59 }, undefined, NOW);
    expect(r.updated.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.updated[0].weather?.tempF).toBe(41);
    expect(r.noLocation + r.future + r.missing).toBe(0);
  });

  it('reports photos without any location, and future times, separately', async () => {
    mockOpenMeteo();
    const r = await fillConditions([sighting('a', NOW - HOUR), sighting('f', NOW + 3 * HOUR)], [cam], null, undefined, NOW);
    expect(r.updated).toEqual([]);
    expect(r.noLocation).toBe(1);
    expect(r.future).toBe(1);
  });
});
