import { describe, expect, it } from 'vitest';
import { coach, rankStands, type CoachInput } from './coach';
import type { HuntEvent, Stand } from './data/types';
import { buildForecast } from './forecast';
import { DAY, HOUR, localMidnight, MINUTE } from './time';
import type { HourWeather } from './weather';

const TZ = 'America/Chicago';
const LAT = 40.1;
const LON = -88.9;

function setup(opts: { date: number; species: 'deer' | 'turkey'; windFor?: (localHour: number) => number }) {
  const start = localMidnight(opts.date, TZ) - 2 * DAY;
  const hours: HourWeather[] = Array.from({ length: 24 * 6 }, (_, i) => {
    const t = start + i * HOUR;
    const lh = ((i % 24) + 24) % 24;
    return { time: t, tempF: 38, humidity: 70, pressureHpa: 1018, windMph: 7, gustMph: 12, windDirDeg: opts.windFor?.(lh) ?? 315, precipIn: 0, precipProb: 0, snowIn: 0, cloudCover: 40, weatherCode: 2 };
  });
  const { days } = buildForecast({ lat: LAT, lon: LON, species: opts.species, weather: { timezone: TZ, hours, fetchedAt: opts.date }, normals: null, days: 2, now: opts.date });
  return { day: days[0], wx: new Map(hours.map((h) => [h.time, h])) };
}

const north: Stand = { id: 'n', name: 'North Ridge', place_id: null, lat: 40.102, lon: -88.9, winds: ['S', 'SW'], kind: 'stand', notes: '' };
const creek: Stand = { id: 'c', name: 'Creek Bottom', place_id: null, lat: 40.098, lon: -88.9, winds: ['NW', 'N'], kind: 'stand', notes: '' };

const base = (over: Partial<CoachInput> & Pick<CoachInput, 'now' | 'day' | 'wx'>): CoachInput => ({
  species: 'deer',
  startedAt: null,
  stand: null,
  stands: [north, creek],
  cameras: [],
  target: null,
  events: [],
  tz: TZ,
  ...over,
});

describe('hunting coach: deer', () => {
  const date = Date.UTC(2026, 10, 8, 18); // Nov 8: seeking & chasing at 40°N
  const { day, wx } = setup({ date, species: 'deer' });
  const sr = day.sun.sunrise;

  it('prepares before dawn with scent control, an approach route and the best stand', () => {
    const a = coach(base({ now: sr - 3 * HOUR, day, wx }));
    expect(a.phase.key).toBe('prep');
    expect(a.tips.some((t) => t.category === 'scent')).toBe(true);
    expect(a.approach).toMatch(/from the NW.*Walk in from the SE/);
    expect(a.stands[0].stand.id).toBe('c'); // NW wind suits Creek Bottom
    expect(a.calling.nextAt).toBeNull();
  });

  it('stays quiet while settling, then schedules rut rattling', () => {
    const started = sr - 40 * MINUTE;
    const settling = coach(base({ now: started + 5 * MINUTE, startedAt: started, stand: creek, day, wx }));
    expect(settling.phase.key).toBe('settle');
    expect(settling.calling.quietReason).toMatch(/settle/);
    const am = coach(base({ now: sr + 30 * MINUTE, startedAt: started, stand: creek, day, wx }));
    expect(am.phase.key).toBe('am');
    expect(am.calling.technique).toMatch(/rattling/i);
    expect(am.calling.nextAt).toBe(sr + 30 * MINUTE); // overdue → call now
    expect(am.alerts.some((x) => x.text.startsWith('Time to call'))).toBe(true);
    const events: HuntEvent[] = [{ t: sr + 30 * MINUTE, kind: 'called' }];
    const later = coach(base({ now: sr + 35 * MINUTE, startedAt: started, stand: creek, day, wx, events }));
    expect(later.calling.nextAt).toBe(sr + 30 * MINUTE + later.calling.intervalMin * MINUTE);
  });

  it('stops calling when a buck hangs up and gives specific advice', () => {
    const now = sr + HOUR;
    const a = coach(base({ now, startedAt: sr - HOUR, stand: creek, day, wx, events: [{ t: now - 2 * MINUTE, kind: 'buck_hung_up' }] }));
    expect(a.calling.technique).toBe('Buck hung up');
    expect(a.calling.nextAt).toBeNull();
  });

  it('warns when the wind is wrong and suggests a better stand', () => {
    const a = coach(base({ now: sr + HOUR, startedAt: sr - HOUR, stand: north, day, wx }));
    expect(a.alerts.some((x) => x.level === 'warn' && /wrong for North Ridge/.test(x.text))).toBe(true);
    expect(a.tips.some((t) => t.category === 'stand' && /Creek Bottom/.test(t.text))).toBe(true);
  });

  it('looks ahead for a wind shift and plans a move', () => {
    const shifting = setup({ date, species: 'deer', windFor: (h) => (h >= 10 ? 200 : 315) });
    const a = coach(base({ now: sr + HOUR, startedAt: sr - HOUR, stand: creek, day: shifting.day, wx: shifting.wx }));
    const shift = a.alerts.find((x) => x.id.startsWith('shift-'));
    expect(shift?.text).toMatch(/Wind shifts to S.*North Ridge/);
  });

  it('gives rut attractant advice with a legality reminder', () => {
    const a = coach(base({ now: sr + HOUR, startedAt: sr - HOUR, stand: creek, day, wx }));
    const att = a.tips.filter((t) => t.category === 'attractant').map((t) => t.text).join(' ');
    expect(att).toMatch(/estrus/i);
    expect(att).toMatch(/illegal in some states/);
  });

  it('keeps scent away from the target buck camera', () => {
    // Camera south-east of Creek Bottom: on a NW wind the hunter's scent drifts SE, right toward it.
    const cam = { id: 'cam', name: 'Scrape Cam', place_id: null, lat: 40.0965, lon: -88.898, notes: '' };
    const pattern = { cameras: [{ cameraId: 'cam', n: 5, daylight: 4, recent: 2, bins: { dawn: 4, midday: 0, dusk: 0, night: 1 } }] } as never;
    const opts = rankStands(base({ now: sr + HOUR, day, wx, cameras: [cam], target: { deer: { id: 'd', name: 'Big 8' } as never, pattern } }), sr + HOUR);
    const creekOpt = opts.find((o) => o.stand.id === 'c')!;
    expect(creekOpt.targetSafe).toBe(false);
    expect(creekOpt.why).toMatch(/scent would drift toward it/);
  });

  it('wraps up after legal light', () => {
    const a = coach(base({ now: day.sun.sunset + HOUR, startedAt: sr - HOUR, stand: creek, day, wx }));
    expect(a.phase.key).toBe('walkout');
  });
});

describe('hunting coach: spring turkey', () => {
  const date = Date.UTC(2026, 3, 20, 17);
  const { day, wx } = setup({ date, species: 'turkey' });
  const sr = day.sun.sunrise;

  it('walks through roost, fly-down and late-morning calling', () => {
    const started = sr - HOUR;
    const roost = coach(base({ species: 'turkey', now: sr - 30 * MINUTE, startedAt: started, day, wx }));
    expect(roost.phase.key).toBe('roost');
    expect(roost.calling.technique).toMatch(/tree calls/);
    const fly = coach(base({ species: 'turkey', now: sr + 10 * MINUTE, startedAt: started, day, wx }));
    expect(fly.calling.technique).toMatch(/Fly-down cackle/);
    const late = coach(base({ species: 'turkey', now: sr + 4 * HOUR, startedAt: started, day, wx }));
    expect(late.calling.technique).toMatch(/Run-and-gun/);
    expect(late.tips.some((t) => t.category === 'decoy')).toBe(true);
  });

  it('reacts to a gobble', () => {
    const now = sr + HOUR;
    const a = coach(base({ species: 'turkey', now, startedAt: sr - HOUR, day, wx, events: [{ t: now - 3 * MINUTE, kind: 'heard_gobble' }] }));
    expect(a.calling.steps[0]).toMatch(/He gobbled/);
    expect(a.calling.intervalMin).toBeLessThanOrEqual(8);
  });
});
