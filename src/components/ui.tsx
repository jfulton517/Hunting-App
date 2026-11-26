import { huntability, scoreLabel } from '../lib/scoring';
import type { Confidence } from '../lib/forecast';

export function scoreColor(score: number): string {
  const tone = scoreLabel(score).tone;
  return `var(--score-${tone})`;
}

export function ScoreBadge({ score, size = 'md', estimated = false }: { score: number; size?: 'sm' | 'md' | 'lg'; estimated?: boolean }) {
  const { label } = scoreLabel(score);
  return (
    <div className={`score-badge ${size} ${estimated ? 'estimated' : ''}`} style={{ '--c': scoreColor(score) } as React.CSSProperties} title={`Huntability ${huntability(score)}/10: ${label}${estimated ? ' (estimated)' : ''}`}>
      <span className="num">{huntability(score)}</span>
      {size !== 'sm' && <span className="lbl">{label}</span>}
    </div>
  );
}

/** Arrow pointing the direction the wind blows TOWARD (meteorological degrees are FROM). */
export function WindArrow({ deg, size = 16 }: { deg: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `rotate(${deg + 180}deg)` }} aria-hidden="true" className="wind-arrow">
      <path d="M12 3 L18 15 L12 12 L6 15 Z" fill="currentColor" />
    </svg>
  );
}

const CONF_TEXT: Record<Confidence, string> = {
  high: 'High confidence',
  good: 'Good confidence',
  moderate: 'Moderate confidence',
  low: 'Outlook: sun, moon, and season only',
};

export function ConfidencePill({ c }: { c: Confidence }) {
  return <span className={`pill conf-${c}`}>{CONF_TEXT[c]}</span>;
}

export function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, background: color ?? 'var(--accent)' }} />
    </div>
  );
}
