import { bestDays, type DayForecast } from '../lib/forecast';
import { formatDay, formatTime, localParts } from '../lib/time';
import { ConfidencePill, ScoreBadge, scoreColor } from './ui';

function DayCard({ d, tz, rank, onOpen }: { d: DayForecast; tz: string; rank: number; onOpen: (k: string) => void }) {
  return (
    <button className="card best-card" onClick={() => onOpen(d.key)}>
      <div className="rank">#{rank}</div>
      <div className="best-main">
        <div className="best-date">{formatDay(d.midnight + 12 * 3600e3, tz, { weekday: 'long' })}</div>
        {d.best && (
          <div className="small">
            Best: {formatTime(d.best.start, tz)}–{formatTime(d.best.end, tz)} ({d.best === d.morning ? 'morning' : 'evening'})
          </div>
        )}
        <div className="small muted">
          {d.moon.emoji} {d.moon.name} · {d.phase.name}
        </div>
        <ul className="mini-highlights">
          {d.highlights.slice(0, 3).map((h) => (
            <li key={h.text} className={h.effect}>
              {h.effect === 'good' ? '▲' : '▼'} {h.text}
            </li>
          ))}
        </ul>
        <ConfidencePill c={d.confidence} />
      </div>
      <ScoreBadge score={d.score} estimated={d.estimated} />
    </button>
  );
}

export function BestDays({ days, tz, onOpen }: { days: DayForecast[]; tz: string; onOpen: (k: string) => void }) {
  const forecastDays = days.filter((d) => !d.estimated);
  const outlookDays = days.filter((d) => d.estimated);
  const topForecast = bestDays(forecastDays, 5);
  const topOutlook = bestDays(outlookDays, 5);

  // Calendar grid: weeks starting Sunday
  let offset = 0;
  if (days.length) {
    const p = localParts(days[0].midnight + 12 * 3600e3, tz);
    offset = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  }
  const cells: (DayForecast | null)[] = [...Array(offset).fill(null), ...days];

  return (
    <section className="best-days">
      <h2>Best days, next {forecastDays.length} days</h2>
      <p className="muted small">Ranked from the hourly weather forecast plus sun, moon, and season.</p>
      {topForecast.map((d, i) => (
        <DayCard key={d.key} d={d} tz={tz} rank={i + 1} onOpen={onOpen} />
      ))}

      {topOutlook.length > 0 && (
        <>
          <h2>Long-range picks</h2>
          <p className="muted small">
            Weather can't be forecast reliably this far out, so these days are ranked on solunar timing, moon phase, and {`rut/season`} phase. Check back as they come into the 16-day forecast.
          </p>
          {topOutlook.map((d, i) => (
            <DayCard key={d.key} d={d} tz={tz} rank={i + 1} onOpen={onOpen} />
          ))}
        </>
      )}

      <h2>Calendar</h2>
      <div className="calendar">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="cal-head">
            {d}
          </div>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button key={d.key} className={`cal-cell ${d.estimated ? 'estimated' : ''}`} style={{ background: scoreColor(d.score) }} onClick={() => onOpen(d.key)} title={`${d.key}: ${d.score}`}>
              <span className="cal-day">{localParts(d.midnight + 12 * 3600e3, tz).day}</span>
              <span className="cal-score">{d.score}</span>
            </button>
          ) : (
            <div key={`e${i}`} />
          ),
        )}
      </div>
      <p className="muted small">Faded cells are long-range outlook days, scored without weather.</p>
    </section>
  );
}
