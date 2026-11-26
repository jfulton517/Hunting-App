import { useMemo } from 'react';
import { useData } from '../lib/data/store';
import type { Camera } from '../lib/data/types';
import type { DayForecast } from '../lib/forecast';
import { recommendForDeer } from '../lib/patterns';
import { huntability } from '../lib/scoring';
import { formatDay, formatTime } from '../lib/time';
import { useSightingPattern } from '../lib/useDeerAnalysis';
import { compass, type HourWeather } from '../lib/weather';
import { scoreColor, WindArrow } from './ui';

export interface ForecastCtx {
  days: DayForecast[];
  wx: Map<number, HourWeather>;
  tz: string;
  place: { lat: number; lon: number; name: string };
}

/** Buck activity on one camera: when and in what weather bucks show up, and the best upcoming windows. */
export function CameraInsights({ camera, fc }: { camera: Camera; fc: ForecastCtx }) {
  const { rows } = useData();
  const bucks = useMemo(
    () => rows.sightings.filter((s) => s.camera_id === camera.id && s.status === 'confirmed' && s.kind === 'buck').sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at)),
    [rows.sightings, camera.id],
  );
  const deer = useMemo(
    () => rows.sightings.filter((s) => s.camera_id === camera.id && s.status === 'confirmed' && ['buck', 'doe', 'fawn'].includes(s.kind)).sort((a, b) => Date.parse(a.taken_at) - Date.parse(b.taken_at)),
    [rows.sightings, camera.id],
  );
  // Use buck photos when there are enough; otherwise all deer activity.
  const useBucks = bucks.length >= 3;
  const set = useBucks ? bucks : deer;
  const { pattern, status } = useSightingPattern(set, fc.place);
  const recs = useMemo(
    () => recommendForDeer({ pattern, days: fc.days, wx: fc.wx, cameras: rows.cameras, stands: rows.stands, limit: 3 }),
    [pattern, fc.days, fc.wx, rows.cameras, rows.stands],
  );
  const subject = useBucks ? 'buck' : 'deer';

  return (
    <section className="card">
      <h3>
        {useBucks ? 'Buck' : 'Deer'} activity on {camera.name}
      </h3>
      {status && <p className="small muted">{status}</p>}
      {set.length === 0 ? (
        <p className="small muted">Confirm some photos from this camera (Buck, Doe, or Fawn) to see when deer move here.</p>
      ) : (
        pattern.summary.map((line) => (
          <p key={line} className="small">
            {line.replace(/ confirmed sighting/, ` confirmed ${subject} photo`)}
          </p>
        ))
      )}
      {recs.length > 0 && (
        <>
          <h3>Best upcoming times here</h3>
          {recs.map((r, i) => (
            <div key={r.start} className="rec">
              <div className="rec-head">
                <span className="rank">#{i + 1}</span>
                <div className="rec-when">
                  <strong>{formatDay(r.start, fc.tz, { weekday: 'long' })}</strong>
                  <span>
                    {formatTime(r.start, fc.tz)} – {formatTime(r.end, fc.tz)}
                  </span>
                </div>
                <span className="rec-score" style={{ color: scoreColor(r.rating) }}>
                  {huntability(r.rating)}
                </span>
              </div>
              <div className="small">
                {r.windDeg != null && (
                  <span className="inline-wind">
                    <WindArrow deg={r.windDeg} size={12} /> {compass(r.windDeg)} wind
                  </span>
                )}
                {r.windDeg != null && ' · '}
                {r.setup}
              </div>
              <ul className="mini-highlights">
                {r.reasons.map((x) => (
                  <li key={x} className="good">
                    ▲ {x.replace(/^He's been seen/, `${subject === 'buck' ? 'Bucks have' : 'Deer have'} been seen`).replace(/ of his sightings/, ` of the ${subject} photos here`).replace(/which he's moved on/, 'which they have moved on')}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
