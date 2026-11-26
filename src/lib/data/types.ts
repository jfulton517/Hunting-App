// Records saved per user (in Supabase when signed in, or on the device otherwise).
import type { Compass8 } from '../weather';

export type Table = 'places' | 'stands' | 'cameras' | 'deer' | 'sightings';

interface Base {
  id: string;
  created_at?: string;
}

/** A saved hunting location (farm, lease, public land unit). */
export interface SavedPlace extends Base {
  name: string;
  lat: number;
  lon: number;
  is_primary: boolean;
}

export interface Stand extends Base {
  place_id: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
  winds: Compass8[]; // wind directions (FROM) this stand can be hunted on
  kind: 'stand' | 'blind';
  notes: string;
}

export interface Camera extends Base {
  place_id: string | null;
  name: string;
  lat: number | null;
  lon: number | null;
  notes: string;
}

export type AgeClass = 'young' | 'mid-age' | 'mature' | 'unknown';

export interface Deer extends Base {
  name: string;
  sex: 'buck' | 'doe';
  description: string;
  points: number | null;
  age_class: AgeClass;
  is_target: boolean;
  status: 'active' | 'harvested' | 'gone';
  reference_sighting_id: string | null;
}

export type AnimalKind = 'buck' | 'doe' | 'fawn' | 'turkey' | 'other' | 'none' | 'unknown';

/** What Claude saw in a trail-cam photo (suggestions only; the user confirms). */
export interface AiResult {
  primary_kind: Exclude<AnimalKind, 'unknown'>;
  deer_count: number;
  buck_description: string;
  points_estimate: number | null;
  age_class: AgeClass;
  match_deer_id: string | null;
  match_confidence: 'high' | 'medium' | 'low' | 'none';
  match_reasoning: string;
  is_new_buck: boolean;
  stamp_datetime: string | null; // ISO local "YYYY-MM-DDTHH:MM" read from the photo's info strip
  stamp_temperature_f: number | null;
  summary: string;
  model?: string;
}

/** Weather & sky conditions at the moment of a sighting (filled in automatically). */
export interface SightingConditions {
  tempF: number;
  tempChange24h: number;
  windMph: number;
  windDirDeg: number;
  pressureHpa: number;
  pressureTrend3h: number; // hPa over prior 3h
  cloudCover: number;
  moonIllumination: number;
  minutesFromSunrise: number;
  minutesFromSunset: number;
}

export interface Sighting extends Base {
  camera_id: string | null;
  deer_id: string | null;
  taken_at: string; // ISO timestamp
  time_source: 'exif' | 'stamp' | 'file' | 'manual';
  photo_path: string | null;
  kind: AnimalKind;
  status: 'pending' | 'confirmed';
  ai: AiResult | null;
  weather: SightingConditions | null;
  notes: string;
}

export interface UserSettings {
  species: 'deer' | 'turkey';
  weeks: number;
  rutPeak: string | null; // "MM-DD"
}

export const DEFAULT_SETTINGS: UserSettings = { species: 'deer', weeks: 6, rutPeak: null };

export interface TableRows {
  places: SavedPlace;
  stands: Stand;
  cameras: Camera;
  deer: Deer;
  sightings: Sighting;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC4122-ish fallback for very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
