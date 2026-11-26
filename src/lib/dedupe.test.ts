import { describe, expect, it } from 'vitest';
import type { Sighting } from './data/types';
import { dHashFromGray, findDuplicateGroups, findDuplicateOf, hamming } from './dedupe';

const T = Date.UTC(2026, 10, 24, 4, 32);
const s = (id: string, over: Partial<Sighting> = {}): Sighting => ({
  id,
  camera_id: 'cam',
  deer_id: null,
  taken_at: new Date(T).toISOString(),
  time_source: 'stamp',
  photo_path: `u/${id}.jpg`,
  photo_hash: `h-${id}`,
  photo_phash: '0f0f0f0f0f0f0f0f',
  kind: 'buck',
  status: 'confirmed',
  ai: null,
  weather: null,
  notes: '',
  created_at: new Date(T + 1000).toISOString(),
  ...over,
});

describe('perceptual hash', () => {
  it('builds a 64-bit hash from a 9x8 gradient and measures differences', () => {
    const rising = Array.from({ length: 72 }, (_, i) => i % 9);
    const falling = Array.from({ length: 72 }, (_, i) => 9 - (i % 9));
    expect(dHashFromGray(rising)).toBe('0000000000000000');
    expect(dHashFromGray(falling)).toBe('ffffffffffffffff');
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hamming('0f0f0f0f0f0f0f0f', '0f0f0f0f0f0f0f0e')).toBe(1);
  });
});

describe('duplicate groups', () => {
  it('pairs a re-saved copy (same camera, same minute, nearly identical) and keeps the tagged one', () => {
    const tagged = s('a', { deer_id: 'big8', created_at: new Date(T + 5000).toISOString() });
    const copy = s('b', { photo_phash: '0f0f0f0f0f0f0f0e' });
    const groups = findDuplicateGroups([copy, tagged]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe('a');
    expect(groups[0].remove.map((x) => x.id)).toEqual(['b']);
  });

  it('keeps burst shots that look different', () => {
    const groups = findDuplicateGroups([s('a'), s('b', { photo_phash: 'f0f0f0f0f0f0f0f0', taken_at: new Date(T + 30_000).toISOString() })]);
    expect(groups).toEqual([]);
  });

  it('does not match identical-looking photos from different cameras or far apart in time', () => {
    expect(findDuplicateGroups([s('a'), s('b', { camera_id: 'other' })])).toEqual([]);
    expect(findDuplicateGroups([s('a'), s('b', { taken_at: new Date(T + 5 * 60_000).toISOString() })])).toEqual([]);
  });

  it('groups exact file copies even when their times differ, and handles 3-way groups', () => {
    const groups = findDuplicateGroups([
      s('a', { photo_hash: 'same' }),
      s('b', { photo_hash: 'same', taken_at: new Date(T + 3 * 3600_000).toISOString(), photo_phash: null }),
      s('c', { photo_hash: 'x1', photo_phash: '0f0f0f0f0f0f0f0f' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].remove).toHaveLength(2);
  });

  it('spots a duplicate on import', () => {
    const existing = [s('a')];
    expect(findDuplicateOf({ camera_id: 'cam', taken_at: existing[0].taken_at, photo_hash: 'new', photo_phash: '0f0f0f0f0f0f0f0d' }, existing)?.id).toBe('a');
    expect(findDuplicateOf({ camera_id: 'cam', taken_at: existing[0].taken_at, photo_hash: 'new', photo_phash: 'ffff0000ffff0000' }, existing)).toBeNull();
  });
});
