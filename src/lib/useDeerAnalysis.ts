import { useEffect, useMemo, useState } from 'react';
import { useData } from './data/store';
import type { Deer, Sighting, SightingConditions } from './data/types';
import { conditionsAt, fetchHourlyHistory } from './history';
import { learnPattern, type DeerPattern, type PatternObs } from './patterns';
import { DAY, HOUR } from './time';
import type { HourWeather } from './weather';

// Past weather is fetched once per area per session.
const historyCache = new Map<string, Promise<HourWeather[]>>();
function history(lat: number, lon: number, start: number, end: number) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.floor(start / DAY)},${Math.floor(end / DAY)}`;
  if (!historyCache.has(key)) historyCache.set(key, fetchHourlyHistory(lat, lon, start, end).catch((e) => (historyCache.delete(key), Promise.reject(e))));
  return historyCache.get(key)!;
}

/**
 * Pattern for one deer: fills in weather for any sightings that don't have it yet,
 * builds the background of conditions over the same period, then learns the pattern.
 */
export function useDeerAnalysis(deer: Deer | null, fallback: { lat: number; lon: number } | null) {
  const { rows, save } = useData();
  const [background, setBackground] = useState<SightingConditions[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const sightings = useMemo(
    () => (deer ? rows.sightings.filter((s) => s.deer_id === deer.id && s.status === 'confirmed').sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at)) : []),
    [deer, rows.sightings],
  );
  const where = (s: Sighting) => {
    const cam = rows.cameras.find((c) => c.id === s.camera_id);
    return cam?.lat != null && cam.lon != null ? { lat: cam.lat, lon: cam.lon } : fallback;
  };

  // Key that changes only when the set of sightings (or their times) changes.
  const sig = sightings.map((s) => `${s.id}:${s.taken_at}:${s.weather ? 1 : 0}`).join('|');

  useEffect(() => {
    if (!deer || !sightings.length) {
      setBackground([]);
      return;
    }
    const loc = where(sightings[sightings.length - 1]);
    if (!loc) {
      setStatus('Set locations for your cameras (or pick a hunting location) to analyze conditions.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setStatus('Looking up the weather at each sighting…');
        const now = Date.now();
        const first = Date.parse(sightings[0].taken_at);
        const start = Math.min(first, now - 45 * DAY);
        const hours = await history(loc.lat, loc.lon, start, now);
        const map = new Map(hours.map((h) => [h.time, h]));
        // Fill in conditions for sightings that are missing them.
        for (const s of sightings) {
          if (s.weather) continue;
          const l = where(s) ?? loc;
          const c = conditionsAt(Date.parse(s.taken_at), l.lat, l.lon, map);
          if (c) await save('sightings', { ...s, weather: c });
        }
        // Background: every 3rd hour across the period.
        const bg: SightingConditions[] = [];
        for (let t = Math.ceil(start / HOUR) * HOUR + DAY; t < now - HOUR; t += 3 * HOUR) {
          const c = conditionsAt(t, loc.lat, loc.lon, map);
          if (c) bg.push(c);
        }
        if (!cancelled) {
          setBackground(bg);
          setStatus(null);
        }
      } catch (e) {
        if (!cancelled) setStatus(`Couldn't load past weather (${(e as Error).message}). Showing a time-of-day pattern only.`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deer?.id, sig, fallback?.lat, fallback?.lon]);

  const pattern: DeerPattern | null = useMemo(() => {
    if (!deer) return null;
    const obs: PatternObs[] = sightings.filter((s) => s.weather).map((s) => ({ t: Date.parse(s.taken_at), cameraId: s.camera_id, c: s.weather! }));
    return learnPattern(obs, background);
  }, [deer, sightings, background]);

  return { sightings, pattern, status };
}
