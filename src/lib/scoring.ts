// Hourly hunting-condition scoring for whitetail deer and wild turkey.
//
// Model: score = activity(time of day, solunar, moon, season) × weather suitability × season multiplier
// Each factor returns 0..1 plus a human-readable explanation so the UI can show *why*.
import { solunarStrength, type MoonEvent, type MoonPhaseInfo, type SunDay } from './astro';
import type { SeasonPhase } from './season';
import { HOUR, MINUTE } from './time';
import { hpaToInHg, type HourWeather } from './weather';

export type Species = 'deer' | 'turkey';
export type Effect = 'good' | 'neutral' | 'bad';

export interface Factor {
  key: string;
  label: string;
  score: number; // 0..1
  detail: string;
  effect: Effect;
}

export interface HourContext {
  t: number; // start of the hour (epoch ms)
  wx: HourWeather | null; // null = beyond forecast range
  wx3hAgo: HourWeather | null;
  wx24hAgo: HourWeather | null;
  precipPrev3h: number; // inches in the 3 hours before t
  sun: SunDay;
  moonEvents: MoonEvent[];
  moon: MoonPhaseInfo;
  phase: SeasonPhase;
  /** Day's forecast mean temp minus the historical normal (°F), if known */
  tempAnomaly: number | null;
}

export interface HourScore {
  t: number;
  score: number; // 0..100
  legal: boolean;
  activity: number;
  weather: number;
  factors: Factor[];
  notes: string[];
  estimated: boolean;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const gauss = (dt: number, sigma: number) => Math.exp(-(dt * dt) / (2 * sigma * sigma));
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number) => y0 + (y1 - y0) * clamp((x - x0) / (x1 - x0));
const effectOf = (s: number): Effect => (s >= 0.8 ? 'good' : s >= 0.55 ? 'neutral' : 'bad');
const f = (key: string, label: string, score: number, detail: string): Factor => ({
  key,
  label,
  score: clamp(score),
  detail,
  effect: effectOf(clamp(score)),
});

/** Legal shooting hours (typical; many states differ — always check local regs). */
export function legalWindow(species: Species, sun: SunDay): [number, number] {
  return species === 'deer'
    ? [sun.sunrise - 30 * MINUTE, sun.sunset + 30 * MINUTE]
    : [sun.sunrise - 30 * MINUTE, sun.sunset];
}

function overlapMinutes(a0: number, a1: number, b0: number, b1: number) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / MINUTE;
}

// ---------------------------------------------------------------- shared weather factors

function pressureFactor(ctx: HourContext, species: Species): Factor {
  const wx = ctx.wx!;
  const inHg = hpaToInHg(wx.pressureHpa);
  const trend = ctx.wx3hAgo ? wx.pressureHpa - ctx.wx3hAgo.pressureHpa : 0; // hPa / 3h
  const lvl = inHg.toFixed(2);

  let abs: number;
  if (inHg >= 30.0 && inHg <= 30.4) abs = 1;
  else if (inHg > 30.4) abs = inHg <= 30.6 ? 0.85 : 0.7;
  else if (inHg >= 29.9) abs = 0.85;
  else if (inHg >= 29.7) abs = 0.6;
  else abs = 0.4;

  let tr: number;
  let trendText: string;
  if (trend > 0.7) {
    tr = 1;
    trendText = 'rising';
  } else if (trend >= -0.7) {
    tr = 0.8;
    trendText = 'steady';
  } else if (trend >= -2) {
    tr = 0.6;
    trendText = 'falling';
  } else {
    // Deer often feed hard ahead of an approaching front; turkeys tend to go quiet.
    tr = species === 'deer' ? 0.85 : 0.5;
    trendText = 'falling fast';
  }
  const score = 0.5 * abs + 0.5 * tr;
  let why: string;
  if (species === 'deer') {
    why =
      trendText === 'falling fast'
        ? 'A front is approaching, and deer often feed heavily ahead of it.'
        : trendText === 'rising'
          ? 'Rising pressure after a front is classic deer-movement weather.'
          : abs >= 0.85
            ? 'Stable, moderately high pressure supports normal movement.'
            : 'Low pressure is usually tied to stormy, slower periods.';
  } else {
    why =
      trend < -0.7
        ? 'Falling pressure tends to quiet gobbling.'
        : abs >= 0.85
          ? 'High, stable pressure brings good gobbling mornings.'
          : 'Low pressure is usually a sign of unsettled weather.';
  }
  return f('pressure', 'Barometer', score, `${lvl} inHg, ${trendText} (${trend >= 0 ? '+' : ''}${(trend * 0.02953).toFixed(2)} in/3h). ${why}`);
}

function precipFactor(ctx: HourContext, species: Species): Factor {
  const wx = ctx.wx!;
  const p = wx.precipIn;
  const snowing = wx.snowIn > 0.01 || (wx.weatherCode >= 71 && wx.weatherCode <= 86 && wx.weatherCode !== 80 && wx.weatherCode !== 81 && wx.weatherCode !== 82);
  if (wx.weatherCode >= 95) return f('precip', 'Precipitation', 0.1, 'Thunderstorms. Stay safe, because wildlife will hunker down.');
  if (p < 0.005) {
    if (ctx.precipPrev3h >= 0.05)
      return f('precip', 'Precipitation', 1, species === 'deer' ? 'Rain just ended, and deer often get up to feed right after.' : 'Rain just ended. Birds head to open fields to dry off and strut.');
    return f('precip', 'Precipitation', 1, wx.precipProb >= 50 ? `Dry now (${wx.precipProb}% chance later)` : 'Dry');
  }
  if (snowing && p < 0.1)
    return f('precip', 'Precipitation', species === 'deer' ? 0.95 : 0.6, species === 'deer' ? 'Light snow. Deer move well in it, and it makes tracking easier.' : 'Light snow. Turkeys will hang near roost and cover.');
  if (p < 0.02) return f('precip', 'Precipitation', species === 'deer' ? 0.9 : 0.7, species === 'deer' ? 'Drizzle. It quiets your approach and keeps deer moving.' : 'Drizzle. Hunt open fields, since birds move to them in rain.');
  if (p < 0.1) return f('precip', 'Precipitation', species === 'deer' ? 0.65 : 0.5, `Light rain (${p.toFixed(2)} in/hr)`);
  if (p < 0.3) return f('precip', 'Precipitation', 0.35, `Moderate rain (${p.toFixed(2)} in/hr). Movement slows.`);
  return f('precip', 'Precipitation', 0.15, `Heavy ${snowing ? 'snow' : 'rain'} (${p.toFixed(2)} in/hr). Most wildlife beds down.`);
}

// ---------------------------------------------------------------- deer

function deerActivity(ctx: HourContext, mid: number): { value: number; factors: Factor[]; notes: string[] } {
  const { sun, moon, phase } = ctx;
  const notes: string[] = [];
  const morning = gauss(mid - (sun.sunrise + 20 * MINUTE), 70 * MINUTE);
  const evening = gauss(mid - (sun.sunset - 30 * MINUTE), 70 * MINUTE);
  const isNight = mid < sun.civilDawn || mid > sun.civilDusk;
  const cloud = ctx.wx?.cloudCover ?? 50;
  let midday = 0.18 + phase.middayBoost + 0.12 * (cloud / 100);
  // Bitter cold pushes deer to feed in the warmest part of the afternoon.
  if (ctx.wx && ctx.wx.tempF < 25 && mid > sun.solarNoon && mid < sun.sunset) midday += 0.12;
  if (isNight) midday = 0.35;

  // Bright moon: more night feeding → slightly weaker dawn/dusk, a bit more midday movement.
  const bright = moon.illumination;
  const crepuscular = Math.max(morning, evening) * (1 - 0.12 * Math.max(0, bright - 0.5) * 2);
  midday += 0.08 * bright * gauss(mid - sun.solarNoon, 2 * HOUR);
  const tod = Math.max(crepuscular, midday);

  const sol = solunarStrength(mid, ctx.moonEvents);
  const value = clamp(tod + 0.25 * sol.value);

  let todText: string;
  if (isNight) todText = 'Night. Deer are active, but this is outside legal shooting light.';
  else if (morning > 0.5) todText = 'Prime dawn movement as deer return to bedding cover.';
  else if (evening > 0.5) todText = 'Prime evening movement as deer head to food.';
  else if (phase.middayBoost >= 0.2) todText = `Midday, though rut activity keeps bucks moving (${phase.name.toLowerCase()}).`;
  else todText = 'Midday lull. Most deer are bedded.';
  if (cloud > 80 && !isNight && morning < 0.5 && evening < 0.5) todText += ' Overcast skies extend daytime movement.';

  if (sol.label) notes.push(sol.label);
  const moonDetail =
    bright > 0.85
      ? `${moon.name} (${Math.round(bright * 100)}%). More night feeding means slightly less dawn movement, but midday can pick up.`
      : bright < 0.15
        ? `${moon.name}. Dark nights push more feeding into dawn and dusk.`
        : `${moon.name} (${Math.round(bright * 100)}% lit). A modest effect.`;

  return {
    value,
    notes,
    factors: [
      f('time', 'Time of day', tod, todText),
      f('solunar', 'Solunar', 0.4 + 0.6 * sol.value, sol.label ?? 'Not in a solunar period'),
      f('moon', 'Moon phase', bright > 0.85 ? 0.6 : bright < 0.15 ? 0.95 : 0.8, moonDetail),
    ],
  };
}

function deerTemperature(ctx: HourContext): Factor {
  const wx = ctx.wx!;
  const drop = ctx.wx24hAgo ? ctx.wx24hAgo.tempF - wx.tempF : 0;
  let s: number;
  let detail: string;
  if (ctx.tempAnomaly != null) {
    const a = ctx.tempAnomaly;
    s = a <= 0 ? lerp(a, -12, 0, 1, 0.72) : lerp(a, 0, 14, 0.72, 0.25);
    detail = `${Math.round(wx.tempF)}°F. The day runs ${Math.abs(Math.round(a))}° ${a <= 0 ? 'colder' : 'warmer'} than normal. ${
      a <= -6 ? 'A cold snap is a top movement trigger.' : a >= 8 ? 'Unseasonable warmth suppresses daylight movement.' : ''
    }`;
  } else {
    const t = wx.tempF;
    s = t < 35 ? 0.95 : t < 50 ? lerp(t, 35, 50, 0.95, 0.75) : lerp(t, 50, 70, 0.75, 0.3);
    detail = `${Math.round(wx.tempF)}°F. ${t < 40 ? 'Cool temps keep deer comfortable on their feet.' : t > 60 ? 'Warm temps keep deer bedded longer.' : ''}`;
  }
  if (drop >= 10) {
    s += 0.15;
    detail += ` Down ${Math.round(drop)}° from yesterday, which is a strong trigger.`;
  }
  if (wx.tempF < 5) {
    s = Math.min(s, 0.75);
    detail += ' Bitter cold, so expect deer to conserve energy and feed in the afternoon.';
  }
  return f('temp', 'Temperature', s, detail.trim());
}

function deerWind(ctx: HourContext): Factor {
  const { windMph: w, gustMph: g } = ctx.wx!;
  let s: number;
  let d: string;
  if (w < 3) [s, d] = [0.7, 'Nearly calm. Deer can hear well and scent pools around you, so move quietly.'];
  else if (w <= 10) [s, d] = [1, 'An ideal breeze that carries scent predictably.'];
  else if (w <= 15) [s, d] = [0.75, 'Breezy. Deer favor sheltered, downwind-side cover.'];
  else if (w <= 20) [s, d] = [0.5, 'Windy. Deer are nervous and bed in leeward cover.'];
  else [s, d] = [0.25, 'Very windy, so movement drops sharply.'];
  if (g > 30) s -= 0.15;
  return f('wind', 'Wind', s, `${Math.round(w)} mph${g > w + 8 ? `, gusts ${Math.round(g)}` : ''}. ${d}`);
}

// ---------------------------------------------------------------- turkey

function turkeyActivity(ctx: HourContext, mid: number, fall: boolean): { value: number; factors: Factor[]; notes: string[] } {
  const { sun, phase } = ctx;
  const notes: string[] = [];
  const sinceSunrise = (mid - sun.sunrise) / HOUR;
  let tod: number;
  let text: string;
  if (mid < sun.civilDawn - 30 * MINUTE || mid > sun.civilDusk) {
    tod = 0.05;
    text = 'Birds are on the roost.';
  } else if (!fall) {
    const flyDown = gauss(sinceSunrise - 0.6, 1.1);
    const lateMorning = sinceSunrise >= 2.5 && sinceSunrise <= 6.5 ? 0.5 + phase.middayBoost : 0;
    const flyUp = gauss(mid - (sun.sunset - HOUR), 60 * MINUTE) * 0.45;
    tod = Math.max(flyDown, lateMorning, flyUp, 0.3);
    text =
      flyDown >= Math.max(lateMorning, flyUp, 0.3)
        ? sinceSunrise < 0
          ? 'Gobbling from the roost. Get set up close and quietly.'
          : 'Fly-down and the peak strut window, the best time to call.'
        : lateMorning >= Math.max(flyUp, 0.3)
          ? 'Late morning. Toms that hens have left often come to a call.'
          : flyUp > 0.3
            ? 'Birds drift toward roost areas. Do not bump the roost.'
            : 'Afternoon lull. Birds are loafing and dusting.';
  } else {
    const morning = gauss(sinceSunrise - 1, 1.3) * 0.95;
    const evening = gauss(mid - (sun.sunset - 2 * HOUR), 90 * MINUTE) * 0.8;
    tod = Math.max(morning, evening, 0.4 + phase.middayBoost);
    text = morning >= evening && morning > 0.5 ? 'Flocks are leaving the roost to feed.' : evening > 0.5 ? 'Afternoon feeding before roosting.' : 'Midday. Flocks loaf near food and cover.';
  }
  const sol = solunarStrength(mid, ctx.moonEvents);
  if (sol.label && sol.value > 0.5) notes.push(sol.label);
  return {
    value: clamp(tod + 0.1 * sol.value),
    notes,
    factors: [
      f('time', 'Time of day', tod, text),
      f('solunar', 'Solunar', 0.6 + 0.4 * sol.value, (sol.label ?? 'Not in a solunar period') + '. This has a minor effect on turkeys.'),
    ],
  };
}

function turkeyWind(ctx: HourContext): Factor {
  const w = ctx.wx!.windMph;
  let s: number;
  let d: string;
  if (w <= 5) [s, d] = [1, 'Calm, so gobbles carry far and birds hear your calls.'];
  else if (w <= 10) [s, d] = [0.85, 'A light breeze, which is fine.'];
  else if (w <= 15) [s, d] = [0.55, 'Windy, so gobbling drops and birds can be hard to hear. Hunt sheltered hollows.'];
  else if (w <= 20) [s, d] = [0.35, "Strong wind. Turkeys can't hear threats, so they head to open fields."];
  else [s, d] = [0.2, 'Very windy, which makes for tough calling conditions.'];
  return f('wind', 'Wind', s, `${Math.round(w)} mph. ${d}`);
}

function turkeySky(ctx: HourContext): Factor {
  const wx = ctx.wx!;
  const morning = ctx.t < ctx.sun.sunrise + 3 * HOUR;
  if (wx.weatherCode === 45 || wx.weatherCode === 48) return f('sky', 'Sky', 0.6, 'Fog. Birds often stay on the roost longer.');
  if (!morning) return f('sky', 'Sky', 0.85, `${Math.round(wx.cloudCover)}% cloud cover`);
  if (wx.cloudCover < 30) return f('sky', 'Sky', 1, 'A clear morning, which brings the best gobbling.');
  if (wx.cloudCover < 75) return f('sky', 'Sky', 0.85, 'Partly cloudy.');
  return f('sky', 'Sky', 0.7, 'Overcast. Gobbling is often lighter and fly-down later.');
}

function turkeyTemp(ctx: HourContext): Factor {
  const t = ctx.wx!.tempF;
  let s: number;
  let d = '';
  if (t < 20) [s, d] = [0.45, 'Frigid, so birds stay on the roost late.'];
  else if (t < 32) [s, d] = [0.7, 'Cold, so expect a late start to gobbling.'];
  else if (t <= 75) s = 1;
  else if (t <= 85) [s, d] = [0.75, 'Warm, so birds seek shade by midday.'];
  else [s, d] = [0.55, 'Hot, so activity is limited to early and late.'];
  return f('temp', 'Temperature', s, `${Math.round(t)}°F. ${d}`.trim());
}

// ---------------------------------------------------------------- public

const NEUTRAL_WEATHER = 0.72;

export function scoreHour(species: Species, ctx: HourContext): HourScore {
  const mid = ctx.t + 30 * MINUTE;
  const [l0, l1] = legalWindow(species, ctx.sun);
  const legal = overlapMinutes(ctx.t, ctx.t + HOUR, l0, l1) >= 20;
  const fall = 'season' in ctx.phase && (ctx.phase as { season: string }).season !== 'spring';

  const act = species === 'deer' ? deerActivity(ctx, mid) : turkeyActivity(ctx, mid, fall);
  const notes = [...act.notes];
  const factors = [...act.factors];

  let weather: number;
  const estimated = ctx.wx == null;
  if (!ctx.wx) {
    weather = NEUTRAL_WEATHER;
  } else {
    const weighted: [Factor, number][] =
      species === 'deer'
        ? [
            [pressureFactor(ctx, 'deer'), 0.22],
            [deerTemperature(ctx), 0.27],
            [deerWind(ctx), 0.24],
            [precipFactor(ctx, 'deer'), 0.27],
          ]
        : [
            [turkeyWind(ctx), 0.3],
            [precipFactor(ctx, 'turkey'), 0.25],
            [pressureFactor(ctx, 'turkey'), 0.15],
            [turkeySky(ctx), 0.15],
            [turkeyTemp(ctx), 0.15],
          ];
    weather = weighted.reduce((s, [fa, w]) => s + fa.score * w, 0);
    // A single severe factor (storm, gale) should dominate rather than be averaged away.
    const worst = Math.min(...weighted.map(([fa]) => fa.score));
    if (worst < 0.3) weather = Math.min(weather, 0.35 + worst);
    factors.push(...weighted.map(([fa]) => fa));

    // Cold front passage: pressure up and temperature down over the last day.
    if (species === 'deer' && ctx.wx24hAgo) {
      const dp = ctx.wx.pressureHpa - ctx.wx24hAgo.pressureHpa;
      const dt = ctx.wx24hAgo.tempF - ctx.wx.tempF;
      if (dp >= 4 && dt >= 8) {
        weather = clamp(weather + 0.1);
        notes.push('Post-cold-front conditions are among the best days of the season.');
      }
    }
  }

  factors.push(
    f('season', 'Season', clamp(ctx.phase.multiplier / 1.2), `${ctx.phase.name}. ${ctx.phase.note}`),
  );

  const raw = weather * (0.3 + 0.7 * act.value) * ctx.phase.multiplier;
  return {
    t: ctx.t,
    score: Math.round(clamp(raw) * 100),
    legal,
    activity: act.value,
    weather,
    factors,
    notes,
    estimated,
  };
}

/** HuntWise-style 1–10 "Huntability" shown to users (internal scores are 0–100). */
export function huntability(score: number): string {
  return Math.max(1, score / 10).toFixed(1);
}

export function scoreLabel(score: number): { label: string; tone: 'excellent' | 'good' | 'fair' | 'poor' } {
  if (score >= 75) return { label: 'Excellent', tone: 'excellent' };
  if (score >= 60) return { label: 'Good', tone: 'good' };
  if (score >= 42) return { label: 'Fair', tone: 'fair' };
  return { label: 'Poor', tone: 'poor' };
}
