import { useEffect, useMemo, useState } from 'react';
import { BestDays } from './components/BestDays';
import { DayDetail } from './components/DayDetail';
import { DayStrip } from './components/DayStrip';
import { LocationPicker } from './components/LocationPicker';
import { Settings, type AppSettings } from './components/Settings';
import { bestDays, buildForecast } from './lib/forecast';
import type { Place } from './lib/location';
import type { Species } from './lib/scoring';
import { load, save } from './lib/storage';
import { formatTime, HOUR } from './lib/time';
import { fetchForecast, fetchNormals, type HourWeather, type Normals, type WeatherForecast } from './lib/weather';

type Tab = 'day' | 'best';

const DEFAULT_SETTINGS: AppSettings = { weeks: 6, rutPeak: null, stands: [] };
const placeKey = (p: Place) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

interface CachedWeather {
  key: string;
  data: WeatherForecast;
}
interface CachedNormals {
  key: string;
  at: number;
  entries: [number, { highF: number; lowF: number }][];
}

export default function App() {
  const [place, setPlace] = useState<Place | null>(() => load<Place | null>('place', null));
  const [species, setSpecies] = useState<Species>(() => load<Species>('species', 'deer'));
  const [settings, setSettings] = useState<AppSettings>(() => ({ ...DEFAULT_SETTINGS, ...load<Partial<AppSettings>>('settings', {}) }));
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [normals, setNormals] = useState<Normals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('day');
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => save('species', species), [species]);
  useEffect(() => save('settings', settings), [settings]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Load weather + climate normals whenever the place changes.
  useEffect(() => {
    if (!place) return;
    const key = placeKey(place);
    const cachedWx = load<CachedWeather | null>('weather', null);
    const cachedNormals = load<CachedNormals | null>('normals', null);
    const wxFresh = cachedWx?.key === key && Date.now() - cachedWx.data.fetchedAt < HOUR;
    if (cachedWx?.key === key) setWeather(cachedWx.data);
    else setWeather(null);
    if (cachedNormals?.key === key) setNormals({ byDayOfYear: new Map(cachedNormals.entries) });
    else setNormals(null);

    const ctrl = new AbortController();
    setError(null);
    if (!wxFresh || reloadTick > 0) {
      setLoading(true);
      fetchForecast(place.lat, place.lon, ctrl.signal)
        .then((data) => {
          setWeather(data);
          setNow(Date.now());
          save('weather', { key, data } satisfies CachedWeather);
        })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          setError(cachedWx?.key === key ? `Couldn't refresh the weather, so you're seeing the forecast from ${new Date(cachedWx.data.fetchedAt).toLocaleString()}.` : `Couldn't load the weather (${e.message}). Showing a sun, moon, and season outlook only.`);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }
    if (!(cachedNormals?.key === key && Date.now() - cachedNormals.at < 30 * 24 * HOUR)) {
      fetchNormals(place.lat, place.lon, ctrl.signal)
        .then((n) => {
          if (!n) return;
          setNormals(n);
          save('normals', { key, at: Date.now(), entries: [...n.byDayOfYear.entries()] } satisfies CachedNormals);
        })
        .catch(() => {});
    }
    return () => ctrl.abort();
  }, [place, reloadTick]);

  const forecast = useMemo(() => {
    if (!place) return null;
    return buildForecast({
      lat: place.lat,
      lon: place.lon,
      species,
      weather,
      normals,
      days: settings.weeks * 7,
      now,
      rutPeak: settings.rutPeak,
    });
    // `now` only matters when the day rolls over; recompute is cheap enough anyway.
  }, [place, species, weather, normals, settings.weeks, settings.rutPeak, now]);

  const wxMap = useMemo(() => new Map<number, HourWeather>((weather?.hours ?? []).map((h) => [h.time, h])), [weather]);
  const topKeys = useMemo(() => {
    if (!forecast) return new Set<string>();
    const real = bestDays(forecast.days.filter((d) => !d.estimated), 3);
    return new Set(real.map((d) => d.key));
  }, [forecast]);

  const selectedDay = forecast?.days.find((d) => d.key === selected) ?? forecast?.days[0] ?? null;

  const pickPlace = (p: Place) => {
    setPlace(p);
    save('place', p);
    setPicking(false);
    setSelected(null);
  };

  if (!place || picking) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>
            <span className="logo">⌖</span> Hunt Forecast
          </h1>
        </header>
        {!place && (
          <div className="intro">
            <h2>Whitetail & turkey hunting forecast</h2>
            <p>Hour-by-hour hunting scores from weather, wind, barometric pressure, moon phase, solunar periods, and rut or gobbling season. It also ranks the best days up to 8 weeks out.</p>
          </div>
        )}
        <LocationPicker onPick={pickPlace} onCancel={place ? () => setPicking(false) : undefined} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <button className="place-btn" onClick={() => setPicking(true)} title="Change location">
          <span className="logo">⌖</span>
          <span className="place-name">{place.name}</span>
          <span className="muted">▾</span>
        </button>
        <div className="header-actions">
          <button className="btn ghost icon" onClick={() => setReloadTick((t) => t + 1)} disabled={loading} aria-label="Refresh forecast" title="Refresh">
            <span className={loading ? 'spin' : ''}>↻</span>
          </button>
          <button className="btn ghost icon" onClick={() => setShowSettings(true)} aria-label="Settings" title="Settings">
            ⚙
          </button>
        </div>
      </header>

      <div className="seg species">
        <button className={species === 'deer' ? 'active' : ''} onClick={() => setSpecies('deer')}>
          🦌 Whitetail
        </button>
        <button className={species === 'turkey' ? 'active' : ''} onClick={() => setSpecies('turkey')}>
          🦃 Turkey
        </button>
      </div>

      {error && <div className="banner warn">{error}</div>}
      {loading && !weather && <div className="banner">Loading the forecast…</div>}

      {forecast && (
        <>
          <DayStrip days={forecast.days} tz={forecast.tz} selected={selectedDay?.key ?? ''} topKeys={topKeys} onSelect={(k) => { setSelected(k); setTab('day'); }} />
          <div className="seg tabs">
            <button className={tab === 'day' ? 'active' : ''} onClick={() => setTab('day')}>
              Day detail
            </button>
            <button className={tab === 'best' ? 'active' : ''} onClick={() => setTab('best')}>
              Best days
            </button>
          </div>
          {tab === 'day' && selectedDay && <DayDetail day={selectedDay} tz={forecast.tz} species={species} wx={wxMap} now={now} stands={settings.stands} />}
          {tab === 'best' && (
            <BestDays
              days={forecast.days}
              tz={forecast.tz}
              onOpen={(k) => {
                setSelected(k);
                setTab('day');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          )}
        </>
      )}

      <footer className="footer small muted">
        {weather && <div>Weather updated {formatTime(weather.fetchedAt, forecast?.tz ?? 'UTC')} · Open-Meteo</div>}
        <div>*Legal hours are typical only. Always follow your state's regulations and season dates.</div>
      </footer>

      {showSettings && <Settings settings={settings} lat={place.lat} onChange={setSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
