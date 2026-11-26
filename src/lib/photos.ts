// Trail-cam photo import: read capture time, shrink for upload, save, and ask the AI.
import exifr from 'exifr';
import type { Repo } from './data/repo';
import { newId, type AiTier, type AnimalKind, type Deer, type Sighting } from './data/types';
import { zonedToEpoch } from './time';

/** Capture time from EXIF as local wall-clock ("YYYY:MM:DD HH:MM:SS"), interpreted in the camera's zone. */
export async function exifTakenAt(file: Blob, tz: string): Promise<number | null> {
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate'], reviveValues: false });
    const raw: unknown = tags?.DateTimeOriginal ?? tags?.CreateDate;
    if (typeof raw !== 'string') return null;
    return zonedToEpoch(raw.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T'), tz);
  } catch {
    return null;
  }
}

/** Downscale to at most `max` px on the long side as JPEG (smaller uploads, cheaper AI). */
// 1280 px is plenty to recognize a buck and keeps photos ~150 KB, so free storage holds ~6,000+.
export async function shrinkImage(file: Blob, max = 1280, quality = 0.8): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', quality));
  } catch {
    return file; // fall back to the original if the browser can't decode it
  }
}

export interface ImportProgress {
  name: string;
  state: 'reading' | 'uploading' | 'analyzing' | 'done' | 'error';
  message?: string;
}

/** Reference photo for each known deer (to show the AI what he looks like). */
export function referencePaths(deer: Deer[], sightings: Sighting[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const d of deer) {
    const ref = sightings.find((s) => s.id === d.reference_sighting_id && s.photo_path) ?? sightings.find((s) => s.deer_id === d.id && s.status === 'confirmed' && s.photo_path);
    out.set(d.id, ref?.photo_path ?? null);
  }
  return out;
}

export async function analyzeSighting(repo: Repo, tier: AiTier, sighting: Sighting, deer: Deer[], sightings: Sighting[], tz: string): Promise<Sighting> {
  if (!repo.identify || tier === 'off' || !sighting.photo_path) return sighting;
  const refs = referencePaths(deer, sightings);
  const ai = await repo.identify({
    tier,
    sighting,
    candidates: deer.filter((d) => d.status === 'active').map((d) => ({ deer: d, photoPath: refs.get(d.id) ?? null })),
  });
  const next: Sighting = { ...sighting, ai, kind: ai.primary_kind as AnimalKind };
  if (sighting.time_source !== 'exif' && ai.stamp_datetime) {
    const t = zonedToEpoch(ai.stamp_datetime, tz);
    if (t) {
      next.taken_at = new Date(t).toISOString();
      next.time_source = 'stamp';
    }
  }
  return next;
}

/**
 * Import photos for one camera. Each photo becomes a "pending" sighting that the user
 * reviews; AI suggestions (when available) are attached but never applied without confirmation.
 */
export async function importPhotos(opts: {
  files: File[];
  cameraId: string | null;
  tz: string;
  repo: Repo;
  aiTier: AiTier;
  deer: Deer[];
  sightings: Sighting[];
  save: (s: Sighting) => Promise<void>;
  onProgress: (p: ImportProgress[]) => void;
}): Promise<void> {
  const progress: ImportProgress[] = opts.files.map((f) => ({ name: f.name, state: 'reading' }));
  const update = (i: number, p: Partial<ImportProgress>) => {
    progress[i] = { ...progress[i], ...p };
    opts.onProgress([...progress]);
  };
  opts.onProgress([...progress]);

  let next = 0;
  const worker = async () => {
    while (next < opts.files.length) {
      const i = next++;
      const file = opts.files[i];
      try {
        const exif = await exifTakenAt(file, opts.tz);
        const blob = await shrinkImage(file);
        const id = newId();
        update(i, { state: 'uploading' });
        const photo_path = await opts.repo.uploadPhoto(id, blob);
        let sighting: Sighting = {
          id,
          camera_id: opts.cameraId,
          deer_id: null,
          taken_at: new Date(exif ?? file.lastModified ?? Date.now()).toISOString(),
          time_source: exif ? 'exif' : 'file',
          photo_path,
          kind: 'unknown',
          status: 'pending',
          ai: null,
          weather: null,
          notes: '',
        };
        await opts.save(sighting);
        if (opts.repo.identify && opts.aiTier !== 'off') {
          update(i, { state: 'analyzing' });
          try {
            sighting = await analyzeSighting(opts.repo, opts.aiTier, sighting, opts.deer, opts.sightings, opts.tz);
            await opts.save(sighting);
          } catch (e) {
            update(i, { state: 'done', message: `Saved; AI couldn't read it (${(e as Error).message})` });
            continue;
          }
        }
        update(i, { state: 'done' });
      } catch (e) {
        update(i, { state: 'error', message: (e as Error).message });
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
