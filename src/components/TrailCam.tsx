import { useMemo, useState } from 'react';
import { useData } from '../lib/data/store';
import { newId, type AgeClass, type AnimalKind, type Deer, type Sighting } from '../lib/data/types';
import { analyzeSighting, importPhotos, type ImportProgress } from '../lib/photos';
import { epochToLocalInput, formatDay, formatTime, zonedToEpoch } from '../lib/time';
import { CamerasSection } from './Account';
import { Lightbox, Photo } from './Photo';

const KINDS: { value: AnimalKind; label: string }[] = [
  { value: 'buck', label: 'Buck' },
  { value: 'doe', label: 'Doe' },
  { value: 'fawn', label: 'Fawn' },
  { value: 'turkey', label: 'Turkey' },
  { value: 'other', label: 'Other animal' },
  { value: 'none', label: 'Empty / false trigger' },
  { value: 'unknown', label: 'Not sure' },
];

const TIME_SOURCE: Record<Sighting['time_source'], string> = {
  exif: 'from the photo file',
  stamp: "read from the photo's info strip",
  file: 'from the file date, so please check it',
  manual: 'entered by you',
};

function ReviewCard({ s, tz, onZoom }: { s: Sighting; tz: string; onZoom: (p: string) => void }) {
  const { rows, save, remove, repo } = useData();
  const ai = s.ai;
  const initialDeer = ai?.match_deer_id && (ai.match_confidence === 'high' || ai.match_confidence === 'medium') ? ai.match_deer_id : ai?.is_new_buck ? 'new' : '';
  const [kind, setKind] = useState<AnimalKind>(s.kind);
  const [deerId, setDeerId] = useState<string>(initialDeer);
  const [time, setTime] = useState(epochToLocalInput(Date.parse(s.taken_at), tz));
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState(ai?.buck_description ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const camera = rows.cameras.find((c) => c.id === s.camera_id);
  const candidates = rows.deer.filter((d) => d.status === 'active' && (kind === 'buck' ? d.sex === 'buck' : kind === 'doe' ? d.sex === 'doe' : true));
  const matched = rows.deer.find((d) => d.id === ai?.match_deer_id);
  const isDeer = kind === 'buck' || kind === 'doe';

  const confirm = async () => {
    setBusy('Saving…');
    let deer_id: string | null = isDeer && deerId && deerId !== 'new' ? deerId : null;
    if (isDeer && deerId === 'new') {
      const d: Deer = {
        id: newId(),
        name: newName.trim() || `${kind === 'buck' ? 'Buck' : 'Doe'} #${rows.deer.length + 1}`,
        sex: kind === 'doe' ? 'doe' : 'buck',
        description: newDesc,
        points: ai?.points_estimate ?? null,
        age_class: (ai?.age_class ?? 'unknown') as AgeClass,
        is_target: false,
        status: 'active',
        reference_sighting_id: s.id,
      };
      await save('deer', d);
      deer_id = d.id;
    }
    const t = zonedToEpoch(time, tz);
    const changedTime = t != null && Math.abs(t - Date.parse(s.taken_at)) > 60_000;
    await save('sightings', {
      ...s,
      kind,
      deer_id,
      status: 'confirmed',
      taken_at: t != null ? new Date(t).toISOString() : s.taken_at,
      time_source: changedTime ? 'manual' : s.time_source,
      weather: changedTime ? null : s.weather,
    });
  };

  return (
    <div className="card review">
      {s.photo_path && <Photo path={s.photo_path} alt="Trail camera photo" className="review-photo" onClick={() => onZoom(s.photo_path!)} />}
      <div className="small muted">
        {camera?.name ?? 'No camera'} · {formatDay(Date.parse(s.taken_at), tz)} {formatTime(Date.parse(s.taken_at), tz)}
      </div>
      {ai ? (
        <div className="ai-box">
          <div>
            <strong>AI:</strong> {ai.summary}
          </div>
          {ai.is_new_buck && <div className="new-buck">🆕 Looks like a buck you haven't tagged yet</div>}
          {matched && ai.match_confidence !== 'none' && (
            <div className="small">
              Possible match: <strong>{matched.name}</strong> ({ai.match_confidence} confidence). {ai.match_reasoning}
            </div>
          )}
          {ai.buck_description && <div className="small muted">{ai.buck_description}</div>}
        </div>
      ) : (
        repo.identify &&
        s.photo_path && (
          <button
            className="btn small"
            disabled={!!busy}
            onClick={async () => {
              setBusy('Analyzing…');
              try {
                const next = await analyzeSighting(repo, s, rows.deer, rows.sightings, tz);
                await save('sightings', next);
              } catch (e) {
                setBusy(`AI failed: ${(e as Error).message}`);
                return;
              }
              setBusy(null);
            }}
          >
            Ask AI to identify
          </button>
        )
      )}

      <label className="field">
        <span>What's in the photo?</span>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as AnimalKind)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {isDeer && (
        <label className="field">
          <span>Which {kind}?</span>
          <select className="input" value={deerId} onChange={(e) => setDeerId(e.target.value)}>
            <option value="">Don't know / not tracking</option>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.is_target ? ' ★' : ''}
              </option>
            ))}
            <option value="new">+ New {kind} from this photo</option>
          </select>
        </label>
      )}
      {isDeer && deerId === 'new' && (
        <div className="editor">
          <input className="input" placeholder={kind === 'buck' ? 'Name, e.g. Split G2 10-pt' : 'Name'} value={newName} onChange={(e) => setNewName(e.target.value)} />
          <textarea className="input" rows={2} placeholder="Description (antlers, body marks)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
        </div>
      )}

      <label className="field">
        <span>Time taken ({TIME_SOURCE[s.time_source]})</span>
        <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
      </label>

      <div className="row">
        <button className="btn primary" disabled={!!busy} onClick={confirm}>
          Confirm
        </button>
        <button
          className="btn ghost danger"
          disabled={!!busy}
          onClick={async () => {
            if (s.photo_path) await repo.deletePhoto(s.photo_path);
            await remove('sightings', s.id);
          }}
        >
          Delete
        </button>
      </div>
      {busy && <p className="small muted">{busy}</p>}
    </div>
  );
}

export function TrailCam({ tz }: { tz: string }) {
  const { rows, repo, save, remove, auth } = useData();
  const [cameraId, setCameraId] = useState<string>(() => rows.cameras[0]?.id ?? '');
  const [progress, setProgress] = useState<ImportProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [zoom, setZoom] = useState<string | null>(null);

  const pending = useMemo(() => rows.sightings.filter((s) => s.status === 'pending').sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at)), [rows.sightings]);
  const confirmed = useMemo(
    () =>
      rows.sightings
        .filter((s) => s.status === 'confirmed' && s.kind !== 'none' && (filter === 'all' || s.camera_id === filter))
        .sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at)),
    [rows.sightings, filter],
  );
  const empties = pending.filter((s) => s.ai?.primary_kind === 'none');
  const deerName = (id: string | null) => rows.deer.find((d) => d.id === id)?.name;

  if (!rows.cameras.length)
    return (
      <div>
        <div className="intro">
          <h2>Trail cameras</h2>
          <p>Add your Strike Force cameras first. Then you can bring in photos and track individual bucks.</p>
        </div>
        <CamerasSection />
      </div>
    );

  return (
    <div className="trailcam">
      <section className="card">
        <h3>Add photos</h3>
        <p className="small muted">
          In the Strike Force Wireless app, open a photo and save it to your phone's photos (Share → Save Image). Then add the photos here.
          {auth === 'signed-in' ? ' The AI suggests what is in each photo, and you confirm it.' : ' Sign in to get AI identification.'}
        </p>
        <label className="field">
          <span>Camera</span>
          <select className="input" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            {rows.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`btn primary block file-btn ${busy ? 'disabled' : ''}`}>
          {busy ? 'Importing…' : '📷 Choose photos'}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={busy}
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (!files.length) return;
              setBusy(true);
              try {
                await importPhotos({ files, cameraId: cameraId || null, tz, repo, deer: rows.deer, sightings: rows.sightings, save: (s) => save('sightings', s), onProgress: setProgress });
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {progress.length > 0 && (
          <ul className="progress small">
            {progress.map((p, i) => (
              <li key={i} className={p.state}>
                {p.state === 'done' ? '✓' : p.state === 'error' ? '✕' : '…'} {p.name} {p.state !== 'done' && p.state !== 'error' ? `(${p.state})` : ''} {p.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending.length > 0 && (
        <>
          <div className="section-head">
            <h2>To review ({pending.length})</h2>
            {empties.length > 0 && (
              <button
                className="btn small ghost"
                onClick={async () => {
                  for (const s of empties) {
                    if (s.photo_path) await repo.deletePhoto(s.photo_path);
                    await remove('sightings', s.id);
                  }
                }}
              >
                Delete {empties.length} empty
              </button>
            )}
          </div>
          {pending.slice(0, 20).map((s) => (
            // Re-mount when the AI result or time arrives so its suggestions pre-fill the form.
            <ReviewCard key={`${s.id}:${s.ai ? 'ai' : ''}:${s.taken_at}`} s={s} tz={tz} onZoom={setZoom} />
          ))}
        </>
      )}

      <div className="section-head">
        <h2>Photo log</h2>
      </div>
      <div className="chips">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All cameras
        </button>
        {rows.cameras.map((c) => (
          <button key={c.id} className={filter === c.id ? 'active' : ''} onClick={() => setFilter(c.id)}>
            {c.name}
          </button>
        ))}
      </div>
      {confirmed.length === 0 ? (
        <p className="muted small">No confirmed photos yet.</p>
      ) : (
        <div className="gallery">
          {confirmed.slice(0, 60).map((s) => (
            <figure key={s.id} onClick={() => s.photo_path && setZoom(s.photo_path)}>
              <Photo path={s.photo_path} alt={deerName(s.deer_id) ?? s.kind} />
              <figcaption>
                <strong>{deerName(s.deer_id) ?? KINDS.find((k) => k.value === s.kind)?.label}</strong>
                <span>
                  {formatDay(Date.parse(s.taken_at), tz, { weekday: undefined })} {formatTime(Date.parse(s.taken_at), tz)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {zoom && <Lightbox path={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
