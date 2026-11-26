// Visual duplicate detection for trail-cam photos.
//
// Exact file fingerprints (photo_hash) only catch byte-identical files. The same picture
// saved twice from Strike Force (standard + HD, or re-saved) has different bytes, so we also
// keep a perceptual "difference hash": a 64-bit summary of what the image looks like.
// Near-identical images have hashes a few bits apart; burst shots of a moving deer usually
// differ more. We only call photos duplicates when they're from the same camera, taken within
// a minute of each other, and look nearly identical — and the user reviews before deleting.
import type { Sighting } from './data/types';

/** 64-bit difference hash as 16 hex chars, from a 9×8 grayscale thumbnail. */
export function dHashFromGray(gray: ArrayLike<number>): string {
  // gray: 9 columns × 8 rows, row-major
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Perceptual hash of a photo (browser only). Ignores the info strip along the bottom. */
export async function perceptualHash(photo: Blob): Promise<string> {
  const bmp = await createImageBitmap(photo);
  try {
    const c = document.createElement('canvas');
    c.width = 9;
    c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    // Skip the bottom 8% where the date/temperature strip changes between re-saves.
    g.drawImage(bmp, 0, 0, bmp.width, Math.round(bmp.height * 0.92), 0, 0, 9, 8);
    const px = g.getImageData(0, 0, 9, 8).data;
    const gray: number[] = [];
    for (let i = 0; i < px.length; i += 4) gray.push(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    return dHashFromGray(gray);
  } finally {
    bmp.close();
  }
}

export interface DuplicateGroup {
  keep: Sighting;
  remove: Sighting[];
}

const MAX_BITS = 4; // ≤ 4 of 64 bits different = same picture
const MAX_GAP_MS = 60_000;

/** Which copy to keep: tagged to a deer, then confirmed, then AI-read, then the oldest import. */
function rank(s: Sighting): number[] {
  return [s.deer_id ? 0 : 1, s.status === 'confirmed' ? 0 : 1, s.ai ? 0 : 1, s.weather ? 0 : 1, Date.parse(s.created_at ?? s.taken_at)];
}
function better(a: Sighting, b: Sighting): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
  return 0;
}

/** Is `s` a duplicate of any existing photo? (used when importing) */
export function findDuplicateOf(s: Pick<Sighting, 'camera_id' | 'taken_at' | 'photo_hash' | 'photo_phash'>, existing: Sighting[]): Sighting | null {
  for (const e of existing) {
    if (s.photo_hash && e.photo_hash === s.photo_hash) return e;
    if (!s.photo_phash || !e.photo_phash || e.camera_id !== s.camera_id) continue;
    if (Math.abs(Date.parse(e.taken_at) - Date.parse(s.taken_at)) > MAX_GAP_MS) continue;
    if (hamming(e.photo_phash, s.photo_phash) <= MAX_BITS) return e;
  }
  return null;
}

/** Group photos that are copies of each other; each group keeps the best copy. */
export function findDuplicateGroups(sightings: Sighting[]): DuplicateGroup[] {
  const sorted = [...sightings].sort((a, b) => (a.camera_id ?? '').localeCompare(b.camera_id ?? '') || Date.parse(a.taken_at) - Date.parse(b.taken_at));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id) ?? id;
    if (p === id) return id;
    const r = find(p);
    parent.set(id, r);
    return r;
  };
  const union = (a: string, b: string) => parent.set(find(a), find(b));

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.camera_id !== a.camera_id || Date.parse(b.taken_at) - Date.parse(a.taken_at) > MAX_GAP_MS) break;
      const exact = !!a.photo_hash && a.photo_hash === b.photo_hash;
      const looksSame = !!a.photo_phash && !!b.photo_phash && hamming(a.photo_phash, b.photo_phash) <= MAX_BITS;
      if (exact || looksSame) union(a.id, b.id);
    }
  }
  // Exact copies at different times (e.g. wrong time on one of them).
  const byHash = new Map<string, Sighting>();
  for (const s of sorted) {
    if (!s.photo_hash) continue;
    const prev = byHash.get(s.photo_hash);
    if (prev) union(prev.id, s.id);
    else byHash.set(s.photo_hash, s);
  }

  const groups = new Map<string, Sighting[]>();
  for (const s of sorted) {
    const r = find(s.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(s);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const ordered = [...g].sort(better);
      return { keep: ordered[0], remove: ordered.slice(1) };
    });
}
