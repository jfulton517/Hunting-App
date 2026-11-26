import { useMemo, useState } from 'react';
import { useData } from '../lib/data/store';
import { newId, type AgeClass, type AnimalKind, type Deer, type Sighting } from '../lib/data/types';
import { analyzeSighting, expandFiles, importPhotos, type ImportProgress, type ImportSummary } from '../lib/photos';
import { epochToLocalInput, formatDay, formatTime, zonedToEpoch } from '../lib/time';
import { CamerasSection } from './Account';
import { AnalyzePhotos } from './AnalyzePhotos';
import { CameraInsights, type ForecastCtx } from './CameraInsights';
import { describeConditions, fillConditions } from '../lib/conditions';
import { Duplicates, useDeletePhotos } from './Duplicates';
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
  const { rows, save, remove, repo, settings } = useData();
  const aiOn = !!repo.identify && settings.aiTier !== 'off';
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

  // One tap: confirm with just the animal type (no specific deer), keeping the photo's time.
  const quickTag = async (k: AnimalKind) => {
    setBusy('Saving…');
    const t = zonedToEpoch(time, tz);
    const changedTime = t != null && Math.abs(t - Date.parse(s.taken_at)) > 60_000;
    await save('sightings', {
      ...s,
      kind: k,
      deer_id: null,
      status: 'confirmed',
      taken_at: t != null ? new Date(t).toISOString() : s.taken_at,
      time_source: changedTime ? 'manual' : s.time_source,
      weather: changedTime ? null : s.weather,
    });
  };

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
        aiOn &&
        s.photo_path && (
          <button
            className="btn small"
            disabled={!!busy}
            onClick={async () => {
              setBusy('Analyzing…');
              try {
                const next = await analyzeSighting(repo, settings.aiTier, s, rows.deer, rows.sightings, tz);
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
      {s.weather && <p className="small conditions">🌡 {describeConditions(s.weather)}</p>}

      <div className="quick-tags">
        <span className="small muted">Quick tag:</span>
        {(['buck', 'doe', 'fawn', 'none'] as const).map((k) => (
          <button key={k} className="btn small" disabled={!!busy} onClick={() => quickTag(k)}>
            {k === 'none' ? 'Empty' : k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

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

function ImportStatus({ progress, summary }: { progress: ImportProgress[]; summary: ImportSummary | null }) {
  const total = progress.length;
  const finished = progress.filter((p) => p.state === 'done' || p.state === 'skipped' || p.state === 'error').length;
  const analyzing = progress.filter((p) => p.state === 'analyzing').length;
  const problems = progress.filter((p) => p.state === 'error' || (p.state === 'done' && p.message));
  return (
    <div className="import-status">
      <div className="bar">
        <div className="bar-fill" style={{ width: `${total ? (finished / total) * 100 : 0}%`, background: 'var(--accent)' }} />
      </div>
      <p className="small">
        {summary
          ? `Done: ${summary.imported} imported${summary.skipped ? `, ${summary.skipped} duplicates skipped` : ''}${summary.failed ? `, ${summary.failed} failed` : ''}.`
          : `${finished} of ${total} photos${analyzing ? `, AI reading ${analyzing}` : ''}…`}
      </p>
      {problems.length > 0 && (
        <ul className="progress small">
          {problems.slice(0, 10).map((p, i) => (
            <li key={i} className="error">
              ✕ {p.name}: {p.message}
            </li>
          ))}
          {problems.length > 10 && <li className="error">…and {problems.length - 10} more</li>}
        </ul>
      )}
    </div>
  );
}

export function TrailCam({ tz, fc }: { tz: string; fc: ForecastCtx | null }) {
  const { rows, repo, save, saveMany, remove, auth, settings } = useData();
  const aiOn = auth === 'signed-in' && settings.aiTier !== 'off';
  const [cameraId, setCameraId] = useState<string>(() => rows.cameras[0]?.id ?? '');
  const [progress, setProgress] = useState<ImportProgress[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [zoom, setZoom] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(60);
  const deletePhotos = useDeletePhotos();

  const pending = useMemo(() => rows.sightings.filter((s) => s.status === 'pending').sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at)), [rows.sightings]);
  const confirmed = useMemo(
    () =>
      rows.sightings
        .filter((s) => s.status === 'confirmed' && s.kind !== 'none' && (filter === 'all' || s.camera_id === filter))
        .sort((a, b) => Date.parse(b.taken_at) - Date.parse(a.taken_at)),
    [rows.sightings, filter],
  );
  const empties = pending.filter((s) => s.ai?.primary_kind === 'none');
  const confident = pending.filter(
    (s) => s.ai && (s.ai.primary_kind === 'none' || (s.ai.match_deer_id && s.ai.match_confidence === 'high' && rows.deer.some((d) => d.id === s.ai!.match_deer_id))),
  );
  const [dragging, setDragging] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const folderSupported = typeof document !== 'undefined' && 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|Android/i.test(navigator.userAgent);

  const acceptConfident = async () => {
    for (const s of confident) {
      if (s.ai!.primary_kind === 'none') {
        if (s.photo_path) await repo.deletePhoto(s.photo_path);
        await remove('sightings', s.id);
      } else await save('sightings', { ...s, deer_id: s.ai!.match_deer_id, kind: s.ai!.primary_kind, status: 'confirmed' });
    }
  };

  const runImport = async (selected: File[]) => {
    if (busy || !selected.length) return;
    setBusy(true);
    setSummary(null);
    setNotice(null);
    try {
      setProgress([{ name: 'Unpacking…', state: 'reading' }]);
      const { images, ignored } = await expandFiles(selected);
      if (!images.length) {
        setProgress([]);
        setNotice('No photos found in that selection. Choose JPG/PNG photos or a ZIP of them.');
        return;
      }
      let tier = aiOn ? settings.aiTier : 'off';
      if (tier !== 'off' && images.length > 25) {
        const each = tier === 'pro' ? 0.06 : 0.0015;
        const ok = confirm(
          `Send ${images.length} photos to ${tier === 'pro' ? 'Pro' : 'Basic'} AI? Estimated cost about $${Math.max(0.01, images.length * each).toFixed(2)}, billed to your Anthropic account. Duplicates are skipped and not charged.\n\nChoose Cancel to import them without AI.`,
        );
        if (!ok) tier = 'off';
      }
      const result = await importPhotos({ files: images, cameraId: cameraId || null, tz, repo, aiTier: tier, deer: rows.deer, sightings: rows.sightings, save: (s) => save('sightings', s), onProgress: setProgress });
      setSummary(result);
      // Look up the weather for the new photos right away (free).
      try {
        const { updated } = await fillConditions(result.created, rows.cameras, fc?.place ?? null);
        if (updated.length) await saveMany('sightings', updated);
      } catch {
        /* offline: the Analyze photos card offers to do it later */
      }
      if (ignored) setNotice(`${ignored} file${ignored === 1 ? ' was' : 's were'} skipped because ${ignored === 1 ? "it isn't a photo" : "they aren't photos"}.`);
    } catch (e) {
      setNotice(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
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
      <section
        className={`card dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          runImport([...e.dataTransfer.files]);
        }}
      >
        <h3>Add photos</h3>
        <details className="howto small">
          <summary>How to get all your photos out of Strike Force</summary>
          <ol>
            <li>
              <strong>On a computer (easiest for lots of photos):</strong> sign in at strikeforcewireless.com, open Photos, use <em>Select All</em> (top right), and download. Then drag the downloaded photos or ZIP file onto this box, or use the buttons below.
            </li>
            <li>
              <strong>On your phone:</strong> in the Strike Force Wireless app, tap <em>Select All</em>, then Share → Save Images. Then tap <em>Choose photos or ZIP</em> here and select them all in your photo library.
            </li>
          </ol>
          <p>Download one camera at a time and pick that camera below, so each photo is filed under the right location. Re-uploading photos you already added is fine, because duplicates are skipped automatically.</p>
        </details>
        <label className="field">
          <span>Camera these photos are from</span>
          <select className="input" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            {rows.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`btn primary block file-btn ${busy ? 'disabled' : ''}`}>
          {busy ? 'Importing…' : '📷 Choose photos or ZIP'}
          <input
            type="file"
            accept="image/*,.zip,application/zip"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              runImport(files);
            }}
          />
        </label>
        {folderSupported && (
          <label className={`btn block file-btn folder-btn ${busy ? 'disabled' : ''}`}>
            📁 Choose a whole folder
            <input
              type="file"
              hidden
              disabled={busy}
              ref={(el) => el?.setAttribute('webkitdirectory', '')}
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                runImport(files);
              }}
            />
          </label>
        )}
        <p className="small muted drop-hint">On a computer you can also drag photos, folders, or ZIP files onto this box.</p>
        <p className="small muted">
          {aiOn ? 'The AI suggests what is in each photo, and you confirm it.' : 'You pick which buck is in each photo. AI identification is an optional upgrade on the Account tab.'}
        </p>
        {notice && <p className="small warn-text">{notice}</p>}
        {progress.length > 0 && <ImportStatus progress={progress} summary={summary} />}
      </section>

      <AnalyzePhotos tz={tz} fallback={fc?.place ?? null} />

      {pending.length > 0 && (
        <>
          {confident.length > 0 && (
            <div className="banner">
              The AI is confident about {confident.length} photo{confident.length === 1 ? '' : 's'} (a strong match to a known deer, or an empty frame).{' '}
              <button className="btn small primary" onClick={acceptConfident}>
                Accept all {confident.length}
              </button>
            </div>
          )}
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
          {pending.length > 20 && <p className="small muted">Showing the 20 newest. More appear as you review these.</p>}
          {pending.slice(0, 20).map((s) => (
            // Re-mount when the AI result or time arrives so its suggestions pre-fill the form.
            <ReviewCard key={`${s.id}:${s.ai ? 'ai' : ''}:${s.taken_at}`} s={s} tz={tz} onZoom={setZoom} />
          ))}
        </>
      )}

      <Duplicates tz={tz} />

      <div className="section-head">
        <h2>Photo log</h2>
        {confirmed.length > 0 && (
          <button
            className="btn small ghost"
            onClick={() => {
              setSelecting(!selecting);
              setSelected(new Set());
            }}
          >
            {selecting ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>
      {selecting && (
        <div className="select-bar">
          <span className="small">{selected.size} selected</span>
          <button className="btn small ghost" onClick={() => setSelected(new Set(confirmed.slice(0, shown).map((s) => s.id)))}>
            Select all shown
          </button>
          <button
            className="btn small danger-outline"
            disabled={!selected.size}
            onClick={async () => {
              if (!confirm(`Delete ${selected.size} photo${selected.size === 1 ? '' : 's'}? This can’t be undone.`)) return;
              await deletePhotos(rows.sightings.filter((s) => selected.has(s.id)));
              setSelected(new Set());
              setSelecting(false);
            }}
          >
            🗑 Delete
          </button>
        </div>
      )}
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
      {fc && filter !== 'all' && rows.cameras.find((c) => c.id === filter) && <CameraInsights camera={rows.cameras.find((c) => c.id === filter)!} fc={fc} />}
      {filter === 'all' && rows.cameras.length > 0 && confirmed.length > 0 && <p className="small muted">Tap a camera above to see when bucks move there and the best upcoming times to hunt it.</p>}
      {confirmed.length === 0 ? (
        <p className="muted small">No confirmed photos yet.</p>
      ) : (
        <div className="gallery">
          {confirmed.slice(0, shown).map((s) => (
            <figure
              key={s.id}
              className={selecting ? (selected.has(s.id) ? 'selectable picked' : 'selectable') : ''}
              onClick={() => {
                if (selecting) {
                  const next = new Set(selected);
                  if (next.has(s.id)) next.delete(s.id);
                  else next.add(s.id);
                  setSelected(next);
                } else if (s.photo_path) setZoom(s.photo_path);
              }}
            >
              {selecting && <span className="pick">{selected.has(s.id) ? '✓' : ''}</span>}
              <Photo path={s.photo_path} alt={deerName(s.deer_id) ?? s.kind} />
              <figcaption>
                <strong>{deerName(s.deer_id) ?? KINDS.find((k) => k.value === s.kind)?.label}</strong>
                <span>
                  {formatDay(Date.parse(s.taken_at), tz, { weekday: undefined })} {formatTime(Date.parse(s.taken_at), tz)}
                </span>
                {s.weather && <span className="cond">{describeConditions(s.weather, true)}</span>}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {confirmed.length > shown && (
        <button className="btn block ghost" onClick={() => setShown(shown + 60)}>
          Show more ({confirmed.length - shown} more)
        </button>
      )}
      {zoom && (
        <Lightbox
          path={zoom}
          onClose={() => setZoom(null)}
          onDelete={(() => {
            const z = rows.sightings.find((x) => x.photo_path === zoom);
            return z ? () => deletePhotos([z]) : undefined;
          })()}
        />
      )}
    </div>
  );
}
