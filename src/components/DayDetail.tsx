import type { DayForecast, ScoreWindow } from '../lib/forecast';
import { huntability, legalWindow, type Species } from '../lib/scoring';
import { formatDay, formatTime } from '../lib/time';
import { compass, describeWeatherCode, hpaToInHg, type HourWeather } from '../lib/weather';
import { standsFor, windAdvice, type Stand } from '../lib/wind';
import { HourList } from './HourList';
import { ConfidencePill, ScoreBadge, WindArrow, scoreColor } from './ui';

function WindowCard({ title, w, tz, dir, stands, species }: { title: string; w: ScoreWindow | null; tz: string; dir: number | null; stands: Stand[]; species: Species }) {
  if (!w) return null;
  const { good } = standsFor(stands, dir);
  return (
    <div className="window-card">
      <div className="window-title">{title}</div>
      <div className="window-time">
        {formatTime(w.start, tz)} – {formatTime(w.end, tz)}
      </div>
      <div className="window-score" style={{ color: scoreColor(w.score) }}>
        {huntability(w.score)}
      </div>
      {dir != null && (
        <div className="window-wind">
          <WindArrow deg={dir} size={14} /> wind from {compass(dir)}
        </div>
      )}
      {species === 'deer' && stands.length > 0 && dir != null && (
        <div className="window-stands">{good.length ? `✓ ${good.map((s) => s.name).join(', ')}` : 'No saved stand fits this wind'}</div>
      )}
    </div>
  );
}

export function DayDetail({ day, tz, species, wx, now, stands }: { day: DayForecast; tz: string; species: Species; wx: Map<number, HourWeather>; now: number; stands: Stand[] }) {
  const [legalStart, legalEnd] = legalWindow(species, day.sun);
  const s = day.summary;
  const code = s ? describeWeatherCode(s.weatherCode) : null;
  const primeDir = day.best && day.best === day.morning ? day.windDir.morning : day.windDir.evening;
  const majors = day.solunar.filter((p) => p.type === 'major');
  const minors = day.solunar.filter((p) => p.type === 'minor');

  return (
    <section className="day-detail">
      <div className="card day-head">
        <div>
          <h2>{day.leadDays === 0 ? 'Today' : day.leadDays === 1 ? 'Tomorrow' : formatDay(day.midnight + 12 * 3600e3, tz, { weekday: 'long' })}</h2>
          <div className="muted">{formatDay(day.midnight + 12 * 3600e3, tz, { weekday: 'long', month: 'long' })}</div>
          <div className="pills">
            <ConfidencePill c={day.confidence} />
            <span className="pill phase">{day.phase.name}</span>
          </div>
        </div>
        <ScoreBadge score={day.score} size="lg" estimated={day.estimated} />
      </div>

      <div className="windows">
        <WindowCard title="Best morning" w={day.morning} tz={tz} dir={day.windDir.morning} stands={stands} species={species} />
        <WindowCard title="Best evening" w={day.evening} tz={tz} dir={day.windDir.evening} stands={stands} species={species} />
      </div>

      {day.highlights.length > 0 && (
        <ul className="highlights">
          {day.highlights.map((h) => (
            <li key={h.text} className={h.effect}>
              {h.effect === 'good' ? '▲' : '▼'} {h.text}
            </li>
          ))}
        </ul>
      )}

      <div className="grid-2">
        <div className="card mini">
          <h3>Weather</h3>
          {s ? (
            <>
              <div className="big">
                {code!.icon} {Math.round(s.highF)}° / {Math.round(s.lowF)}°
              </div>
              <div className="muted small">{code!.label}</div>
              {day.normal && (
                <div className="small">
                  Normal {Math.round(day.normal.highF)}° / {Math.round(day.normal.lowF)}°
                  {day.tempAnomaly != null && (
                    <span className={day.tempAnomaly < 0 ? 'cold' : 'warm'}>
                      {' '}
                      ({day.tempAnomaly > 0 ? '+' : ''}
                      {Math.round(day.tempAnomaly)}°)
                    </span>
                  )}
                </div>
              )}
              <div className="small">Wind up to {Math.round(s.maxWindMph)} mph</div>
              <div className="small">
                Precip {s.precipIn.toFixed(2)}″ ({s.precipProbMax}% max)
              </div>
              <div className="small">
                Pressure {s.pressureChangeHpa >= 0 ? '↑' : '↓'} {Math.abs(hpaToInHg(s.pressureChangeHpa)).toFixed(2)} inHg over the day
              </div>
            </>
          ) : (
            <>
              <p className="small muted">This day is beyond the 16-day weather forecast, so it's scored on sun, moon, solunar, and season only.</p>
              {day.normal && (
                <div className="small">
                  Typical: {Math.round(day.normal.highF)}° / {Math.round(day.normal.lowF)}°
                </div>
              )}
            </>
          )}
        </div>
        <div className="card mini">
          <h3>Sun & moon</h3>
          <div className="small">
            Legal light* {formatTime(legalStart, tz)} – {formatTime(legalEnd, tz)}
          </div>
          <div className="small">
            ☀ {formatTime(day.sun.sunrise, tz)} – {formatTime(day.sun.sunset, tz)}
          </div>
          <div className="small">
            {day.moon.emoji} {day.moon.name} · {Math.round(day.moon.illumination * 100)}%
          </div>
          {day.moonEvents
            .filter((e) => e.type === 'rise' || e.type === 'set')
            .map((e) => (
              <div className="small muted" key={e.time}>
                Moon{e.type} {formatTime(e.time, tz)}
              </div>
            ))}
          <div className="small">
            <strong>Major:</strong> {majors.map((p) => `${formatTime(p.start, tz)}–${formatTime(p.end, tz)}`).join(', ') || 'none'}
          </div>
          <div className="small">
            <strong>Minor:</strong> {minors.map((p) => `${formatTime(p.start, tz)}–${formatTime(p.end, tz)}`).join(', ') || 'none'}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>{day.phase.name}</h3>
        <p className="small">{day.phase.note}</p>
        {species === 'deer' && primeDir != null && (
          <>
            <h3>Wind & setup</h3>
            <p className="small">{windAdvice(primeDir)}</p>
            <p className="small muted">
              Thermals: cool morning and evening air sinks and pulls scent downhill. Midday warming lifts it uphill. Factor both into how you approach your stand.
            </p>
          </>
        )}
        {species === 'turkey' && <p className="small muted">Turkey tip: roost birds the evening before, and set up 100–150 yards from the roost before first light, not under it.</p>}
      </div>

      <div className="card">
        <HourList hours={day.hours} wx={wx} tz={tz} now={now} legalStart={legalStart} legalEnd={legalEnd} />
      </div>
    </section>
  );
}
