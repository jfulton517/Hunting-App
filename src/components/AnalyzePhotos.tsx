import { useState } from 'react';
import { fillConditions } from '../lib/conditions';
import { useData } from '../lib/data/store';
import type { Sighting } from '../lib/data/types';
import { readStamp } from '../lib/stamp';
import { zonedToEpoch } from '../lib/time';

/**
 * Reads the date/time stamp on photos that don't have a reliable time yet (free, on the
 * phone), then looks up the weather at the moment each photo was taken.
 */
export function AnalyzePhotos({ tz, fallback }: { tz: string; fallback: { lat: number; lon: number } | null }) {
  const { rows, repo, saveMany } = useData();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsTime = rows.sightings.filter((s) => s.time_source === 'file' && s.photo_path);
  const needsWeather = rows.sightings.filter((s) => !s.weather && s.kind !== 'none');
  const total = new Set([...needsTime, ...needsWeather].map((s) => s.id)).size;
  if (!total && !status) return null;

  const run = async () => {
    setBusy(true);
    try {
      // 1) Date/time stamps
      const fixed: Sighting[] = []; // waiting to be saved
      const allFixed: Sighting[] = [];
      let unreadable = 0;
      for (let i = 0; i < needsTime.length; i++) {
        const s = needsTime[i];
        setStatus(`Reading date stamps: ${i + 1} of ${needsTime.length}…`);
        try {
          const url = await repo.photoUrl(s.photo_path!);
          const blob = url ? await (await fetch(url)).blob() : null;
          const r = blob ? await readStamp(blob) : null;
          const t = r ? zonedToEpoch(r.local, tz) : null;
          if (t) {
            const f: Sighting = { ...s, taken_at: new Date(t).toISOString(), time_source: 'stamp', weather: null };
            fixed.push(f);
            allFixed.push(f);
          }
          else unreadable++;
        } catch {
          unreadable++;
        }
        if (fixed.length && (fixed.length % 25 === 0 || i === needsTime.length - 1)) await saveMany('sightings', fixed.splice(0));
      }
      if (fixed.length) await saveMany('sightings', fixed);

      // 2) Weather at each photo's time (uses the corrected times).
      setStatus('Looking up the weather for each photo…');
      const latest = new Map(rows.sightings.map((s) => [s.id, s]));
      for (const f of allFixed) latest.set(f.id, f);
      const todo = [...latest.values()].filter((s) => !s.weather && s.kind !== 'none' && (s.time_source !== 'file' || !s.photo_path));
      const { updated, missing } = await fillConditions(todo, rows.cameras, fallback, (d, n) => setStatus(`Matching weather: ${d} of ${n}…`));
      if (updated.length) await saveMany('sightings', updated);

      const parts = [`Done. ${updated.length} photo${updated.length === 1 ? ' now has' : 's now have'} weather conditions.`];
      if (needsTime.length) parts.push(`Read the date stamp on ${needsTime.length - unreadable} of ${needsTime.length}.`);
      if (unreadable) parts.push(`${unreadable} stamp${unreadable === 1 ? " couldn't" : "s couldn't"} be read. Check those times on the photo cards below.`);
      if (missing) parts.push(`${missing} need${missing === 1 ? 's' : ''} a camera location or a time that's not in the future.`);
      setStatus(parts.join(' '));
    } catch (e) {
      setStatus(`Analysis stopped: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card analyze">
      <h3>Analyze photos</h3>
      {total > 0 && (
        <p className="small">
          {needsTime.length > 0 && (
            <>
              <strong>{needsTime.length}</strong> photo{needsTime.length === 1 ? '' : 's'} need the date/time read from the stamp.{' '}
            </>
          )}
          {needsWeather.length > 0 && (
            <>
              <strong>{needsWeather.length}</strong> need weather conditions (temperature, wind, pressure, moon).
            </>
          )}
        </p>
      )}
      {total > 0 && (
        <button className="btn primary block" disabled={busy} onClick={run}>
          {busy ? 'Analyzing…' : `Analyze ${total} photo${total === 1 ? '' : 's'}`}
        </button>
      )}
      <p className="small muted">This is free: date stamps are read on your phone, and the weather comes from historical records for each camera's location.</p>
      {status && <p className="small">{status}</p>}
    </section>
  );
}
