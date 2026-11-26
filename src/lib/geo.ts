const R = 6371000; // meters
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in meters. */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Initial compass bearing in degrees (0 = north) from point 1 to point 2. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Smallest absolute difference between two compass angles (0..180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export function formatDistance(m: number): string {
  const yards = m * 1.09361;
  return yards < 1000 ? `${Math.round(yards / 10) * 10} yd` : `${(m / 1609.34).toFixed(1)} mi`;
}

/**
 * Would a hunter at `stand` be scented by deer at `target` with wind blowing FROM windDeg?
 * Scent drifts toward windDeg + 180. If the target lies within ±60° of that drift, it's downwind.
 */
export function targetIsDownwind(stand: { lat: number; lon: number }, target: { lat: number; lon: number }, windDeg: number): boolean {
  const toTarget = bearingDeg(stand.lat, stand.lon, target.lat, target.lon);
  return angleDiff(toTarget, (windDeg + 180) % 360) < 60;
}
