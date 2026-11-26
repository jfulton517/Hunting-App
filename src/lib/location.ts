export interface Place {
  lat: number;
  lon: number;
  name: string;
  source: 'gps' | 'search';
}

export function getDevicePosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available on this device.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission was denied. Search for a place instead, or allow location in your browser settings.'
              : 'Could not get your location. Try again or search for a place.',
          ),
        ),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

/** Best-effort place name for coordinates (falls back to coordinates). */
export async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const fallback = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  try {
    const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), localityLanguage: 'en' });
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}`);
    if (!res.ok) return fallback;
    const j = await res.json();
    const parts = [j.city || j.locality, j.principalSubdivisionCode?.split('-').pop() || j.principalSubdivision].filter(Boolean);
    return parts.length ? parts.join(', ') : fallback;
  } catch {
    return fallback;
  }
}

export interface SearchResult {
  name: string;
  detail: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const q = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${q}`, { signal });
  if (!res.ok) throw new Error('Place search failed');
  const j = await res.json();
  return (j.results ?? []).map((r: { name: string; admin1?: string; admin2?: string; country_code?: string; latitude: number; longitude: number }) => ({
    name: r.name,
    detail: [r.admin2, r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}
