import { useMemo, useState } from 'react';
import { useData } from '../lib/data/store';
import { newId, type AgeClass, type Deer } from '../lib/data/types';
import type { DayForecast } from '../lib/forecast';
import { distanceM } from '../lib/geo';
import { recommendForDeer } from '../lib/patterns';
import { huntability } from '../lib/scoring';
import { DAY, formatDay, formatTime } from '../lib/time';
import { useDeerAnalysis } from '../lib/useDeerAnalysis';
import { compass, type HourWeather } from '../lib/weather';
import { Lightbox, Photo } from './Photo';
import { scoreColor, WindArrow } from './ui';

interface ForecastCtx {
  days: DayForecast[];
  wx: Map<number, HourWeather>;
  tz: string;
  place: { lat: number; lon: number; name: string };
}

const AGE_LABEL: Record<AgeClass, string> = { young: 'Young (1.5–2.5)', 'mid-age': 'Mid-age (3.5)', mature: 'Mature (4.5+)', unknown: 'Age unknown' };

function ago(t: number) {
  const d = Math.floor((Date.now() - t) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

function DeerEditor({ deer, onDone }: { deer: Deer; onDone: () => void }) {
  const { save, remove, rows } = useData();
  const [d, setD] = useState(deer);
  const exists = rows.deer.some((x) => x.id === deer.id);
  return (
    <form
      className="card editor"
      onSubmit={async (e) => {
        e.preventDefault();
        await save('deer', d);
        onDone();
      }}
    >
      <input className="input" required placeholder="Name, e.g. Split G2 10-pt" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      <div className="seg">
        {(['buck', 'doe'] as const).map((s) => (
          <button type="button" key={s} className={d.sex === s ? 'active' : ''} onClick={() => setD({ ...d, sex: s })}>
            {s === 'buck' ? 'Buck' : 'Doe'}
          </button>
        ))}
      </div>
      <textarea className="input" rows={3} placeholder="Antlers and marks: e.g. split right G2, kicker off left brow, notched ear" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      <div className="row">
        <input className="input" type="number" min={0} max={40} placeholder="Points" value={d.points ?? ''} onChange={(e) => setD({ ...d, points: e.target.value ? Number(e.target.value) : null })} />
        <select className="input" value={d.age_class} onChange={(e) => setD({ ...d, age_class: e.target.value as AgeClass })}>
          {(Object.keys(AGE_LABEL) as AgeClass[]).map((a) => (
            <option key={a} value={a}>
              {AGE_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <select className="input" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as Deer['status'] })}>
        <option value="active">Active</option>
        <option value="harvested">Harvested 🎉</option>
        <option value="gone">Not seen anymore</option>
      </select>
      <label className="toggle">
        <input type="checkbox" checked={d.is_target} onChange={(e) => setD({ ...d, is_target: e.target.checked })} /> Target buck
      </label>
      <div className="row">
        <button className="btn primary">Save</button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
        {exists && (
          <button
            type="button"
            className="btn ghost danger"
            onClick={async () => {
              if (!confirm(`Delete ${d.name}? His photos stay in your photo log.`)) return;
              for (const s of rows.sightings.filter((s) => s.deer_id === d.id)) await save('sightings', { ...s, deer_id: null });
              await remove('deer', d.id);
              onDone();
            }}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function DeerDetail({ deer, fc, onBack }: { deer: Deer; fc: ForecastCtx; onBack: () => void }) {
  const { rows, save } = useData();
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const { sightings, pattern, status } = useDeerAnalysis(deer, fc.place);

  const cams = rows.cameras.filter((c) => sightings.some((s) => s.camera_id === c.id));
  const far = cams.find((c) => c.lat != null && c.lon != null && distanceM(c.lat, c.lon, fc.place.lat, fc.place.lon) > 30000);
  const recs = useMemo(
    () => (pattern ? recommendForDeer({ deer, pattern, days: fc.days, wx: fc.wx, cameras: rows.cameras, stands: rows.stands }) : []),
    [deer, pattern, fc.days, fc.wx, rows.cameras, rows.stands],
  );
  const ref = rows.sightings.find((s) => s.id === deer.reference_sighting_id) ?? sightings[sightings.length - 1];

  if (editing) return <DeerEditor deer={deer} onDone={() => setEditing(false)} />;

  return (
    <div className="deer-detail">
      <button className="btn ghost small" onClick={onBack}>
        ← All deer
      </button>
      <div className="card deer-head">
        {ref?.photo_path && <Photo path={ref.photo_path} alt={deer.name} className="deer-hero" onClick={() => setZoom(ref.photo_path!)} />}
        <div className="deer-title">
          <h2>
            {deer.name} {deer.is_target && <span className="target-star">★ Target</span>}
          </h2>
          <div className="small muted">
            {[deer.points ? `${deer.points} pts` : null, AGE_LABEL[deer.age_class], deer.status !== 'active' ? deer.status : null].filter(Boolean).join(' · ')}
          </div>
          {deer.description && <p className="small">{deer.description}</p>}
          <div className="row">
            <button className={`btn small ${deer.is_target ? '' : 'primary'}`} onClick={() => save('deer', { ...deer, is_target: !deer.is_target })}>
              {deer.is_target ? 'Remove target' : '★ Make target'}
            </button>
            <button className="btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
          </div>
        </div>
      </div>

      <section className="card">
        <h3>His pattern</h3>
        {status && <p className="small muted">{status}</p>}
        {pattern?.summary.map((line) => (
          <p key={line} className="small">
            {line}
          </p>
        ))}
        {pattern && pattern.cameras.length > 0 && (
          <p className="small">
            Cameras:{' '}
            {pattern.cameras
              .map((pc) => {
                const c = rows.cameras.find((x) => x.id === pc.cameraId);
                return `${c?.name ?? 'Unknown'} (${pc.n}${pc.daylight ? `, ${pc.daylight} daylight` : ''})`;
              })
              .join(', ')}
          </p>
        )}
        {pattern?.lastSeen && <p className="small muted">Last seen {ago(pattern.lastSeen)}.</p>}
      </section>

      <section className="card">
        <h3>Best chances to see him</h3>
        {far && <p className="small warn-text">His camera {far.name} is far from {fc.place.name}. Switch your location to that area for an accurate forecast.</p>}
        {recs.length === 0 ? (
          <p className="small muted">
            {pattern && pattern.confidence === 'none'
              ? 'Tag at least 3 photos of him to get recommendations.'
              : 'No recommendations yet. They need the hourly weather forecast to load.'}
          </p>
        ) : (
          recs.map((r, i) => (
            <div key={r.start} className="rec">
              <div className="rec-head">
                <span className="rank">#{i + 1}</span>
                <div className="rec-when">
                  <strong>{formatDay(r.start, fc.tz, { weekday: 'long' })}</strong>
                  <span>
                    {formatTime(r.start, fc.tz)} – {formatTime(r.end, fc.tz)}
                  </span>
                </div>
                <span className="rec-score" style={{ color: scoreColor(r.rating) }} title="How well this window matches his pattern and the conditions (1–10)">
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
                {r.camera ? `Near ${r.camera.name}. ` : ''}
                {r.setup}
              </div>
              <ul className="mini-highlights">
                {r.reasons.map((x) => (
                  <li key={x} className="good">
                    ▲ {x}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
        <p className="small muted">This rates how well each window's forecast matches the times and conditions he has shown up in before. It isn't a guarantee: mature bucks change patterns with hunting pressure and the rut.</p>
      </section>

      <section>
        <h3>Sightings ({sightings.length})</h3>
        <div className="gallery">
          {[...sightings].reverse().map((s) => (
            <figure key={s.id} onClick={() => s.photo_path && setZoom(s.photo_path)}>
              <Photo path={s.photo_path} alt={deer.name} />
              <figcaption>
                <strong>{rows.cameras.find((c) => c.id === s.camera_id)?.name ?? ''}</strong>
                <span>
                  {formatDay(Date.parse(s.taken_at), fc.tz, { weekday: undefined })} {formatTime(Date.parse(s.taken_at), fc.tz)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
      {zoom && <Lightbox path={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

export function Bucks({ fc, openId, onOpen }: { fc: ForecastCtx; openId: string | null; onOpen: (id: string | null) => void }) {
  const { rows } = useData();
  const [adding, setAdding] = useState<Deer | null>(null);
  const [show, setShow] = useState<'buck' | 'doe'>('buck');
  const open = rows.deer.find((d) => d.id === openId);
  if (open) return <DeerDetail deer={open} fc={fc} onBack={() => onOpen(null)} />;
  if (adding) return <DeerEditor deer={adding} onDone={() => setAdding(null)} />;

  const stats = (d: Deer) => {
    const s = rows.sightings.filter((x) => x.deer_id === d.id && x.status === 'confirmed');
    const last = s.reduce((m, x) => Math.max(m, Date.parse(x.taken_at)), 0);
    return { n: s.length, last, ref: rows.sightings.find((x) => x.id === d.reference_sighting_id) ?? s[s.length - 1] };
  };
  const list = rows.deer
    .filter((d) => d.sex === show)
    .map((d) => ({ d, ...stats(d) }))
    .sort((a, b) => Number(b.d.is_target) - Number(a.d.is_target) || Number(a.d.status !== 'active') - Number(b.d.status !== 'active') || b.last - a.last);
  const fresh = (d: Deer) => d.created_at && Date.now() - Date.parse(d.created_at) < 7 * DAY;

  return (
    <div className="bucks">
      <div className="section-head">
        <h2>{show === 'buck' ? 'Bucks' : 'Does'}</h2>
        <button className="btn small primary" onClick={() => setAdding({ id: newId(), name: '', sex: show, description: '', points: null, age_class: 'unknown', is_target: false, status: 'active', reference_sighting_id: null })}>
          + Add
        </button>
      </div>
      <div className="seg">
        <button className={show === 'buck' ? 'active' : ''} onClick={() => setShow('buck')}>
          Bucks
        </button>
        <button className={show === 'doe' ? 'active' : ''} onClick={() => setShow('doe')}>
          Does
        </button>
      </div>
      {list.length === 0 && (
        <p className="muted small">No {show}s yet. Add trail-cam photos on the Trail Cam tab, and choose "+ New {show} from this photo" to start a profile.</p>
      )}
      {list.map(({ d, n, last, ref }) => (
        <button key={d.id} className={`card deer-card ${d.status !== 'active' ? 'inactive' : ''}`} onClick={() => onOpen(d.id)}>
          <Photo path={ref?.photo_path ?? null} alt={d.name} className="deer-thumb" />
          <div className="deer-card-main">
            <strong>
              {d.name} {d.is_target && <span className="target-star">★</span>} {fresh(d) && <span className="pill new">New</span>}
            </strong>
            <span className="small muted">{[d.points ? `${d.points} pts` : null, d.age_class !== 'unknown' ? d.age_class : null, d.status !== 'active' ? d.status : null].filter(Boolean).join(' · ')}</span>
            <span className="small">
              {n} sighting{n === 1 ? '' : 's'}
              {last ? ` · last ${ago(last)}` : ''}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
