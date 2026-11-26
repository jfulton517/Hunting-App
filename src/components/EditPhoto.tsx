import { useState } from 'react';
import { fillConditions } from '../lib/conditions';
import { useData } from '../lib/data/store';
import { newId, type AnimalKind, type Deer, type Sighting } from '../lib/data/types';
import { epochToLocalInput, zonedToEpoch } from '../lib/time';
import { Photo } from './Photo';

const KINDS: { value: AnimalKind; label: string }[] = [
  { value: 'buck', label: 'Buck' },
  { value: 'doe', label: 'Doe' },
  { value: 'fawn', label: 'Fawn' },
  { value: 'turkey', label: 'Turkey' },
  { value: 'other', label: 'Other animal' },
  { value: 'none', label: 'Empty / false trigger' },
  { value: 'unknown', label: 'Not sure' },
];

/**
 * Correct a photo that was already labeled: what's in it, which deer, the time, the camera.
 * Changing the time or camera looks the weather up again for the new moment and place.
 */
export function EditPhoto({ s, tz, fallback, onClose, onDelete }: { s: Sighting; tz: string; fallback: { lat: number; lon: number } | null; onClose: () => void; onDelete?: () => Promise<void> }) {
  const { rows, save } = useData();
  const [kind, setKind] = useState<AnimalKind>(s.kind);
  const [deerId, setDeerId] = useState<string>(s.deer_id ?? '');
  const [cameraId, setCameraId] = useState<string>(s.camera_id ?? '');
  const [time, setTime] = useState(epochToLocalInput(Date.parse(s.taken_at), tz));
  const [notes, setNotes] = useState(s.notes ?? '');
  const [newName, setNewName] = useState('');
  const [makeProfile, setMakeProfile] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isDeer = kind === 'buck' || kind === 'doe';
  const candidates = rows.deer.filter((d) => (kind === 'buck' ? d.sex === 'buck' : kind === 'doe' ? d.sex === 'doe' : true));
  const current = rows.deer.find((d) => d.id === deerId);

  const saveChanges = async (status: Sighting['status'] = 'confirmed') => {
    setBusy('Saving…');
    try {
      let deer_id: string | null = isDeer && deerId && deerId !== 'new' ? deerId : null;
      if (isDeer && deerId === 'new') {
        const d: Deer = {
          id: newId(),
          name: newName.trim() || `${kind === 'buck' ? 'Buck' : 'Doe'} #${rows.deer.length + 1}`,
          sex: kind === 'doe' ? 'doe' : 'buck',
          description: s.ai?.buck_description ?? '',
          points: s.ai?.points_estimate ?? null,
          age_class: s.ai?.age_class ?? 'unknown',
          is_target: false,
          status: 'active',
          reference_sighting_id: s.id,
        };
        await save('deer', d);
        deer_id = d.id;
      }
      const t = zonedToEpoch(time, tz);
      const timeChanged = t != null && Math.abs(t - Date.parse(s.taken_at)) > 60_000;
      const cameraChanged = (cameraId || null) !== (s.camera_id ?? null);
      let next: Sighting = {
        ...s,
        kind,
        deer_id,
        camera_id: cameraId || null,
        notes,
        status,
        taken_at: t != null ? new Date(t).toISOString() : s.taken_at,
        time_source: timeChanged ? 'manual' : s.time_source,
        weather: timeChanged || cameraChanged ? null : s.weather,
      };
      if (!next.weather) {
        setBusy('Looking up the weather for the new time and place…');
        try {
          const { updated } = await fillConditions([next], rows.cameras, fallback);
          if (updated[0]) next = updated[0];
        } catch {
          /* offline: the Analyze photos card will fill it in later */
        }
      }
      await save('sightings', next);
      // The old buck shouldn't keep a photo that isn't him as his profile picture.
      for (const d of rows.deer) if (d.reference_sighting_id === s.id && d.id !== deer_id) await save('deer', { ...d, reference_sighting_id: null });
      if (makeProfile && deer_id) {
        const d = rows.deer.find((x) => x.id === deer_id);
        if (d) await save('deer', { ...d, reference_sighting_id: s.id });
      }
      onClose();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card edit-photo" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit photo">
        <div className="modal-head">
          <h2>Edit photo</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {s.photo_path && <Photo path={s.photo_path} alt="Trail camera photo" className="review-photo" />}
        {s.ai && <p className="small muted">AI said: {s.ai.summary}</p>}

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
                  {d.status !== 'active' ? ` (${d.status})` : ''}
                </option>
              ))}
              <option value="new">+ New {kind} from this photo</option>
            </select>
          </label>
        )}
        {isDeer && deerId === 'new' && <input className="input" placeholder={kind === 'buck' ? 'Name, e.g. Split G2 10-pt' : 'Name'} value={newName} onChange={(e) => setNewName(e.target.value)} />}
        {isDeer && current && (
          <label className="toggle small">
            <input type="checkbox" checked={makeProfile} onChange={(e) => setMakeProfile(e.target.checked)} /> Use as {current.name}'s profile photo
          </label>
        )}

        <label className="field">
          <span>Camera</span>
          <select className="input" value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            <option value="">No camera</option>
            {rows.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Date and time taken</span>
          <input className="input" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>

        <label className="field">
          <span>Notes</span>
          <input className="input" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="row wrap">
          <button className="btn primary" disabled={!!busy} onClick={() => saveChanges('confirmed')}>
            Save changes
          </button>
          <button className="btn" disabled={!!busy} onClick={() => saveChanges('pending')} title="Move it back to the review list">
            Send back to review
          </button>
          {onDelete && (
            <button
              className="btn ghost danger"
              disabled={!!busy}
              onClick={async () => {
                if (!confirm('Delete this photo? This can’t be undone.')) return;
                await onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          )}
        </div>
        {busy && <p className="small muted">{busy}</p>}
      </div>
    </div>
  );
}
