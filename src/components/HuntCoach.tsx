import { useEffect, useMemo, useRef, useState } from 'react';
import { coach, scentTips, type CoachAdvice, type CoachInput, type Tip, type TipCategory } from '../lib/coach';
import { useData } from '../lib/data/store';
import { newId, type Hunt, type HuntEvent, type HuntEventKind } from '../lib/data/types';
import { load, save as saveLocal } from '../lib/storage';
import { DAY, formatTime, HOUR, MINUTE } from '../lib/time';
import { useDeerAnalysis } from '../lib/useDeerAnalysis';
import { compass, hpaToInHg } from '../lib/weather';
import type { ForecastCtx } from './CameraInsights';
import { WindArrow } from './ui';

const EVENT_LABEL: Record<HuntEventKind, string> = {
  saw_buck: 'Saw a buck',
  saw_doe: 'Saw does',
  saw_target: 'Saw my target',
  buck_hung_up: 'Hung up',
  heard_gobble: 'Heard a gobble',
  saw_turkey: 'Saw turkeys',
  called: 'Called',
  bumped: 'Bumped deer',
  moved: 'Moved stands',
  harvest: 'Harvest!',
};

const CATEGORY_LABEL: Partial<Record<TipCategory, string>> = {
  scent: 'Scent control',
  attractant: 'Attractants & scents',
  decoy: 'Decoys',
  wind: 'Wind & thermals',
  stand: 'Stand strategy',
  safety: 'Safety',
};

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Keep the phone screen on during the hunt (where supported). */
function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: { release(): Promise<void> } | null = null;
    const acquire = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
      } catch {
        /* battery saver or not allowed */
      }
    };
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}

function countdown(ms: number) {
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / MINUTE);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

function TipGroups({ tips }: { tips: Tip[] }) {
  const groups = new Map<TipCategory, string[]>();
  for (const t of tips) {
    if (t.category === 'now') continue;
    if (!groups.has(t.category)) groups.set(t.category, []);
    if (!groups.get(t.category)!.includes(t.text)) groups.get(t.category)!.push(t.text);
  }
  return (
    <>
      {[...groups.entries()].map(([cat, list]) => (
        <details key={cat} className="card tip-group" open={cat === 'stand'}>
          <summary>
            <h3>{CATEGORY_LABEL[cat] ?? cat}</h3>
          </summary>
          <ul>
            {list.map((t) => (
              <li key={t} className="small">
                {t}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </>
  );
}

function situationText(a: CoachAdvice, input: CoachInput, standName: string | null, targetName: string | null): string {
  const w = input.wx.get(Math.floor(input.now / HOUR) * HOUR);
  const lines = [
    `Species: ${input.species}. Local time: ${formatTime(input.now, input.tz)}. Phase: ${a.phase.label}. Season: ${input.day.phase.name}.`,
    `Sunrise ${formatTime(input.day.sun.sunrise, input.tz)}, sunset ${formatTime(input.day.sun.sunset, input.tz)}. Moon: ${input.day.moon.name}.`,
    w ? `Weather now: ${Math.round(w.tempF)}°F, wind ${compass(w.windDirDeg)} ${Math.round(w.windMph)} mph (gusts ${Math.round(w.gustMph)}), pressure ${hpaToInHg(w.pressureHpa).toFixed(2)} inHg, ${w.cloudCover}% clouds, precip ${w.precipIn} in/hr.` : 'Weather: unknown.',
    standName ? `Hunter is in: ${standName}${input.stand?.winds.length ? ` (good winds: ${input.stand.winds.join(', ')})` : ''}.` : 'No stand chosen.',
    targetName ? `Target buck: ${targetName}. ${input.target?.pattern.summary.join(' ')}` : '',
    `Coach says: ${a.headline} Calling plan: ${a.calling.technique}.`,
    a.alerts.length ? `Alerts: ${a.alerts.map((x) => x.text).join(' ')}` : '',
    input.events.length ? `Logged this hunt: ${input.events.map((e) => `${formatTime(e.t, input.tz)} ${EVENT_LABEL[e.kind]}`).join('; ')}.` : 'Nothing logged yet.',
  ];
  return lines.filter(Boolean).join('\n');
}

function AskCoach({ advice, input, standName, targetName }: { advice: CoachAdvice; input: CoachInput; standName: string | null; targetName: string | null }) {
  const { repo, settings, auth } = useData();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (auth !== 'signed-in' || settings.aiTier === 'off' || !repo.askCoach)
    return (
      <section className="card">
        <h3>Ask the coach</h3>
        <p className="small muted">Ask the AI coach anything mid-hunt, like "buck hung up at 80 yards, what now?" This is part of the optional AI upgrade (Account tab): well under a penny per question on Basic, and a few cents on Pro.</p>
      </section>
    );
  const ask = async (question: string) => {
    setBusy(true);
    setError(null);
    try {
      const answer = await repo.askCoach!({ tier: settings.aiTier as 'basic' | 'pro', question, situation: situationText(advice, input, standName, targetName), history });
      setHistory((h) => [...h, { q: question, a: answer }]);
      setQ('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h3>Ask the coach</h3>
      {history.map((h, i) => (
        <div key={i} className="qa">
          <p className="small q">You: {h.q}</p>
          <p className="small a">{h.a}</p>
        </div>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q.trim());
        }}
      >
        <input className="input" placeholder="e.g. Buck hung up at 80 yards. What now?" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
        <button className="btn primary" disabled={busy || !q.trim()}>
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      <div className="chips">
        {(input.species === 'deer'
          ? ['Should I rattle now?', 'Should I move stands?', 'Where should I hang my scent wicks?', "Deer are blowing at me. What now?"]
          : ['He gobbles but won\'t come', 'Should I move closer?', 'Where do I put my decoy?']
        ).map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>
      {error && <p className="small warn-text">{error}</p>}
    </section>
  );
}

export function HuntCoach({ fc }: { fc: ForecastCtx | null }) {
  const { rows, settings, save } = useData();
  const species = settings.species;
  const active = rows.hunts.filter((h) => !h.ended_at).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0] ?? null;
  const now = useNow(active ? 20_000 : 60_000);
  const [standId, setStandId] = useState<string | null>(() => active?.stand_id ?? load<string | null>('coach:stand', null));
  const targets = rows.deer.filter((d) => d.sex === 'buck' && d.status === 'active').sort((a, b) => Number(b.is_target) - Number(a.is_target));
  const [targetId, setTargetId] = useState<string | null>(() => active?.target_deer_id ?? targets[0]?.id ?? null);
  const [keepOn, setKeepOn] = useState(() => load('coach:keepOn', true));
  const [red, setRed] = useState(() => load('coach:red', false));
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [endNotes, setEndNotes] = useState('');
  useWakeLock(!!active && keepOn);

  const huntSpecies = active?.species ?? species;
  const stand = rows.stands.find((s) => s.id === (active?.stand_id ?? standId)) ?? null;
  const targetDeer = rows.deer.find((d) => d.id === (active?.target_deer_id ?? targetId)) ?? null;
  const { pattern } = useDeerAnalysis(huntSpecies === 'deer' ? targetDeer : null, fc?.place ?? null);

  const day = fc ? fc.days.find((d) => now >= d.midnight && now < d.midnight + DAY) ?? fc.days[0] : null;
  const input: CoachInput | null = useMemo(
    () =>
      fc && day
        ? {
            species: huntSpecies,
            now,
            startedAt: active ? Date.parse(active.started_at) : null,
            day,
            wx: fc.wx,
            stand,
            stands: rows.stands,
            cameras: rows.cameras,
            target: huntSpecies === 'deer' && targetDeer && pattern && pattern.confidence !== 'none' ? { deer: targetDeer, pattern } : null,
            events: active?.events ?? [],
            tz: fc.tz,
          }
        : null,
    [fc, day, huntSpecies, now, active, stand, rows.stands, rows.cameras, targetDeer, pattern],
  );
  const advice = useMemo(() => (input ? coach(input) : null), [input]);

  // Buzz once for each new important alert (Android; iPhones ignore vibration from web apps).
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!advice || !active) return;
    const fresh = advice.alerts.filter((a) => a.level !== 'info' && !seen.current.has(a.id));
    fresh.forEach((a) => seen.current.add(a.id));
    if (fresh.length && 'vibrate' in navigator) navigator.vibrate?.([180, 90, 180]);
  }, [advice, active]);

  if (!fc || !day || !input || !advice) return <div className="banner">Loading the forecast for the coach…</div>;

  const log = async (kind: HuntEventKind, extra: Partial<HuntEvent> = {}) => {
    if (!active) return;
    await save('hunts', { ...active, events: [...active.events, { t: Date.now(), kind, standId: active.stand_id, ...extra }] });
  };
  const startHunt = async () => {
    const h: Hunt = { id: newId(), species, stand_id: standId, target_deer_id: species === 'deer' ? targetId : null, started_at: new Date().toISOString(), ended_at: null, events: [], notes: '' };
    saveLocal('coach:stand', standId);
    await save('hunts', h);
  };

  // ------------------------------------------------------------------ planning
  if (!active) {
    const recent = rows.hunts.filter((h) => h.ended_at).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 5);
    const prep = scentTips(species, advice.wind?.mph ?? null);
    return (
      <div className="coach">
        <div className="intro">
          <h2>Hunting coach</h2>
          <p>Your guide from walk-in to walk-out: when to call and how, which stand fits the wind, when to move, and scent control.</p>
        </div>
        <section className="card">
          <h3>Today: {advice.phase.label}</h3>
          <p>{advice.headline}</p>
          {advice.wind && (
            <p className="small inline-wind">
              <WindArrow deg={advice.wind.deg} size={14} /> Wind {compass(advice.wind.deg)} {Math.round(advice.wind.mph)} mph
            </p>
          )}
          {advice.approach && <p className="small">🚶 {advice.approach}</p>}
        </section>

        {species === 'deer' && (
          <section className="card">
            <h3>Choose your stand</h3>
            {rows.stands.length === 0 && <p className="small muted">Add your stands and their good winds under Account → Stands & blinds to get stand advice.</p>}
            {advice.stands.map((o, i) => (
              <label key={o.stand.id} className={`stand-pick ${standId === o.stand.id ? 'active' : ''}`}>
                <input type="radio" name="stand" checked={standId === o.stand.id} onChange={() => setStandId(o.stand.id)} />
                <span>
                  <strong>
                    {o.stand.name} {i === 0 && o.windOk && <span className="pill phase">Best now</span>}
                  </strong>
                  <span className={`small ${o.windOk && o.targetSafe ? 'muted' : 'warn-text'}`}>{o.why}</span>
                </span>
              </label>
            ))}
            {targets.length > 0 && (
              <label className="field">
                <span>Hunting for</span>
                <select className="input" value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value || null)}>
                  <option value="">Any buck</option>
                  {targets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.is_target ? ' ★' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>
        )}

        <section className="card">
          <h3>Before you go</h3>
          {[...prep, { category: 'safety' as const, text: 'Harness, lifeline, headlamp, knife, and a charged phone. Tell someone where you will be.' }].map((t) => (
            <label key={t.text} className="check small">
              <input type="checkbox" checked={!!checked[t.text]} onChange={(e) => setChecked({ ...checked, [t.text]: e.target.checked })} /> {t.text}
            </label>
          ))}
        </section>

        <button className="btn primary block big-btn" onClick={startHunt}>
          ▶ Start hunt{stand ? ` at ${stand.name}` : ''}
        </button>
        <p className="small muted center">Start when you reach your stand or setup. Keep the app open: the coach updates every 20 seconds.</p>

        {recent.length > 0 && (
          <section className="card">
            <h3>Recent hunts</h3>
            {recent.map((h) => (
              <div key={h.id} className="list-row">
                <div>
                  <strong>{rows.stands.find((s) => s.id === h.stand_id)?.name ?? (h.species === 'turkey' ? 'Turkey hunt' : 'Deer hunt')}</strong>
                  <div className="small muted">
                    {new Date(h.started_at).toLocaleDateString()} · {formatTime(Date.parse(h.started_at), fc.tz)}–{h.ended_at ? formatTime(Date.parse(h.ended_at), fc.tz) : ''}
                  </div>
                  <div className="small">{h.events.filter((e) => e.kind !== 'called').map((e) => EVENT_LABEL[e.kind]).join(', ') || 'Nothing logged'}</div>
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------------ live hunt
  const startedAt = Date.parse(active.started_at);
  const nowTips = advice.tips.filter((t) => t.category === 'now');
  const quick: HuntEventKind[] =
    huntSpecies === 'deer'
      ? ['saw_doe', 'saw_buck', ...(targetDeer ? (['saw_target'] as const) : []), 'buck_hung_up', 'bumped', 'harvest']
      : ['heard_gobble', 'saw_turkey', 'buck_hung_up', 'harvest'];
  const callIn = advice.calling.nextAt != null ? advice.calling.nextAt - now : null;
  const w = fc.wx.get(Math.floor(now / HOUR) * HOUR);
  const w3 = fc.wx.get(Math.floor(now / HOUR) * HOUR - 3 * HOUR);

  return (
    <div className={`coach live ${red ? 'red-mode' : ''}`}>
      <div className="live-head">
        <div>
          <div className="phase-label">{advice.phase.label}</div>
          <div className="small muted">
            {stand ? stand.name : huntSpecies === 'turkey' ? 'Turkey setup' : 'No stand'} · {now - startedAt < MINUTE ? 'just started' : `${countdown(now - startedAt)} in`}
          </div>
        </div>
        <div className="clock">{formatTime(now, fc.tz)}</div>
      </div>

      {advice.alerts.map((a) => (
        <div key={a.id} className={`alert ${a.level}`}>
          {a.level === 'warn' ? '⚠️' : a.level === 'go' ? '🎯' : 'ℹ️'} {a.text}
        </div>
      ))}

      <section className="card headline-card">
        <p className="headline">{advice.headline}</p>
        {nowTips.map((t) => (
          <p key={t.text} className="small now-tip">
            ▸ {t.text}
          </p>
        ))}
      </section>

      {w && (
        <div className="conditions-now">
          <span className="inline-wind">
            <WindArrow deg={w.windDirDeg} size={16} /> {compass(w.windDirDeg)} {Math.round(w.windMph)} mph
          </span>
          <span>{Math.round(w.tempF)}°F</span>
          <span>
            {hpaToInHg(w.pressureHpa).toFixed(2)} {w3 ? (w.pressureHpa - w3.pressureHpa > 0.7 ? '↑' : w.pressureHpa - w3.pressureHpa < -0.7 ? '↓' : '→') : ''}
          </span>
          <span>{day.moon.emoji}</span>
        </div>
      )}

      <section className="card calling">
        <div className="calling-head">
          <h3>Calling: {advice.calling.technique}</h3>
          <span className={`call-timer ${callIn != null && callIn <= 0 ? 'due' : ''}`}>
            {advice.calling.quietReason ? 'Stay quiet' : callIn != null ? (callIn <= 0 ? 'Call now' : `Next in ${countdown(callIn)}`) : '—'}
          </span>
        </div>
        {advice.calling.quietReason && <p className="small warn-text">{advice.calling.quietReason}</p>}
        <ol className="small">
          {advice.calling.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <button className="btn block" onClick={() => log('called')}>
          🔊 I just called
        </button>
        <p className="small muted">About every {advice.calling.intervalMin} minutes at this stage.</p>
      </section>

      <section className="card">
        <h3>What's happening?</h3>
        <div className="quick-log">
          {quick.map((k) => (
            <button key={k} className={`btn ${k === 'harvest' ? 'primary' : ''}`} onClick={() => log(k)}>
              {k === 'buck_hung_up' && huntSpecies === 'turkey' ? 'Tom hung up' : k === 'buck_hung_up' ? 'Buck hung up' : EVENT_LABEL[k]}
            </button>
          ))}
        </div>
      </section>

      {huntSpecies === 'deer' && advice.stands.length > 1 && (
        <section className="card">
          <h3>Stands right now</h3>
          {advice.stands.slice(0, 4).map((o) => (
            <div key={o.stand.id} className="list-row">
              <div>
                <strong>
                  {o.stand.name} {o.stand.id === active.stand_id && <span className="pill">You're here</span>}
                </strong>
                <div className={`small ${o.windOk && o.targetSafe ? 'muted' : 'warn-text'}`}>{o.why}</div>
              </div>
              {o.stand.id !== active.stand_id && (
                <button
                  className="btn small"
                  onClick={async () => {
                    await save('hunts', { ...active, stand_id: o.stand.id, events: [...active.events, { t: Date.now(), kind: 'moved', standId: o.stand.id }] });
                  }}
                >
                  Moved here
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <AskCoach advice={advice} input={input} standName={stand?.name ?? null} targetName={targetDeer?.name ?? null} />

      <TipGroups tips={advice.tips} />

      <section className="card">
        <h3>Coming up</h3>
        {advice.timeline.slice(0, 6).map((t) => (
          <div key={`${t.label}${t.t}`} className="timeline-row small">
            <span>{formatTime(t.t, fc.tz)}</span>
            <span>{t.label}</span>
            <span className="muted">{t.t > now ? `in ${countdown(t.t - now)}` : 'now'}</span>
          </div>
        ))}
      </section>

      {active.events.length > 0 && (
        <section className="card">
          <h3>Hunt log</h3>
          {[...active.events].reverse().map((e, i) => (
            <div key={i} className="timeline-row small">
              <span>{formatTime(e.t, fc.tz)}</span>
              <span>{EVENT_LABEL[e.kind]}</span>
              <span className="muted">{e.kind === 'moved' ? rows.stands.find((s) => s.id === e.standId)?.name : ''}</span>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <label className="toggle">
          <input
            type="checkbox"
            checked={keepOn}
            onChange={(e) => {
              setKeepOn(e.target.checked);
              saveLocal('coach:keepOn', e.target.checked);
            }}
          />{' '}
          Keep screen on
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={red}
            onChange={(e) => {
              setRed(e.target.checked);
              saveLocal('coach:red', e.target.checked);
            }}
          />{' '}
          Red low-light mode (easier on night vision, less glow)
        </label>
        <textarea className="input" rows={2} placeholder="Notes for this hunt (optional)" value={endNotes} onChange={(e) => setEndNotes(e.target.value)} />
        <button className="btn block danger-outline" onClick={() => save('hunts', { ...active, ended_at: new Date().toISOString(), notes: endNotes })}>
          ■ End hunt
        </button>
      </section>
    </div>
  );
}
