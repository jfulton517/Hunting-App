import { useEffect, useMemo, useState } from 'react';
import { Account } from './components/Account';
import { AuthScreen, NewPasswordForm } from './components/AuthScreen';
import { BestDays } from './components/BestDays';
import { Bucks } from './components/Bucks';
import { DayDetail } from './components/DayDetail';
import { DayStrip } from './components/DayStrip';
import { LocationPicker } from './components/LocationPicker';
import { TrailCam } from './components/TrailCam';
import { DataProvider, useData } from './lib/data/store';
import { newId } from './lib/data/types';
import { bestDays, buildForecast } from './lib/forecast';
import type { Place } from './lib/location';
import { load, save } from './lib/storage';
import { formatTime, HOUR } from './lib/time';
import { fetchForecast, fetchNormals, type HourWeather, type Normals, type WeatherForecast } from './lib/weather';

type Tab = 'forecast' | 'bucks' | 'cam' | 'account';
type ForecastView = 'day' | 'best';

const placeKey = (p: { lat: number; lon: number }) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

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
  return (
    <DataProvider>
      <Gate />
    </DataProvider>
  );
}

function Gate() {
  const { auth } = useData();
  const [recovery, setRecovery] = useState(() => window.location.hash.includes('type=recovery'));
  if (auth === 'loading')
    return (
      <div className="app">
        <div className="banner">Loading…</div>
      </div>
    );
  if (auth === 'signed-out') return <AuthScreen />;
  return (
    <>
      {recovery && (
        <div className="app">
          <NewPasswordForm
            onDone={() => {
              setRecovery(false);
              history.replaceState(null, '', window.location.pathname);
            }}
          />
        </div>
      )}
      <Main />
    </>
  );
}

function useWeather(place: Place | null, reloadTick: number) {
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [normals, setNormals] = useState<Normals | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!place) return;
    const key = placeKey(place);
    const cachedWx = load<CachedWeather | null>('weather', null);
    const cachedNormals = load<CachedNormals | null>('normals', null);
    const wxFresh = cachedWx?.key === key && Date.now() - cachedWx.data.fetchedAt < HOUR;
    setWeather(cachedWx?.key === key ? cachedWx.data : null);
    setNormals(cachedNormals?.key === key ? { byDayOfYear: new Map(cachedNormals.entries) } : null);

    const ctrl = new AbortController();
    setError(null);
    if (!wxFresh || reloadTick > 0) {
      setLoading(true);
      fetchForecast(place.lat, place.lon, ctrl.signal)
        .then((data) => {
          setWeather(data);
          save('weather', { key, data } satisfies CachedWeather);
        })
        .catch((e) => {
          if (e.name === 'AbortError') return;
          setError(
            cachedWx?.key === key
              ? `Couldn't refresh the weather, so you're seeing the forecast from ${new Date(cachedWx.data.fetchedAt).toLocaleString()}.`
              : `Couldn't load the weather (${e.message}). Showing a sun, moon, and season outlook only.`,
          );
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

  return { weather, normals, loading, error };
}

function Main() {
  const { rows, settings, setSettings, save: saveRow, loaded, error: dataError } = useData();
  const [place, setPlace] = useState<Place | null>(() => load<Place | null>('place', null));
  const [tab, setTab] = useState<Tab>('forecast');
  const [view, setView] = useState<ForecastView>('day');
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [openDeer, setOpenDeer] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reloadTick, setReloadTick] = useState(0);
  const species = settings.species;

  // Default to the account's primary hunting place when nothing is chosen on this device.
  useEffect(() => {
    if (place || !loaded) return;
    const primary = rows.places.find((p) => p.is_primary) ?? rows.places[0];
    if (primary) setPlace({ lat: primary.lat, lon: primary.lon, name: primary.name, source: 'search' });
  }, [loaded, place, rows.places]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const { weather, normals, loading, error } = useWeather(place, reloadTick);

  const forecast = useMemo(() => {
    if (!place) return null;
    return buildForecast({ lat: place.lat, lon: place.lon, species, weather, normals, days: settings.weeks * 7, now, rutPeak: settings.rutPeak });
  }, [place, species, weather, normals, settings.weeks, settings.rutPeak, now]);
  // Target-buck recommendations are always for deer, whichever species the forecast tab shows.
  const deerForecast = useMemo(() => {
    if (!place) return null;
    if (species === 'deer') return forecast;
    return buildForecast({ lat: place.lat, lon: place.lon, species: 'deer', weather, normals, days: 16, now, rutPeak: settings.rutPeak });
  }, [place, species, forecast, weather, normals, now, settings.rutPeak]);

  const wxMap = useMemo(() => new Map<number, HourWeather>((weather?.hours ?? []).map((h) => [h.time, h])), [weather]);
  const topKeys = useMemo(() => new Set(forecast ? bestDays(forecast.days.filter((d) => !d.estimated), 3).map((d) => d.key) : []), [forecast]);
  const selectedDay = forecast?.days.find((d) => d.key === selected) ?? forecast?.days[0] ?? null;
  const tz = forecast?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pendingCount = rows.sightings.filter((s) => s.status === 'pending').length;
  const savedHere = place && rows.places.find((p) => placeKey(p) === placeKey(place));

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
            <p>Hourly 1–10 Huntability scores from weather, wind, barometric pressure, moon phase, solunar periods, and rut or gobbling season. It also ranks the best days up to 8 weeks out and tracks your target bucks on trail cameras.</p>
          </div>
        )}
        {rows.places.length > 0 && (
          <div className="card">
            <h3>My hunting places</h3>
            {rows.places.map((p) => (
              <button key={p.id} className="list-row as-button" onClick={() => pickPlace({ lat: p.lat, lon: p.lon, name: p.name, source: 'search' })}>
                <strong>{p.name}</strong>
                {p.is_primary && <span className="pill phase">Primary</span>}
              </button>
            ))}
          </div>
        )}
        <LocationPicker onPick={pickPlace} onCancel={place ? () => setPicking(false) : undefined} />
      </div>
    );
  }

  return (
    <div className="app with-nav">
      <header className="app-header">
        <button className="place-btn" onClick={() => setPicking(true)} title="Change location">
          <span className="logo">⌖</span>
          <span className="place-name">{place.name}</span>
          <span className="muted">▾</span>
        </button>
        <div className="header-actions">
          {!savedHere && (
            <button
              className="btn ghost small"
              title="Save as a hunting place"
              onClick={() => saveRow('places', { id: newId(), name: place.name, lat: place.lat, lon: place.lon, is_primary: rows.places.length === 0 })}
            >
              ☆ Save
            </button>
          )}
          <button className="btn ghost icon" onClick={() => setReloadTick((t) => t + 1)} disabled={loading} aria-label="Refresh forecast" title="Refresh">
            <span className={loading ? 'spin' : ''}>↻</span>
          </button>
        </div>
      </header>

      {dataError && <div className="banner warn">{dataError}</div>}

      {tab === 'forecast' && (
        <>
          <div className="seg species">
            <button className={species === 'deer' ? 'active' : ''} onClick={() => setSettings({ ...settings, species: 'deer' })}>
              🦌 Whitetail
            </button>
            <button className={species === 'turkey' ? 'active' : ''} onClick={() => setSettings({ ...settings, species: 'turkey' })}>
              🦃 Turkey
            </button>
          </div>
          {error && <div className="banner warn">{error}</div>}
          {loading && !weather && <div className="banner">Loading the forecast…</div>}
          {forecast && (
            <>
              <DayStrip
                days={forecast.days}
                tz={tz}
                selected={selectedDay?.key ?? ''}
                topKeys={topKeys}
                onSelect={(k) => {
                  setSelected(k);
                  setView('day');
                }}
              />
              <div className="seg tabs">
                <button className={view === 'day' ? 'active' : ''} onClick={() => setView('day')}>
                  Day detail
                </button>
                <button className={view === 'best' ? 'active' : ''} onClick={() => setView('best')}>
                  Best days
                </button>
              </div>
              {view === 'day' && selectedDay && <DayDetail day={selectedDay} tz={tz} species={species} wx={wxMap} now={now} stands={rows.stands} />}
              {view === 'best' && (
                <BestDays
                  days={forecast.days}
                  tz={tz}
                  onOpen={(k) => {
                    setSelected(k);
                    setView('day');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              )}
            </>
          )}
          <footer className="footer small muted">
            {weather && <div>Weather updated {formatTime(weather.fetchedAt, tz)} · Open-Meteo</div>}
            <div>*Legal hours are typical only. Always follow your state's regulations and season dates.</div>
          </footer>
        </>
      )}

      {tab === 'bucks' && deerForecast && <Bucks fc={{ days: deerForecast.days, wx: wxMap, tz, place }} openId={openDeer} onOpen={setOpenDeer} />}
      {tab === 'cam' && <TrailCam tz={tz} />}
      {tab === 'account' && <Account lat={place.lat} />}

      <nav className="bottom-nav" aria-label="Sections">
        {(
          [
            ['forecast', '📈', 'Forecast'],
            ['bucks', '🦌', 'Bucks'],
            ['cam', '📷', 'Trail Cam'],
            ['account', '👤', 'Account'],
          ] as const
        ).map(([key, icon, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => {
              setTab(key);
              window.scrollTo({ top: 0 });
            }}
          >
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
            {key === 'cam' && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
