# Hunt Forecast: Whitetail & Turkey

A mobile-friendly web app that predicts hunting conditions for **whitetail deer** and **wild turkey**, hour by hour, at your current location. It also ranks the best days to hunt up to **8 weeks** ahead.

It runs in any phone browser and can be installed to the home screen ("Add to Home Screen"). It needs no account and no API keys.

## What it considers

| Factor | Deer | Turkey |
| --- | --- | --- |
| Time of day vs. sunrise/sunset | Dawn and dusk peaks; overcast extends movement | Fly-down and strut window, late-morning lonely toms, afternoon lull |
| Barometric pressure (level + 3 h trend) | Rising after a front is best; deer feed ahead of a falling front | High and stable is best; falling quiets gobbling |
| Temperature vs. **historical normal** | Cold snaps and 24 h temperature drops are top triggers; warmth suppresses movement | Very cold delays gobbling; heat shortens activity |
| Cold-front passage (pressure ↑ + temp ↓ over 24 h) | Big bonus | — |
| Wind speed | 3–10 mph ideal; >15 mph poor | Calm is best; >15 mph poor |
| Wind direction | Setup advice + your saved stands that fit each window's wind | — |
| Precipitation | Drizzle and light snow are fine; movement just after rain | Rain sends birds to open fields; heavy rain is poor |
| Sky | Cloud cover | Clear mornings bring the best gobbling; fog delays fly-down |
| Solunar periods | Major (moon overhead/underfoot) and minor (moonrise/set) | Minor effect |
| Moon phase | Bright moon shifts feeding to night and midday | — |
| Season | Rut phase from latitude (or your own peak-rut date): pre-rut, seeking/chasing, peak, post-rut, second rut, late season | Spring breakup, peak gobbling, hens nesting; fall flocks |

Each hour's score is **activity × weather × season** (0–100). Tap any hour to see every factor and why it scored that way. Day scores combine the best 2-hour morning and evening windows during legal light.

### Forecast range
- **Days 1–16**: hourly weather forecast ([Open-Meteo](https://open-meteo.com)). Confidence is shown (high → moderate).
- **Days 17–56**: long-range outlook scored from sun, moon, solunar, and rut or season timing only. These are marked as estimates and ranked separately.
- Temperature normals come from the last 5 years of observations (Open-Meteo archive).

## Real-time hunting coach (Hunt tab)

Start a hunt when you reach your stand, and the coach updates every 20 seconds until you walk out:
- **Phase-by-phase guidance** for deer (prep, walk-in, settling in, morning prime, midday, evening, last light, walk-out) and spring or fall turkey (roost, fly-down, strut zone, late morning, afternoon, fly-up).
- **Calling plan with a timer**, matched to the rut or gobbling phase (rattling, grunts, bleats, tree yelps, cackles, cutting), how often to call, and what to do when a buck or tom hangs up. Tap **I just called** to reset the timer.
- **Stand advice:** ranks your stands for the live wind and keeps your scent off your target buck's camera area. It warns ahead of a wind shift and suggests where and when to move.
- **Approach route, thermals, scent control, attractants and decoys** (with legality reminders), and safety.
- **One-tap logging** (saw does, buck, target, hung up, bumped, gobble, harvest) that changes the advice, saved as a hunt log.
- **Keep screen on** and a **red low-light mode** for the stand. **Ask the coach** (an AI chat) is part of the optional AI upgrade.

### Works without cell service
- The app itself is saved on the phone (service worker). It opens with no signal, and with one bar it gives up on the network after a few seconds and uses the saved copy.
- The 16-day hourly forecast, your stands, cameras, deer, and settings are kept on the phone, so the coach, calling timer, stand and wind advice, and hunt log all work offline.
- Anything logged without signal is queued on the phone and syncs to your account automatically when service returns. Repeated edits collapse into one, and nothing is dropped if your login expired in the woods.
- The Hunt tab's **Ready for no service?** checklist confirms that the app, forecast, and your data are saved before you head out. **Ask the coach** (AI) is the only part that needs signal.

## Accounts, trail cameras & target bucks

- **1–10 Huntability** scores, hour by hour and per day, in the style of HuntWise's HuntCast. 8 or higher is a great time to hunt.
- **Personal accounts** (Supabase): saved hunting places, stands and blinds with their good winds, trail cameras, and deer profiles, synced across devices. Each user can only see their own data, enforced by row-level security in `supabase/schema.sql`.
- **Trail cam log** (free): add photos saved from the Browning **Strike Force Wireless** app and tag which buck is in each.
- **AI upgrade** (optional, paid per photo through your own Anthropic account): **Basic** (Claude Haiku) sorts photos and reads the date and time stamp. **Pro** (Claude Opus) also matches bucks against your known deer and flags new bucks. The API key stays in a Supabase Edge Function, and you confirm every suggestion.
- **Target bucks**: for each deer, the app looks up the actual weather at every sighting, learns his pattern (time of day, wind, pressure trend, temperature change, moon, and favorite cameras), compares it with what conditions were common over the same period, then ranks upcoming forecast windows. Each window comes with a stand that suits the wind and keeps your scent off his camera area.

Setup steps for accounts and AI: **[SETUP.md](SETUP.md)**. Without them the app runs in device-only mode.

## Running it

```bash
npm install
npm run dev       # local dev server
npm test          # scoring/astronomy unit tests
npm run build     # production build in dist/ (static files, host anywhere)
```

Location uses the browser's geolocation, which requires HTTPS (or localhost). You can also search for a town.
The last forecast is cached on the device, so the app still opens with weak or no signal in the field.

## Project layout

```
src/lib/astro.ts      sun times, moon phase, moonrise/set & transits, solunar periods
src/lib/weather.ts    Open-Meteo forecast + historical normals
src/lib/season.ts     rut phases, turkey breeding phases
src/lib/scoring.ts    hourly scoring model for both species
src/lib/forecast.ts   builds days, best windows, highlights, rankings
src/lib/patterns.ts   learns a deer's pattern from sightings; target-buck recommendations
src/lib/history.ts    past hourly weather for each sighting
src/lib/photos.ts     trail-cam photo import (EXIF time, resize, AI identify)
src/lib/data/         accounts and storage (Supabase or on-device)
supabase/             database schema and the identify-deer Edge Function
src/components/       React UI
```

## Disclaimer
Legal shooting hours shown are typical defaults (deer: 30 min before sunrise to 30 min after sunset; turkey: to sunset). Always check your state's regulations and season dates.

## Live site

The app is published automatically to GitHub Pages at
**https://jfulton517.github.io/Hunting-App/** every time `main` changes
(see `.github/workflows/deploy.yml`).
