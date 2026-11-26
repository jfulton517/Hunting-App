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
  state: 'waiting' | 'reading' | 'uploading' | 'analyzing' | 'done' | 'skipped' | 'error';
  message?: string;
}

const IMAGE_RE = /\.(jpe?g|png|webp)$/i;
const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';

/** Turn the user's selection (photos, ZIP downloads, folders) into a flat list of image files. */
export async function expandFiles(files: File[]): Promise<{ images: File[]; ignored: number }> {
  const images: File[] = [];
  let ignored = 0;
  for (const f of files) {
    if (isZip(f)) {
      const { unzip } = await import('fflate');
      const bytes = new Uint8Array(await f.arrayBuffer());
      const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
        unzip(bytes, { filter: (e) => IMAGE_RE.test(e.name) && !/(^|\/)(__MACOSX|\._)/.test(e.name) }, (err, data) => (err ? reject(err) : resolve(data))),
      );
      for (const [name, data] of Object.entries(entries)) {
        const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
        images.push(new File([data as BlobPart], name.split('/').pop()!, { type, lastModified: f.lastModified }));
      }
    } else if (f.type.startsWith('image/') || IMAGE_RE.test(f.name)) {
      if (!f.name.startsWith('._')) images.push(f);
    } else ignored++;
  }
  return { images, ignored };
}

/** Content fingerprint so the same photo is never imported twice. */
export async function fingerprint(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
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

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
}

/**
 * Import photos for one camera. Each photo becomes a "pending" sighting that the user
 * reviews; AI suggestions (when available) are attached but never applied without confirmation.
 * Photos already imported (same file contents) are skipped.
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
}): Promise<ImportSummary> {
  const progress: ImportProgress[] = opts.files.map((f) => ({ name: f.name, state: 'waiting' }));
  let pendingEmit = false;
  const emit = () => {
    // Throttle re-renders for big batches.
    if (pendingEmit) return;
    pendingEmit = true;
    setTimeout(() => {
      pendingEmit = false;
      opts.onProgress([...progress]);
    }, 150);
  };
  const update = (i: number, p: Partial<ImportProgress>) => {
    progress[i] = { ...progress[i], ...p };
    emit();
  };
  opts.onProgress([...progress]);

  const seen = new Set(opts.sightings.map((s) => s.photo_hash).filter(Boolean) as string[]);
  const summary: ImportSummary = { imported: 0, skipped: 0, failed: 0 };
  const useAi = !!opts.repo.identify && opts.aiTier !== 'off';

  let next = 0;
  const worker = async () => {
    while (next < opts.files.length) {
      const i = next++;
      const file = opts.files[i];
      try {
        update(i, { state: 'reading' });
        const hash = await fingerprint(file);
        if (seen.has(hash)) {
          summary.skipped++;
          update(i, { state: 'skipped', message: 'already imported' });
          continue;
        }
        seen.add(hash);
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
          photo_hash: hash,
          kind: 'unknown',
          status: 'pending',
          ai: null,
          weather: null,
          notes: '',
        };
        await opts.save(sighting);
        summary.imported++;
        if (useAi) {
          update(i, { state: 'analyzing' });
          try {
            sighting = await analyzeSighting(opts.repo, opts.aiTier, sighting, opts.deer, opts.sightings, opts.tz);
            await opts.save(sighting);
          } catch (e) {
            update(i, { state: 'done', message: `saved, but the AI couldn't read it (${(e as Error).message})` });
            continue;
          }
        }
        update(i, { state: 'done' });
      } catch (e) {
        summary.failed++;
        update(i, { state: 'error', message: (e as Error).message });
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  opts.onProgress([...progress]);
  return summary;
}
