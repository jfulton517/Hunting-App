// A trail camera usually fires several photos while one deer walks past (burst shots, or
// the same picture saved twice). For patterns and recommendations those are ONE sighting:
// counting each photo would make a single visit look like five.
import type { Sighting } from './data/types';

/** Photos from the same camera within this many minutes of the previous one are one visit. */
export const VISIT_GAP_MIN = 10;

export interface Visit {
  /** The photo that represents the visit (first one with weather, else the first). */
  lead: Sighting;
  photos: Sighting[];
}

/** Group photos into visits: same camera, each photo within VISIT_GAP_MIN of the one before. */
export function groupVisits(sightings: Sighting[], gapMin = VISIT_GAP_MIN): Visit[] {
  const sorted = [...sightings].sort((a, b) => (a.camera_id ?? '').localeCompare(b.camera_id ?? '') || Date.parse(a.taken_at) - Date.parse(b.taken_at));
  const visits: Visit[] = [];
  let current: Sighting[] = [];
  const flush = () => {
    if (!current.length) return;
    visits.push({ lead: current.find((s) => s.weather) ?? current[0], photos: current });
    current = [];
  };
  for (const s of sorted) {
    const prev = current[current.length - 1];
    if (prev && (prev.camera_id !== s.camera_id || Date.parse(s.taken_at) - Date.parse(prev.taken_at) > gapMin * 60_000)) flush();
    current.push(s);
  }
  flush();
  return visits.sort((a, b) => Date.parse(a.photos[0].taken_at) - Date.parse(b.photos[0].taken_at));
}
