import { useEffect, useState } from 'react';
import { getDevicePosition, reverseGeocode, searchPlaces, type Place, type SearchResult } from '../lib/location';

export function LocationPicker({ onPick, onCancel }: { onPick: (p: Place) => void; onCancel?: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      searchPlaces(query.trim(), ctrl.signal)
        .then(setResults)
        .catch((e) => e.name !== 'AbortError' && setError('Place search is unavailable right now.'));
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const useGps = async () => {
    setBusy(true);
    setError(null);
    try {
      const { lat, lon } = await getDevicePosition();
      const name = await reverseGeocode(lat, lon);
      onPick({ lat, lon, name, source: 'gps' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="location-picker card">
      <button className="btn primary block" onClick={useGps} disabled={busy}>
        {busy ? 'Finding you…' : '📍 Use my current location'}
      </button>
      <div className="divider">or search for a town, county or zip</div>
      <input
        className="input"
        type="search"
        placeholder="e.g. Peoria, IL"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={!onCancel ? false : true}
      />
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button onClick={() => onPick({ lat: r.lat, lon: r.lon, name: r.detail ? `${r.name}, ${r.detail.split(', ').slice(-2, -1)[0] ?? r.detail}` : r.name, source: 'search' })}>
                <strong>{r.name}</strong>
                <span className="muted">{r.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
      {onCancel && (
        <button className="btn ghost block" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}
