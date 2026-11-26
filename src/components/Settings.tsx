import { useState } from 'react';
import { defaultRutPeak } from '../lib/season';
import { COMPASS_8, type Compass8 } from '../lib/weather';
import type { Stand } from '../lib/wind';

export interface AppSettings {
  weeks: number;
  rutPeak: string | null; // "MM-DD"
  stands: Stand[];
}

export function Settings({ settings, lat, onChange, onClose }: { settings: AppSettings; lat: number | null; onChange: (s: AppSettings) => void; onClose: () => void }) {
  const [newStand, setNewStand] = useState('');
  const auto = lat != null ? defaultRutPeak(lat, 2026) : null;
  const autoLabel = auto ? auto.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
  const set = (patch: Partial<AppSettings>) => onChange({ ...settings, ...patch });
  const toggleWind = (id: string, w: Compass8) =>
    set({ stands: settings.stands.map((s) => (s.id === id ? { ...s, winds: s.winds.includes(w) ? s.winds.filter((x) => x !== w) : [...s.winds, w] } : s)) });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <h3>How far ahead</h3>
        <div className="seg">
          {[2, 4, 6, 8].map((w) => (
            <button key={w} className={settings.weeks === w ? 'active' : ''} onClick={() => set({ weeks: w })}>
              {w} weeks
            </button>
          ))}
        </div>
        <p className="small muted">The first 16 days use the hourly weather forecast. Later days are scored on sun, moon, solunar, and season.</p>

        <h3>Peak rut date (whitetail)</h3>
        <p className="small muted">
          Estimated for your latitude: <strong>{autoLabel}</strong>. Southern ruts vary a lot by region, so if your state wildlife agency publishes a local breeding date, enter it here.
        </p>
        <div className="row">
          <input
            className="input"
            type="date"
            value={settings.rutPeak ? `2026-${settings.rutPeak}` : ''}
            onChange={(e) => set({ rutPeak: e.target.value ? e.target.value.slice(5) : null })}
          />
          {settings.rutPeak && (
            <button className="btn ghost" onClick={() => set({ rutPeak: null })}>
              Use estimate
            </button>
          )}
        </div>

        <h3>My stands & blinds</h3>
        <p className="small muted">Pick the wind directions (where the wind blows FROM) each stand can be hunted on. The app flags which stands fit the wind during each day's best windows.</p>
        {settings.stands.map((s) => (
          <div key={s.id} className="stand">
            <div className="stand-head">
              <strong>{s.name}</strong>
              <button className="btn ghost small" onClick={() => set({ stands: settings.stands.filter((x) => x.id !== s.id) })}>
                Remove
              </button>
            </div>
            <div className="wind-picks">
              {COMPASS_8.map((w) => (
                <button key={w} className={s.winds.includes(w) ? 'active' : ''} onClick={() => toggleWind(s.id, w)}>
                  {w}
                </button>
              ))}
            </div>
          </div>
        ))}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newStand.trim()) return;
            set({ stands: [...settings.stands, { id: crypto.randomUUID?.() ?? String(Date.now()), name: newStand.trim(), winds: [] }] });
            setNewStand('');
          }}
        >
          <input className="input" placeholder="Stand name, e.g. Creek Bottom" value={newStand} onChange={(e) => setNewStand(e.target.value)} />
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>

        <h3>How scores work</h3>
        <p className="small">
          Each hour's score is <em>activity</em> × <em>weather</em> × <em>season</em>. Activity comes from time of day relative to sunrise and sunset, solunar periods (moon overhead or underfoot are major periods, moonrise and moonset are minor ones), and moon phase. Weather covers barometric pressure and its trend, temperature against the
          historical normal (cold snaps and cold fronts are top deer triggers), wind speed, and precipitation. Season scales everything by rut phase or turkey breeding phase. Tap any hour to see the breakdown.
        </p>
        <p className="small muted">Legal shooting hours shown are typical (30 min before sunrise to 30 min after sunset for deer, and to sunset for turkey). Always confirm your state's regulations.</p>
      </div>
    </div>
  );
}
