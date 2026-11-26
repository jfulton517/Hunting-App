import { describe, expect, it } from 'vitest';
import type { Sighting } from './data/types';
import { groupVisits } from './visits';

const T = Date.UTC(2026, 10, 24, 4, 30);
const s = (id: string, minutes: number, camera = 'blindwoods', weather = false): Sighting => ({
  id,
  camera_id: camera,
  deer_id: 'big8',
  taken_at: new Date(T + minutes * 60_000).toISOString(),
  time_source: 'stamp',
  photo_path: null,
  kind: 'buck',
  status: 'confirmed',
  ai: null,
  weather: weather ? ({ tempF: 30 } as Sighting['weather']) : null,
  notes: '',
});

describe('photos → visits', () => {
  it('treats a burst of photos as one sighting', () => {
    // Like the user's Blindwoods photos: one every minute or two from 4:32 to 4:44.
    const burst = [2, 4, 5, 8, 9, 10, 11, 12, 14].map((m, i) => s(`p${i}`, m));
    const visits = groupVisits(burst);
    expect(visits).toHaveLength(1);
    expect(visits[0].photos).toHaveLength(9);
  });

  it('starts a new visit after a gap or on another camera', () => {
    const visits = groupVisits([s('a', 0), s('b', 3), s('c', 40), s('d', 41, 'downtree')]);
    expect(visits.map((v) => v.photos.map((p) => p.id))).toEqual([['a', 'b'], ['c'], ['d']]);
  });

  it('represents a visit with a photo that has weather', () => {
    const v = groupVisits([s('a', 0), s('b', 1, 'blindwoods', true)]);
    expect(v[0].lead.id).toBe('b');
  });
});
