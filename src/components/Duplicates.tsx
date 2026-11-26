import { useMemo, useState } from 'react';
import { useData } from '../lib/data/store';
import type { Sighting } from '../lib/data/types';
import { findDuplicateGroups, perceptualHash } from '../lib/dedupe';
import { formatDay, formatTime } from '../lib/time';
import { Photo } from './Photo';

/** Delete photos everywhere: the file, the record, and any buck that used it as his picture. */
export function useDeletePhotos() {
  const { rows, repo, remove, save } = useData();
  return async (list: Sighting[]) => {
    const ids = new Set(list.map((s) => s.id));
    for (const d of rows.deer) if (d.reference_sighting_id && ids.has(d.reference_sighting_id)) await save('deer', { ...d, reference_sighting_id: null });
    for (const s of list) {
      if (s.photo_path) await repo.deletePhoto(s.photo_path).catch(() => {});
      await remove('sightings', s.id);
    }
  };
}

/**
 * Finds the same picture saved more than once (even when the files differ, like standard + HD
 * copies from Strike Force), shows them side by side, and removes the extra copies.
 */
export function Duplicates({ tz }: { tz: string }) {
  const { rows, repo, saveMany } = useData();
  const deletePhotos = useDeletePhotos();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState(false);
  const [keepBoth, setKeepBoth] = useState<Set<string>>(new Set());

  const groups = useMemo(() => (checked ? findDuplicateGroups(rows.sightings) : []), [checked, rows.sightings]);
  const active = groups.filter((g) => !keepBoth.has(g.keep.id));
  const toRemove = active.flatMap((g) => g.remove);
  const camName = (id: string | null) => rows.cameras.find((c) => c.id === id)?.name ?? 'No camera';
  const deerName = (id: string | null) => rows.deer.find((d) => d.id === id)?.name;

  const scan = async () => {
    setBusy(true);
    setKeepBoth(new Set());
    try {
      const todo = rows.sightings.filter((s) => s.photo_path && !s.photo_phash);
      const done: Sighting[] = [];
      for (let i = 0; i < todo.length; i++) {
        setStatus(`Comparing photos: ${i + 1} of ${todo.length}…`);
        try {
          const url = await repo.photoUrl(todo[i].photo_path!);
          if (!url) continue;
          const phash = await perceptualHash(await (await fetch(url)).blob());
          done.push({ ...todo[i], photo_phash: phash });
        } catch {
          /* skip photos that can't be loaded right now */
        }
        if (done.length >= 25) await saveMany('sightings', done.splice(0));
      }
      if (done.length) await saveMany('sightings', done);
      setChecked(true);
      setStatus(null);
    } catch (e) {
      setStatus(`Couldn't finish checking: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const removeAll = async () => {
    if (!confirm(`Delete ${toRemove.length} duplicate photo${toRemove.length === 1 ? '' : 's'}? One copy of each is kept. This can’t be undone.`)) return;
    setBusy(true);
    try {
      setStatus('Removing duplicates…');
      await deletePhotos(toRemove);
      setStatus(`Removed ${toRemove.length} duplicate photo${toRemove.length === 1 ? '' : 's'}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card duplicates">
      <h3>Duplicate photos (optional)</h3>
      {!checked && (
        <>
          <p className="small muted">You don't need to delete anything: several photos from one walk past the camera already count as one sighting in patterns and recommendations. Use this only to clear out copies of the same picture (for example, a standard and an HD copy from Strike Force).</p>
          <button className="btn block" disabled={busy || rows.sightings.length < 2} onClick={scan}>
            {busy ? 'Checking…' : '🔍 Find duplicate photos'}
          </button>
        </>
      )}
      {checked && active.length === 0 && !busy && (
        <p className="small ok-text">✓ No duplicate photos found.</p>
      )}
      {checked && active.length > 0 && (
        <>
          <p className="small">
            Found <strong>{toRemove.length}</strong> extra cop{toRemove.length === 1 ? 'y' : 'ies'} in {active.length} group{active.length === 1 ? '' : 's'}. The copy marked <strong>Keep</strong> is the one tagged to a buck, or the first one imported. Tap <em>Not duplicates</em> if two photos are really different.
          </p>
          <button className="btn primary block" disabled={busy} onClick={removeAll}>
            🗑 Remove {toRemove.length} duplicate{toRemove.length === 1 ? '' : 's'}
          </button>
          <div className="dup-groups">
            {active.slice(0, 30).map((g) => (
              <div key={g.keep.id} className="dup-group">
                <div className="small muted">
                  {camName(g.keep.camera_id)} · {formatDay(Date.parse(g.keep.taken_at), tz, { weekday: undefined })} {formatTime(Date.parse(g.keep.taken_at), tz)}
                </div>
                <div className="dup-row">
                  {[g.keep, ...g.remove].map((s, i) => (
                    <figure key={s.id} className={i === 0 ? 'keep' : 'drop'}>
                      <Photo path={s.photo_path} alt={i === 0 ? 'Kept copy' : 'Duplicate'} />
                      <figcaption className="small">{i === 0 ? `Keep${deerName(s.deer_id) ? ` · ${deerName(s.deer_id)}` : ''}` : 'Remove'}</figcaption>
                    </figure>
                  ))}
                </div>
                <button className="btn small ghost" onClick={() => setKeepBoth(new Set([...keepBoth, g.keep.id]))}>
                  Not duplicates
                </button>
              </div>
            ))}
            {active.length > 30 && <p className="small muted">…and {active.length - 30} more groups (all included above).</p>}
          </div>
        </>
      )}
      {checked && !busy && (
        <button className="btn small ghost" onClick={scan}>
          Check again
        </button>
      )}
      {status && <p className="small">{status}</p>}
    </section>
  );
}
