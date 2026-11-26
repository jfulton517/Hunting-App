// Real-time hunting coach: turns the time, live weather, season phase, stand setup, target
// buck pattern and what the hunter has logged so far into concrete advice — what to do now,
// when to call (and how), whether to stay or move, scent control and attractants.
// Pure functions so the advice is testable and works offline.
import type { Camera, Deer, HuntEvent, Stand } from './data/types';
import type { DayForecast } from './forecast';
import { distanceM, formatDistance, targetIsDownwind } from './geo';
import type { DeerPattern, TimeBin } from './patterns';
import { legalWindow, type Species } from './scoring';
import type { SeasonPhase } from './season';
import { formatHour, formatTime, HOUR, MINUTE } from './time';
import { compass, compass8, type HourWeather } from './weather';

export type TipCategory = 'now' | 'calling' | 'stand' | 'wind' | 'scent' | 'attractant' | 'safety' | 'decoy';

export interface Tip {
  category: TipCategory;
  text: string;
}

export interface CoachAlert {
  id: string; // stable id so the UI alerts once
  level: 'info' | 'warn' | 'go';
  text: string;
}

export interface CallPlan {
  technique: string;
  steps: string[];
  intervalMin: number;
  /** When to make the next call sequence (null = stay quiet for now) */
  nextAt: number | null;
  quietReason: string | null;
}

export interface StandOption {
  stand: Stand;
  windOk: boolean;
  targetSafe: boolean; // scent won't blow toward the target's camera
  nearTargetM: number | null;
  score: number;
  why: string;
}

export interface TimelineItem {
  t: number;
  label: string;
}

export interface CoachAdvice {
  phase: { key: string; label: string };
  headline: string;
  tips: Tip[];
  calling: CallPlan;
  stands: StandOption[]; // ranked for the current hour
  alerts: CoachAlert[];
  timeline: TimelineItem[];
  approach: string | null;
  wind: { deg: number; mph: number } | null;
}

export interface CoachInput {
  species: Species;
  now: number;
  startedAt: number | null; // null = planning (not in the stand yet)
  day: DayForecast;
  wx: Map<number, HourWeather>;
  stand: Stand | null;
  stands: Stand[];
  cameras: Camera[];
  target: { deer: Deer; pattern: DeerPattern } | null;
  events: HuntEvent[];
  tz: string;
}

const hourOf = (t: number) => Math.floor(t / HOUR) * HOUR;
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.max(1, Math.round(m))} min`);

function wxAt(wx: Map<number, HourWeather>, t: number) {
  return wx.get(hourOf(t)) ?? null;
}

// ------------------------------------------------------------------ hunt phases

function huntPhase(input: CoachInput): { key: string; label: string } {
  const { now, day, species, startedAt } = input;
  const [l0, l1] = legalWindow(species, day.sun);
  const sr = day.sun.sunrise;
  const ss = day.sun.sunset;
  if (now > l1) return { key: 'walkout', label: 'Walk out' };
  if (startedAt == null) return now < l0 - 90 * MINUTE ? { key: 'prep', label: 'Getting ready' } : { key: 'walkin', label: 'Heading in' };
  if (now - startedAt < 20 * MINUTE && now > l0 - HOUR) return { key: 'settle', label: 'Settling in' };
  if (species === 'turkey') {
    if (now < sr - 15 * MINUTE) return { key: 'roost', label: 'Birds on the roost' };
    if (now < sr + 45 * MINUTE) return { key: 'flydown', label: 'Fly-down' };
    if (now < sr + 3 * HOUR) return { key: 'strut', label: 'Strut zone' };
    if (now < sr + 6 * HOUR) return { key: 'latemorning', label: 'Late morning' };
    if (now < ss - HOUR) return { key: 'afternoon', label: 'Afternoon' };
    return { key: 'flyup', label: 'Heading to roost' };
  }
  if (now < l0) return { key: 'dark', label: 'Before legal light' };
  if (now < sr + 2.5 * HOUR) return { key: 'am', label: 'Morning prime time' };
  if (now < ss - 2.5 * HOUR) return { key: 'midday', label: 'Midday' };
  if (now < ss) return { key: 'pm', label: 'Evening prime time' };
  return { key: 'lastlight', label: 'Last light' };
}

// ------------------------------------------------------------------ calling

const lastEvent = (events: HuntEvent[], kinds: HuntEvent['kind'][]) =>
  events.filter((e) => kinds.includes(e.kind)).reduce<HuntEvent | null>((a, b) => (!a || b.t > a.t ? b : a), null);

function deerCalling(input: CoachInput, phaseKey: string, season: SeasonPhase, windMph: number): CallPlan {
  const { now, events, startedAt } = input;
  let technique: string;
  let steps: string[];
  let interval: number;
  switch (season.key) {
    case 'seeking':
    case 'secondrut':
      technique = 'Aggressive rattling + grunts';
      steps = [
        'Start with 2–3 soft contact grunts, then wait a minute.',
        'Rattle 45–90 seconds: crash antlers, grind, pause, grind again; rake brush and stomp leaves.',
        'Follow with 2–3 grunts or a snort-wheeze, then stay ready. Most bucks come in within 20 minutes, often from downwind.',
      ];
      interval = 25;
      break;
    case 'prerut':
      technique = 'Light rattling ("tickling") + grunts';
      steps = ['2–3 contact grunts.', 'Tickle antlers 20–30 seconds, as two bucks sparring, not a fight.', 'Wait 20+ minutes with your gun or bow ready.'];
      interval = 35;
      break;
    case 'peak':
      technique = 'Estrus bleats + tending grunts';
      steps = ['1–2 estrus bleats from a can call.', 'A short series of tending grunts (quick, rhythmic "urp-urp-urp").', 'Rattling is less effective now because bucks are locked down with does.'];
      interval = 35;
      break;
    case 'postrut':
    case 'late':
      technique = 'Soft doe and fawn bleats';
      steps = ['2 soft doe bleats, or a fawn bleat near food.', 'An occasional soft grunt. Bucks are worn down and wary, so keep it subtle.'];
      interval = 45;
      break;
    default:
      technique = 'Sparse contact calls';
      steps = ['2–3 soft contact grunts or doe bleats.', 'Too much calling this early educates deer, so less is more.'];
      interval = 45;
  }
  if (windMph > 15) steps.push('In this wind, call a little louder and more often. Sound doesn\'t carry far.');

  const visible = lastEvent(events, ['saw_buck', 'saw_target', 'buck_hung_up']);
  if (visible && now - visible.t < 10 * MINUTE) {
    if (visible.kind === 'buck_hung_up')
      return {
        technique: 'Buck hung up',
        steps: [
          'Stop rattling. A single soft grunt or estrus bleat when his head is behind cover.',
          'If he still won\'t come, try a snort-wheeze only if he\'s a mature buck and acting dominant.',
          'Don\'t call while he looks your way. Let him lose interest and circle, and watch downwind.',
        ],
        intervalMin: 5,
        nextAt: null,
        quietReason: 'Call only when he\'s walking away or looking elsewhere.',
      };
    return {
      technique: 'Deer in sight',
      steps: ['Don\'t call while he\'s coming your way.', 'If he\'s walking past out of range, a short grunt ("maa") can stop him for a shot.'],
      intervalMin: interval,
      nextAt: null,
      quietReason: 'A deer is in sight, so let him come.',
    };
  }

  const quiet =
    phaseKey === 'prep' || phaseKey === 'walkin' || phaseKey === 'walkout'
      ? 'Not calling until you\'re set up in the stand.'
      : phaseKey === 'settle'
        ? 'Let the woods settle for 20 minutes after you climb in.'
        : phaseKey === 'dark'
          ? 'Wait for shooting light before calling.'
          : null;
  const last = lastEvent(events, ['called']);
  const base = last ? last.t + interval * MINUTE : (startedAt ?? now) + 20 * MINUTE;
  return { technique, steps, intervalMin: interval, nextAt: quiet ? null : Math.max(base, now), quietReason: quiet };
}

function turkeyCalling(input: CoachInput, phaseKey: string, season: SeasonPhase, windMph: number): CallPlan {
  const { now, events, startedAt } = input;
  const gobble = lastEvent(events, ['heard_gobble']);
  const recentGobble = gobble && now - gobble.t < 15 * MINUTE;
  let technique: string;
  let steps: string[];
  let interval: number;
  let quiet: string | null = null;
  if (season.key === 'fall') {
    technique = 'Kee-kee runs + assembly yelps';
    steps = ['If you scattered a flock, wait 15–30 minutes and then start.', 'Kee-kee runs (young birds) mixed with 8–12 note assembly yelps.', 'Copy the calls you hear coming back.'];
    interval = 15;
  } else if (phaseKey === 'roost' || phaseKey === 'settle') {
    technique = 'Locate, then soft tree calls';
    steps = ['Before first light, an owl hoot or crow call can shock a gobble so you know where he roosted.', 'Once set up, 2–3 soft tree yelps, then stay quiet until fly-down.', 'Don\'t over-call on the roost, or he may wait for the hen to come to him.'];
    interval = 30;
    if (phaseKey === 'settle') quiet = 'Get settled and quiet. Birds are close at this hour.';
  } else if (phaseKey === 'flydown') {
    technique = 'Fly-down cackle + yelps';
    steps = ['When birds hit the ground, one fly-down cackle (or beat a hat against your leg).', 'Then 5–7 note yelps, matching his excitement.', 'If he gobbles at every call, ease off and make him look for you.'];
    interval = 10;
  } else if (phaseKey === 'latemorning') {
    technique = 'Run-and-gun / strike calling';
    steps = ['Loud cutting and yelping on a box call to strike a lonely gobbler.', 'Call every 10–15 minutes and move 200–300 yards if nothing answers.', 'If one answers, set up quickly before calling again.'];
    interval = 12;
  } else if (phaseKey === 'flyup') {
    technique = 'Quiet: roost him for tomorrow';
    steps = ['Don\'t call birds off the roost area this late. Listen for fly-up gobbles to roost one for tomorrow morning.'];
    interval = 60;
    quiet = 'Roosting time. Listen and don\'t pressure birds near the roost.';
  } else {
    technique = 'Yelps, clucks and purrs';
    steps = ['Soft yelps and clucks, plus purrs and leaf-scratching for realism.', 'Every 15–20 minutes. Patience kills more afternoon birds than calling.'];
    interval = phaseKey === 'afternoon' ? 20 : 15;
  }
  if (recentGobble && !quiet) {
    steps.unshift('He gobbled. Answer with a few yelps, then go quiet and make him come looking. Get your gun up on your knee now.');
    interval = Math.min(interval, 8);
  }
  const hungUp = lastEvent(events, ['buck_hung_up']);
  if (hungUp && now - hungUp.t < 15 * MINUTE)
    return {
      technique: 'Gobbler hung up',
      steps: ['Stop calling and let him wonder. Purr and scratch leaves softly.', 'Or back out and circle 100+ yards to set up on a new side, then call softly.', 'Obstacles like fences, creeks, and thick brush often stop toms, so set up where he can see easily.'],
      intervalMin: 10,
      nextAt: null,
      quietReason: 'He\'s hung up, so silence often brings him the last 40 yards.',
    };
  if (windMph > 12 && !quiet) steps.push('Windy: use a box call (loudest), and hunt sheltered hollows and field edges where birds can hear.');
  if (phaseKey === 'prep' || phaseKey === 'walkin') quiet = 'Get set up before calling. Move quietly, with no lights near the roost.';
  if (phaseKey === 'walkout') quiet = 'Done for the day.';
  const last = lastEvent(events, ['called']);
  const base = last ? last.t + interval * MINUTE : (startedAt ?? now) + 10 * MINUTE;
  return { technique, steps, intervalMin: interval, nextAt: quiet ? null : Math.max(base, now), quietReason: quiet };
}

// ------------------------------------------------------------------ stands

function targetCamera(input: CoachInput, bin: TimeBin | null): Camera | null {
  if (!input.target) return null;
  const byId = new Map(input.cameras.map((c) => [c.id, c]));
  const ranked = input.target.pattern.cameras
    .map((pc) => ({ c: byId.get(pc.cameraId), w: pc.n + 2 * pc.daylight + 2 * pc.recent + (bin ? 3 * pc.bins[bin] : 0) }))
    .filter((x) => x.c && x.c.lat != null)
    .sort((a, b) => b.w - a.w);
  return ranked[0]?.c ?? null;
}

export function rankStands(input: CoachInput, t: number): StandOption[] {
  const w = wxAt(input.wx, t);
  const deg = w && w.windMph >= 2 ? w.windDirDeg : null;
  const dir = deg != null ? compass8(deg) : null;
  const sr = input.day.sun.sunrise;
  const ss = input.day.sun.sunset;
  const bin: TimeBin = t < sr + 2 * HOUR ? 'dawn' : t > ss - 2.5 * HOUR ? 'dusk' : 'midday';
  const cam = targetCamera(input, bin);
  return input.stands
    .map((s) => {
      const windOk = !dir || !s.winds.length || s.winds.includes(dir);
      const hasCoords = s.lat != null && s.lon != null;
      const targetSafe = !(deg != null && cam && hasCoords && targetIsDownwind({ lat: s.lat!, lon: s.lon! }, { lat: cam.lat!, lon: cam.lon! }, deg));
      const near = cam && hasCoords ? distanceM(s.lat!, s.lon!, cam.lat!, cam.lon!) : null;
      let score = (windOk ? 3 : 0) + (targetSafe ? 1 : -2);
      if (near != null) score += near < 300 ? 2 : near < 700 ? 1 : 0;
      if (input.species === 'deer' && s.kind === 'blind' && bin === 'midday') score -= 0.2;
      const why = [
        !dir ? 'Light and variable wind.' : windOk ? `${dir} wind works here.` : `Wrong wind (${dir}) for this stand.`,
        cam && near != null ? `${formatDistance(near)} from ${cam.name}${targetSafe ? '' : ', but your scent would drift toward it'}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return { stand: s, windOk, targetSafe, nearTargetM: near, score, why };
    })
    .sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------ scent, attractants, safety

export function scentTips(species: Species, windMph: number | null): Tip[] {
  if (species === 'turkey')
    return [
      { category: 'scent', text: "Turkeys don't have a useful sense of smell. Their eyesight is the threat. Full camo with face mask and gloves, and sit against a tree wider than your shoulders." },
      { category: 'scent', text: 'Keep movement to a minimum. Raise your gun when his head is behind a tree or his tail fans toward you.' },
    ];
  const tips: Tip[] = [
    { category: 'scent', text: 'Shower with scent-free soap, and keep hunting clothes sealed in a tote. Dress at the truck, not at home.' },
    { category: 'scent', text: 'Wear rubber boots, and don\'t stop for gas or breakfast in your hunting clothes.' },
    { category: 'scent', text: 'Pack layers and walk in slowly. Sweat is the biggest scent source, so dress at the base of the tree.' },
    { category: 'scent', text: 'Scent-elimination spray on boots, pack, and anything you touch. It helps, but nothing beats playing the wind.' },
  ];
  if (windMph != null && windMph < 3) tips.push({ category: 'scent', text: 'Calm air lets scent pool around you. Keep movement and noise to a minimum and check the wind often with a puff bottle or milkweed.' });
  return tips;
}

export function attractantTips(species: Species, season: SeasonPhase): Tip[] {
  const legal = 'Check your state\'s rules first. Baiting, and natural deer-urine scents (because of CWD), are illegal in some states.';
  if (species === 'turkey') {
    if (season.key === 'fall' || season.key === 'off') return [{ category: 'decoy', text: 'Skip decoys in fall. Scatter the flock and call them back together.' }];
    const decoy =
      season.key === 'breakup'
        ? 'Early season: a hen plus a jake decoy draws dominant toms looking for a fight.'
        : season.key === 'peakgobble'
          ? 'Peak breeding: a single hen, or a hen and a strutter, 15–20 yards out where he can see it from a distance.'
          : 'Late season and pressured birds: a single feeding hen, or no decoy. Pressured toms often avoid jake and strutter decoys.';
    return [{ category: 'decoy', text: decoy }, { category: 'safety', text: 'Never carry a decoy or fan in the open without wrapping it in blaze orange.' }];
  }
  const tips: Tip[] = [];
  switch (season.key) {
    case 'early':
    case 'lull':
      tips.push({ category: 'attractant', text: 'Food is king now. Hunt the trails between bedding and acorns or food plots. A mock scrape on a field edge starts working by late October.' });
      break;
    case 'prerut':
      tips.push({ category: 'attractant', text: 'Freshen a mock scrape with buck urine or a scrape dripper, and make sure it has an overhanging licking branch. Hang it crosswind of your stand in a shooting lane.' });
      break;
    case 'seeking':
    case 'peak':
    case 'secondrut':
      tips.push({ category: 'attractant', text: 'Drag estrus doe scent on your walk in. Stop the drag 20–30 yards from your stand, crosswind, in a shooting lane.' });
      tips.push({ category: 'attractant', text: 'Hang 2–3 scent wicks upwind or crosswind in shooting lanes. Bucks circle downwind to scent-check, so make sure your shooting lanes cover that side.' });
      break;
    default:
      tips.push({ category: 'attractant', text: 'Late season is about food. Hunt the best remaining food source on cold afternoons. Scents add little now.' });
  }
  tips.push({ category: 'attractant', text: legal });
  return tips;
}

const SAFETY: Tip[] = [
  { category: 'safety', text: 'Full-body harness connected from the moment you leave the ground. Use a lifeline, and pull up an unloaded gun or bow with a rope.' },
  { category: 'safety', text: 'Tell someone which stand you\'re in and when you\'ll be back.' },
];

// ------------------------------------------------------------------ main

export function coach(input: CoachInput): CoachAdvice {
  const { now, day, species, stand, events } = input;
  const phase = huntPhase(input);
  const season = day.phase;
  const w = wxAt(input.wx, now);
  const wind = w ? { deg: w.windDirDeg, mph: w.windMph } : null;
  const [l0, l1] = legalWindow(species, day.sun);
  const calling = species === 'deer' ? deerCalling(input, phase.key, season, w?.windMph ?? 5) : turkeyCalling(input, phase.key, season, w?.windMph ?? 5);
  const stands = rankStands(input, now);
  const alerts: CoachAlert[] = [];
  const tips: Tip[] = [];

  // Approach route: walk with the wind in your face so your scent trails behind you.
  const approach =
    wind && wind.mph >= 2
      ? `Wind is from the ${compass(wind.deg)}. Walk in from the ${compass((wind.deg + 180) % 360)} side with the wind in your face, and avoid crossing trails or fields deer will use${species === 'deer' ? ' this morning' : ''}.`
      : 'Light and variable wind: take the quietest route and avoid crossing bedding areas and food sources.';

  // --- current stand vs. wind now and over the next hours
  const current = stand ? stands.find((o) => o.stand.id === stand.id) ?? null : null;
  const best = stands[0] ?? null;
  if (current && species === 'deer') {
    if (!current.windOk || !current.targetSafe) {
      alerts.push({ id: `wrong-wind-${stand!.id}-${hourOf(now)}`, level: 'warn', text: `The wind is wrong for ${stand!.name} right now. ${current.why}` });
      if (best && best.stand.id !== stand!.id && best.windOk)
        tips.push({ category: 'stand', text: `Better option now: ${best.stand.name}. ${best.why}${phase.key === 'am' || phase.key === 'pm' ? ' Moving during prime time is a gamble. Go if you\'re likely to get winded where you are.' : ' Midday is the best time to move.'}` });
    } else if (phase.key !== 'walkout') {
      // Look ahead for a wind shift during legal light.
      for (let t = hourOf(now) + HOUR; t <= Math.min(l1, now + 5 * HOUR); t += HOUR) {
        const opt = rankStands(input, t).find((o) => o.stand.id === stand!.id);
        if (opt && (!opt.windOk || !opt.targetSafe)) {
          const wNext = wxAt(input.wx, t);
          const alt = rankStands(input, t).find((o) => o.windOk && o.targetSafe && o.stand.id !== stand!.id);
          const when = formatHour(t, input.tz);
          alerts.push({
            id: `shift-${stand!.id}-${t}`,
            level: 'warn',
            text: `Wind shifts${wNext ? ` to ${compass(wNext.windDirDeg)}` : ''} around ${when}, which is wrong for ${stand!.name}.${alt ? ` Plan to move to ${alt.stand.name} before then${t > day.sun.sunrise + 2.5 * HOUR && t < day.sun.sunset - 2.5 * HOUR ? ' during the midday lull' : ''}.` : ' Plan your exit, or move downwind of where deer are traveling.'}`,
          });
          break;
        }
      }
    }
  } else if (!stand && best && species === 'deer') {
    tips.push({ category: 'stand', text: `Best stand for this wind: ${best.stand.name}. ${best.why}` });
  }

  // --- phase-specific coaching
  const sr = day.sun.sunrise;
  const ss = day.sun.sunset;
  const majors = day.solunar.filter((p) => p.type === 'major');
  const inMajor = majors.find((p) => now >= p.start && now <= p.end);
  const nextMajor = majors.find((p) => p.start > now && p.start < l1);
  let headline = '';
  const prob = input.target ? input.target.pattern : null;
  switch (phase.key) {
    case 'prep':
      headline = `Get ready. Legal light starts ${formatTime(l0, input.tz)}, so plan to be settled in 20–30 minutes before.`;
      tips.push(...scentTips(species, wind?.mph ?? null));
      break;
    case 'walkin':
      headline = species === 'turkey' ? 'Slip in quietly with no light near the roost. Set up 100–150 yards from where he roosted.' : 'Walk in slowly and quietly. Cool morning air sinks, so your scent rolls downhill on the way in.';
      break;
    case 'settle':
      headline = 'Settle in. Get your gear hung, and range a few landmarks. Stay still and quiet for the first 20 minutes.';
      break;
    case 'dark':
      headline = 'Shooting light is coming. Deer are often already moving back to bed, so listen for footsteps.';
      break;
    case 'am':
      headline =
        now < sr + HOUR
          ? 'Prime time. Most daylight deer movement happens in the next hour. Stay still and scan slowly.'
          : 'Still prime. Bucks often trail does back to bedding late in the morning. Don\'t leave early.';
      tips.push({ category: 'wind', text: 'Thermals flip as the sun warms the ground (about 1–2 hours after sunrise). Scent starts rising, which favors elevated stands and ridge sides.' });
      break;
    case 'midday':
      headline =
        season.key === 'seeking' || season.key === 'peak'
          ? 'Midday in the rut is underrated. Bucks cruise between doe groups from 10 AM to 2 PM. Stay put if you can.'
          : 'Midday lull. This is a good time to move stands, eat, or slip to a pinch point near bedding.';
      tips.push({ category: 'wind', text: 'Midday thermals rise. Scent lifts off the ground, so low stands near hillsides can swirl.' });
      break;
    case 'pm':
      headline = now > ss - HOUR ? 'The last hour is the best hour. Be still, ready, and watching the trails to food.' : 'Evening movement builds toward last light. Deer head from bedding to food.';
      tips.push({ category: 'wind', text: 'As the air cools near sunset, thermals sink again. Low stands by creeks get scent pooling, so watch your downhill side.' });
      break;
    case 'lastlight':
      headline = 'Last legal minutes. Don\'t shoot past legal light. Plan your exit so you don\'t spook deer that are feeding.';
      break;
    case 'walkout':
      headline = 'Legal light is over. Wait until deer near you move off, then exit away from food sources and bedding.';
      tips.push({ category: 'stand', text: 'If deer are in the field below you, wait them out, or have someone drive in to pick you up. Bumping deer at the field edge will teach them to avoid that spot.' });
      break;
    case 'roost':
      headline = 'Listen for gobbles. Get set up and still before it gets light. He can see you better than you think.';
      break;
    case 'flydown':
      headline = 'Fly-down time. When he hits the ground, call once or twice, then make him come looking.';
      break;
    case 'strut':
      headline = 'Strut zone hours. Toms are with hens. Patience, soft calling, and a hen decoy work best now.';
      break;
    case 'latemorning':
      headline = 'Late morning: hens drift off to nest, and lonely toms come to calls. This is the best time to strike one.';
      break;
    case 'afternoon':
      headline = 'Afternoon: birds loaf near feeding and dusting areas. Set up there and call sparingly.';
      break;
    case 'flyup':
      headline = 'Birds are heading to roost. Back out quietly and listen for fly-up gobbles to roost one for tomorrow.';
      break;
  }
  if (inMajor) tips.unshift({ category: 'now', text: `A solunar major period is on (until ${formatTime(inMajor.end, input.tz)}). Stay alert.` });
  if (prob && prob.confidence !== 'none' && species === 'deer') {
    const bin: TimeBin = now < sr + 2 * HOUR ? 'dawn' : now > ss - 2.5 * HOUR ? 'dusk' : 'midday';
    const c = prob.time[bin];
    if (c.count > 0) tips.unshift({ category: 'now', text: `${input.target!.deer.name} has shown up at ${bin} ${c.count} time${c.count === 1 ? '' : 's'}.` });
  }

  // --- react to what the hunter logged
  const recent = (k: HuntEvent['kind'][], mins: number) => events.some((e) => k.includes(e.kind) && now - e.t < mins * MINUTE);
  if (recent(['bumped'], 30))
    tips.unshift({ category: 'now', text: 'You bumped deer. Stay put and quiet, because they often settle and others keep moving. Note which way they went, and don\'t hunt this stand on the same wind tomorrow.' });
  if (recent(['saw_doe'], 30) && species === 'deer' && ['seeking', 'peak', 'secondrut'].includes(season.key))
    tips.unshift({ category: 'now', text: 'Does moving during the rut: watch their back trail. A buck is often 5–15 minutes behind.' });
  if (recent(['saw_target'], 60))
    tips.unshift({ category: 'now', text: 'Your target is in the area. Stay put through the next prime window, and stay off the call unless he\'s leaving.' });
  if (events.some((e) => e.kind === 'harvest'))
    tips.unshift({ category: 'now', text: 'Mark where he was standing and the last spot you saw him. Wait at least 30 minutes (longer for a questionable hit) before tracking quietly.' });

  // Long sit without action
  if (input.startedAt && now - input.startedAt > 3 * HOUR && !events.some((e) => ['saw_buck', 'saw_doe', 'saw_target', 'heard_gobble', 'saw_turkey'].includes(e.kind)) && phase.key === 'midday')
    tips.push({ category: 'stand', text: 'Slow sit. Use the midday lull to move closer to bedding or a pinch point with a good wind, rather than waiting where nothing\'s moving.' });

  tips.push(...attractantTips(species, season));
  if (phase.key !== 'prep') tips.push(...scentTips(species, wind?.mph ?? null).slice(-1));
  tips.push(...SAFETY);

  // --- alerts for key moments (UI alerts once per id)
  const soon = (t: number, mins: number) => t > now && t - now <= mins * MINUTE;
  if (soon(l0, 15)) alerts.push({ id: `legal-${l0}`, level: 'go', text: `Legal shooting light in ${fmtMin((l0 - now) / MINUTE)}.` });
  if (soon(l1, 20)) alerts.push({ id: `legal-end-${l1}`, level: 'info', text: `Legal light ends in ${fmtMin((l1 - now) / MINUTE)}.` });
  if (nextMajor && soon(nextMajor.start, 20)) alerts.push({ id: `major-${nextMajor.start}`, level: 'go', text: `Solunar major period starts in ${fmtMin((nextMajor.start - now) / MINUTE)}. Be ready.` });
  if (calling.nextAt != null && calling.nextAt <= now + 30_000) alerts.push({ id: `call-${calling.nextAt}`, level: 'go', text: `Time to call: ${calling.technique.toLowerCase()}.` });

  // --- timeline
  const timeline: TimelineItem[] = [
    { t: l0, label: 'Legal light' },
    { t: sr, label: 'Sunrise' },
    ...majors.map((p) => ({ t: p.start, label: 'Solunar major starts' })),
    ...(day.morning ? [{ t: day.morning.start, label: 'Best morning window' }] : []),
    ...(day.evening ? [{ t: day.evening.start, label: 'Best evening window' }] : []),
    { t: ss, label: 'Sunset' },
    { t: l1, label: 'Legal light ends' },
  ]
    .filter((x) => x.t > now - 10 * MINUTE)
    .sort((a, b) => a.t - b.t);

  return { phase, headline, tips, calling, stands, alerts, timeline, approach, wind };
}
