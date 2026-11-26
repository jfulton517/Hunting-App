import { useState } from 'react';
import { useData } from '../lib/data/store';
import { newId, type AiTier, type Camera, type SavedPlace, type Stand } from '../lib/data/types';
import { getDevicePosition } from '../lib/location';
import { defaultRutPeak } from '../lib/season';
import { COMPASS_8, type Compass8 } from '../lib/weather';

function CoordsField({ lat, lon, onChange }: { lat: number | null; lon: number | null; onChange: (lat: number | null, lon: number | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="coords">
      <div className="row">
        <input className="input" inputMode="decimal" placeholder="Latitude" value={lat ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value), lon)} />
        <input className="input" inputMode="decimal" placeholder="Longitude" value={lon ?? ''} onChange={(e) => onChange(lat, e.target.value === '' ? null : Number(e.target.value))} />
      </div>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const p = await getDevicePosition();
            onChange(Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6)));
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Locating…' : '📍 Use my current location'}
      </button>
      {err && <p className="error small">{err}</p>}
    </div>
  );
}

function WindPicks({ value, onChange }: { value: Compass8[]; onChange: (v: Compass8[]) => void }) {
  return (
    <div className="wind-picks">
      {COMPASS_8.map((w) => (
        <button type="button" key={w} className={value.includes(w) ? 'active' : ''} onClick={() => onChange(value.includes(w) ? value.filter((x) => x !== w) : [...value, w])}>
          {w}
        </button>
      ))}
    </div>
  );
}

function PlaceSelect({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const { rows } = useData();
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No hunting place</option>
      {rows.places.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {hint && <p className="small muted">{hint}</p>}
      {children}
    </section>
  );
}

function PlacesSection() {
  const { rows, save, remove } = useData();
  const [draft, setDraft] = useState<SavedPlace | null>(null);
  const setPrimary = async (id: string) => {
    for (const p of rows.places) if (p.is_primary !== (p.id === id)) await save('places', { ...p, is_primary: p.id === id });
  };
  return (
    <Section title="Hunting places" hint="Farms, leases, or public land you hunt. Your primary place opens by default.">
      {rows.places.map((p) => (
        <div key={p.id} className="list-row">
          <div>
            <strong>{p.name}</strong> {p.is_primary && <span className="pill phase">Primary</span>}
            <div className="small muted">
              {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
            </div>
          </div>
          <div className="row">
            {!p.is_primary && (
              <button className="btn small" onClick={() => setPrimary(p.id)}>
                Make primary
              </button>
            )}
            <button className="btn small" onClick={() => setDraft(p)}>
              Edit
            </button>
          </div>
        </div>
      ))}
      {draft ? (
        <form
          className="editor"
          onSubmit={async (e) => {
            e.preventDefault();
            if (draft.lat == null || draft.lon == null) return;
            await save('places', { ...draft, is_primary: draft.is_primary || rows.places.length === 0 });
            setDraft(null);
          }}
        >
          <input className="input" placeholder="Name, e.g. Back 40" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <CoordsField lat={draft.lat} lon={draft.lon} onChange={(lat, lon) => setDraft({ ...draft, lat: lat as number, lon: lon as number })} />
          <div className="row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {rows.places.some((p) => p.id === draft.id) && (
              <button type="button" className="btn ghost danger" onClick={() => { remove('places', draft.id); setDraft(null); }}>
                Delete
              </button>
            )}
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setDraft({ id: newId(), name: '', lat: null as unknown as number, lon: null as unknown as number, is_primary: false })}>
          + Add hunting place
        </button>
      )}
    </Section>
  );
}

function StandsSection() {
  const { rows, save, remove } = useData();
  const [draft, setDraft] = useState<Stand | null>(null);
  return (
    <Section title="Stands & blinds" hint="Choose the wind directions (where the wind blows FROM) each stand can be hunted on. With a location set, the app can also check that your scent won't blow toward the cameras your target buck uses.">
      {rows.stands.map((s) => (
        <div key={s.id} className="list-row">
          <div>
            <strong>{s.name}</strong> <span className="muted small">{s.kind}</span>
            <div className="small muted">
              {s.winds.length ? `Winds: ${s.winds.join(', ')}` : 'No winds chosen'}
              {s.lat == null && ' · no location'}
            </div>
          </div>
          <button className="btn small" onClick={() => setDraft(s)}>
            Edit
          </button>
        </div>
      ))}
      {draft ? (
        <form
          className="editor"
          onSubmit={async (e) => {
            e.preventDefault();
            await save('stands', draft);
            setDraft(null);
          }}
        >
          <input className="input" placeholder="Name, e.g. Creek Bottom" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="seg">
            {(['stand', 'blind'] as const).map((k) => (
              <button type="button" key={k} className={draft.kind === k ? 'active' : ''} onClick={() => setDraft({ ...draft, kind: k })}>
                {k === 'stand' ? 'Tree stand' : 'Ground blind'}
              </button>
            ))}
          </div>
          <PlaceSelect value={draft.place_id} onChange={(place_id) => setDraft({ ...draft, place_id })} />
          <span className="small">Good winds</span>
          <WindPicks value={draft.winds} onChange={(winds) => setDraft({ ...draft, winds })} />
          <span className="small">Location</span>
          <CoordsField lat={draft.lat} lon={draft.lon} onChange={(lat, lon) => setDraft({ ...draft, lat, lon })} />
          <input className="input" placeholder="Notes (optional)" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {rows.stands.some((s) => s.id === draft.id) && (
              <button type="button" className="btn ghost danger" onClick={() => { remove('stands', draft.id); setDraft(null); }}>
                Delete
              </button>
            )}
          </div>
        </form>
      ) : (
        <button
          className="btn block"
          onClick={() => setDraft({ id: newId(), name: '', place_id: rows.places.find((p) => p.is_primary)?.id ?? null, lat: null, lon: null, winds: [], kind: 'stand', notes: '' })}
        >
          + Add stand or blind
        </button>
      )}
    </Section>
  );
}

export function CamerasSection() {
  const { rows, save, remove } = useData();
  const [draft, setDraft] = useState<Camera | null>(null);
  return (
    <Section title="Trail cameras" hint="Add each Strike Force camera and set its location by standing at it and tapping Use my current location.">
      {rows.cameras.map((c) => (
        <div key={c.id} className="list-row">
          <div>
            <strong>{c.name}</strong>
            <div className="small muted">
              {rows.sightings.filter((s) => s.camera_id === c.id).length} photos
              {c.stand_id && rows.stands.find((s) => s.id === c.stand_id) ? ` · hunting spot: ${rows.stands.find((s) => s.id === c.stand_id)!.name}` : ' · no hunting spot'}
              {c.lat == null && ' · no location'}
            </div>
          </div>
          <button className="btn small" onClick={() => setDraft(c)}>
            Edit
          </button>
        </div>
      ))}
      {draft ? (
        <form
          className="editor"
          onSubmit={async (e) => {
            e.preventDefault();
            await save('cameras', draft);
            setDraft(null);
          }}
        >
          <input className="input" placeholder="Name, e.g. Ridge Scrape Cam" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className="field">
            <span>Hunting spot (stand or blind) this camera watches</span>
            <select className="input" value={draft.stand_id ?? ''} onChange={(e) => setDraft({ ...draft, stand_id: e.target.value || null })}>
              <option value="">Not assigned</option>
              {rows.stands.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <PlaceSelect value={draft.place_id} onChange={(place_id) => setDraft({ ...draft, place_id })} />
          <CoordsField lat={draft.lat} lon={draft.lon} onChange={(lat, lon) => setDraft({ ...draft, lat, lon })} />
          <input className="input" placeholder="Notes, e.g. over mock scrape" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="row">
            <button className="btn primary">Save</button>
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {rows.cameras.some((c) => c.id === draft.id) && (
              <button type="button" className="btn ghost danger" onClick={() => { remove('cameras', draft.id); setDraft(null); }}>
                Delete
              </button>
            )}
          </div>
        </form>
      ) : (
        <button className="btn block" onClick={() => setDraft({ id: newId(), name: '', place_id: rows.places.find((p) => p.is_primary)?.id ?? null, lat: null, lon: null, notes: '' })}>
          + Add trail camera
        </button>
      )}
    </Section>
  );
}

const TIERS: { value: AiTier; name: string; price: string; detail: string }[] = [
  { value: 'off', name: 'Free', price: '$0', detail: 'You pick which buck is in each photo. Pattern learning and target-buck recommendations work the same.' },
  { value: 'basic', name: 'Basic AI', price: '≈ $1–2 per 1,000 photos', detail: 'A smaller, faster Claude model sorts photos (buck, doe, empty) and reads the date and time stamp. It is less reliable at telling similar bucks apart.' },
  { value: 'pro', name: 'Pro AI', price: '≈ 3–8¢ per photo', detail: 'Claude Opus compares antlers against your known bucks, flags new bucks, and reads the date and time stamp.' },
];

function AiUpgradeSection() {
  const { auth, repo, settings, setSettings } = useData();
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const signedIn = auth === 'signed-in';
  return (
    <Section title="Upgrade: AI photo identification" hint="Optional. The app is free without it. AI usage is billed by Anthropic to your own API account, with a spending limit you set.">
      <div className="tiers">
        {TIERS.map((t) => (
          <button
            key={t.value}
            className={`tier ${settings.aiTier === t.value ? 'active' : ''}`}
            disabled={!signedIn && t.value !== 'off'}
            onClick={() => {
              setSettings({ ...settings, aiTier: t.value });
              setCheck(null);
            }}
          >
            <span className="tier-head">
              <strong>{t.name}</strong>
              <span className="tier-price">{t.price}</span>
            </span>
            <span className="small muted">{t.detail}</span>
          </button>
        ))}
      </div>
      {!signedIn && <p className="small muted">AI upgrades need accounts to be switched on (SETUP.md, Part 1).</p>}
      {signedIn && settings.aiTier !== 'off' && (
        <>
          <p className="small">
            One-time setup: add your Anthropic API key to Supabase (SETUP.md, Part 2). Then test it here.
          </p>
          <button
            className="btn small"
            disabled={checking || !repo.checkAi}
            onClick={async () => {
              setChecking(true);
              try {
                setCheck(await repo.checkAi!());
              } finally {
                setChecking(false);
              }
            }}
          >
            {checking ? 'Checking…' : 'Test AI setup'}
          </button>
          {check && <p className={check.ok ? 'small ok-text' : 'small warn-text'}>{check.ok ? '✓ ' : ''}{check.message}</p>}
        </>
      )}
    </Section>
  );
}

export function Account({ lat }: { lat: number | null }) {
  const { auth, email, signOut, settings, setSettings, localCount, importLocal, pendingSync } = useData();
  const [importing, setImporting] = useState<string | null>(null);
  const auto = lat != null ? defaultRutPeak(lat, 2026) : null;
  const autoLabel = auto ? auto.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';

  return (
    <div className="account">
      <Section title="Account">
        {auth === 'signed-in' ? (
          <>
            <p className="small">
              Signed in as <strong>{email}</strong>
            </p>
            {localCount > 0 && (
              <div className="banner">
                {localCount} records are saved on this phone from before you signed in.{' '}
                <button
                  className="btn small primary"
                  disabled={!!importing}
                  onClick={async () => {
                    setImporting('Copying…');
                    try {
                      setImporting(`Copied ${await importLocal()} records to your account.`);
                    } catch (e) {
                      setImporting(`Copy failed: ${(e as Error).message}`);
                    }
                  }}
                >
                  Copy to my account
                </button>
                {importing && <div className="small">{importing}</div>}
              </div>
            )}
            <button
              className="btn"
              onClick={() => {
                if (pendingSync > 0 && !confirm(`${pendingSync} change${pendingSync === 1 ? " hasn't" : "s haven't"} synced yet. They stay on this phone and sync next time you sign in here. Sign out anyway?`)) return;
                signOut();
              }}
            >
              Sign out
            </button>
          </>
        ) : (
          <p className="small muted">Accounts aren't switched on yet, so everything is saved on this phone only. AI photo identification also needs accounts. See SETUP.md in the project.</p>
        )}
      </Section>

      <AiUpgradeSection />

      <Section title="Forecast range" hint="The first 16 days use the hourly weather forecast. Later days are scored on sun, moon, solunar, and season.">
        <div className="seg">
          {[2, 4, 6, 8].map((w) => (
            <button key={w} className={settings.weeks === w ? 'active' : ''} onClick={() => setSettings({ ...settings, weeks: w })}>
              {w} weeks
            </button>
          ))}
        </div>
      </Section>

      <Section title="Peak rut date" hint={`Estimated for your latitude: ${autoLabel}. If your state wildlife agency publishes a local peak breeding date, enter it here.`}>
        <div className="row">
          <input
            className="input"
            type="date"
            value={settings.rutPeak ? `2026-${settings.rutPeak}` : ''}
            onChange={(e) => setSettings({ ...settings, rutPeak: e.target.value ? e.target.value.slice(5) : null })}
          />
          {settings.rutPeak && (
            <button className="btn ghost" onClick={() => setSettings({ ...settings, rutPeak: null })}>
              Use estimate
            </button>
          )}
        </div>
      </Section>

      <PlacesSection />
      <StandsSection />
      <CamerasSection />

      <Section title="How Huntability works">
        <p className="small">
          Each hour gets a 1–10 Huntability score from <em>activity</em> × <em>weather</em> × <em>season</em>. Activity covers time of day relative to sunrise and sunset, solunar periods, and moon phase. Weather covers barometric pressure and its trend, temperature against the historical normal (cold snaps and cold fronts are top deer triggers), wind, and precipitation. Season scales everything by rut phase or turkey breeding phase. A score of 8 or higher is a great time to be in the stand. Tap any hour to see the breakdown.
        </p>
        <p className="small muted">Legal shooting hours shown are typical. Always confirm your state's regulations.</p>
      </Section>
    </div>
  );
}
