import type { Stand } from './data/types';
import { compass, compass8, COMPASS_8, type Compass8 } from './weather';

export type { Stand };


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
