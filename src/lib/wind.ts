import type { Stand } from './data/types';
import { compass, compass8, COMPASS_8, type Compass8 } from './weather';

export type { Stand };


/**
 * Good winds for a stand that faces `facing`: wind blowing from the direction you look
 * (or 45° either side) carries your scent behind you, away from where deer approach.
 */
export function windsForFacing(facing: Compass8): Compass8[] {
  const i = COMPASS_8.indexOf(facing);
  return [COMPASS_8[(i + 7) % 8], facing, COMPASS_8[(i + 1) % 8]];
}

export const FACING_NAME: Record<Compass8, string> = {
  N: 'North',
  NE: 'Northeast',
  E: 'East',
  SE: 'Southeast',
  S: 'South',
  SW: 'Southwest',
  W: 'West',
  NW: 'Northwest',
};

export function opposite(dir: Compass8): Compass8 {
  return COMPASS_8[(COMPASS_8.indexOf(dir) + 4) % 8];
}

/** Plain-language setup advice for a wind direction (degrees the wind blows FROM). */
export function windAdvice(deg: number): string {
  const from = compass(deg);
  const to = compass((deg + 180) % 360);
  return `Wind from the ${from} carries your scent ${to}. Set up ${to} (downwind) of where you expect deer, so they approach from the ${from} side. Walk in without crossing their travel routes upwind.`;
}

export function standsFor(stands: Stand[], deg: number | null): { good: Stand[]; bad: Stand[] } {
  if (deg == null) return { good: [], bad: stands };
  const dir = compass8(deg);
  return {
    good: stands.filter((s) => s.winds.includes(dir)),
    bad: stands.filter((s) => !s.winds.includes(dir)),
  };
}
