import { useEffect, useRef } from 'react';
import type { DayForecast } from '../lib/forecast';
import { huntability } from '../lib/scoring';
import { formatDay } from '../lib/time';
import { scoreColor } from './ui';

export function DayStrip({ days, tz, selected, onSelect, topKeys }: { days: DayForecast[]; tz: string; selected: string; onSelect: (k: string) => void; topKeys: Set<string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.selected')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [selected]);
  return (
    <div className="day-strip" ref={ref} role="tablist" aria-label="Choose a day">
      {days.map((d, i) => {
        const showDivider = i > 0 && d.estimated && !days[i - 1].estimated;
        return (
          <div key={d.key} className="day-chip-wrap">
            {showDivider && <div className="strip-divider" title="Beyond weather forecast">Outlook</div>}
            <button
              role="tab"
              aria-selected={selected === d.key}
              className={`day-chip ${selected === d.key ? 'selected' : ''} ${d.estimated ? 'estimated' : ''}`}
              onClick={() => onSelect(d.key)}
            >
              <span className="dow">{i === 0 ? 'Today' : formatDay(d.midnight + 12 * 3600e3, tz, { weekday: 'short', month: undefined, day: undefined })}</span>
              <span className="date">{formatDay(d.midnight + 12 * 3600e3, tz, { weekday: undefined })}</span>
              <span className="chip-score" style={{ background: scoreColor(d.score) }}>
                {huntability(d.score)}
              </span>
              {topKeys.has(d.key) && <span className="star" title="One of the best days">★</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
}
