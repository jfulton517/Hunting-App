import { useEffect, useMemo, useState } from 'react';
import { fillConditions, sightingLocation } from './conditions';
import { useData } from './data/store';
import type { Deer, Sighting, SightingConditions } from './data/types';
import { cachedHistory, conditionsAt } from './history';
import { learnPattern, type DeerPattern, type PatternObs } from './patterns';
import { DAY, HOUR } from './time';

/**
 * Learn a movement pattern from a set of sightings (one buck, or every buck on a camera).
 * Fills in weather for sightings that don't have it yet, builds the background of conditions
 * over the same period, then learns the pattern.
 */
export function useSightingPattern(sightings: Sighting[], fallback: { lat: number; lon: number } | null) {
  const { rows, saveMany } = useData();
  const [background, setBackground] = useState<SightingConditions[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  // Key that changes only when the set of sightings (or their times) changes.
  const sig = sightings.map((s) => `${s.id}:${s.taken_at}:${s.weather ? 1 : 0}`).join('|');

  useEffect(() => {
    if (!sightings.length) {
      setBackground([]);
      setStatus(null);
      return;
    }
    const loc = sightingLocation(sightings[sightings.length - 1], rows.cameras, fallback);
    if (!loc) {
      setStatus('Set locations for your cameras (or pick a hunting location) to analyze conditions.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (sightings.some((s) => !s.weather)) {
          setStatus('Looking up the weather at each sighting…');
          const { updated } = await fillConditions(sightings, rows.cameras, fallback);
          if (updated.length) await saveMany('sightings', updated);
        }
        // Background: every 3rd hour across the period, to know which conditions were common.
        const now = Date.now();
        const start = Math.min(Date.parse(sightings[0].taken_at), now - 45 * DAY);
        const hours = await cachedHistory(loc.lat, loc.lon, start, now);
        const map = new Map(hours.map((h) => [h.time, h]));
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
  }, [sig, fallback?.lat, fallback?.lon]);

  const pattern: DeerPattern = useMemo(() => {
    const obs: PatternObs[] = sightings.filter((s) => s.weather).map((s) => ({ t: Date.parse(s.taken_at), cameraId: s.camera_id, c: s.weather! }));
    return learnPattern(obs, background);
  }, [sightings, background]);

  return { pattern, status };
}

/** Pattern for one deer from his confirmed sightings. */
export function useDeerAnalysis(deer: Deer | null, fallback: { lat: number; lon: number } | null) {
  const { rows } = useData();
  const sightings = useMemo(
    () => (deer ? rows.sightings.filter((s) => s.deer_id === deer.id && s.status === 'confirmed').sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at)) : []),
    [deer, rows.sightings],
  );
  const { pattern, status } = useSightingPattern(sightings, fallback);
  return { sightings, pattern: deer ? pattern : null, status };
}
