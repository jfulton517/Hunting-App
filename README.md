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
src/components/       React UI
```

## Disclaimer
Legal shooting hours shown are typical defaults (deer: 30 min before sunrise to 30 min after sunset; turkey: to sunset). Always check your state's regulations and season dates.
