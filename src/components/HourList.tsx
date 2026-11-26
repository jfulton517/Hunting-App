import { useState } from 'react';
import type { HourScore } from '../lib/scoring';
import { formatHour, HOUR } from '../lib/time';
import { compass, describeWeatherCode, hpaToInHg, type HourWeather } from '../lib/weather';
import { Bar, scoreColor, WindArrow } from './ui';

export function HourList({ hours, wx, tz, now, legalStart, legalEnd }: { hours: HourScore[]; wx: Map<number, HourWeather>; tz: string; now: number; legalStart: number; legalEnd: number }) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const visible = showAll ? hours : hours.filter((h) => h.t + HOUR > legalStart - HOUR && h.t < legalEnd + HOUR);

  return (
    <div className="hour-list">
      <div className="hour-list-head">
        <h3>Hour by hour</h3>
        <label className="toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all 24 hours
        </label>
      </div>
      {visible.map((h) => {
        const w = wx.get(h.t);
        const isNow = now >= h.t && now < h.t + HOUR;
        const expanded = open === h.t;
        const code = w ? describeWeatherCode(w.weatherCode) : null;
        return (
          <div key={h.t} className={`hour ${h.legal ? '' : 'not-legal'} ${isNow ? 'now' : ''} ${expanded ? 'expanded' : ''}`}>
            <button className="hour-row" onClick={() => setOpen(expanded ? null : h.t)} aria-expanded={expanded}>
              <span className="h-time">
                {formatHour(h.t, tz)}
                {isNow && <span className="now-tag">now</span>}
              </span>
              <span className="h-bar">
                <Bar value={h.score / 100} color={scoreColor(h.score)} />
              </span>
              <span className="h-score" style={{ color: scoreColor(h.score) }}>
                {h.score}
              </span>
              {w ? (
                <span className="h-wx">
                  <span title={code!.label}>{code!.icon}</span>
                  <span>{Math.round(w.tempF)}°</span>
                  <span className="h-wind" title={`Wind from ${compass(w.windDirDeg)}`}>
                    <WindArrow deg={w.windDirDeg} size={13} />
                    {Math.round(w.windMph)}
                  </span>
                </span>
              ) : (
                <span className="h-wx muted">est.</span>
              )}
            </button>
            {expanded && (
              <div className="hour-detail">
                {!h.legal && <p className="warn-text">Outside typical legal shooting hours.</p>}
                {w && (
                  <p className="muted small">
                    {code!.label} · {Math.round(w.tempF)}°F · wind {compass(w.windDirDeg)} {Math.round(w.windMph)} mph (gusts {Math.round(w.gustMph)}) · {hpaToInHg(w.pressureHpa).toFixed(2)} inHg ·{' '}
                    {w.precipProb}% precip · {Math.round(w.cloudCover)}% clouds · {Math.round(w.humidity)}% RH
                  </p>
                )}
                {h.notes.map((n) => (
                  <p key={n} className="note">
                    ★ {n}
                  </p>
                ))}
                <ul className="factors">
                  {h.factors.map((f) => (
                    <li key={f.key} className={`factor ${f.effect}`}>
                      <div className="factor-head">
                        <span>{f.label}</span>
                        <Bar value={f.score} color={`var(--effect-${f.effect})`} />
                      </div>
                      <p>{f.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
