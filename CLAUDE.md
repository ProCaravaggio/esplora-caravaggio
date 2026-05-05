# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Esplora Caravaggio** is an interactive map PWA for exploring the town of Caravaggio (Lombardy, Italy). It showcases historical sites, churches, buildings, and heritage walking routes. The primary language of the UI and content is Italian, with English translations available.

Repository: `ProCaravaggio/esplora-caravaggio`

## Tech Stack

- **Vanilla JavaScript** (no frameworks, no bundler, no build step)
- **Leaflet 1.9.4** for mapping (CARTO Voyager tiles)
- **marked.js** + **DOMPurify** for rendering Markdown descriptions
- **CSS3** with CSS custom properties (dark warm palette: `--bg: #1B1410`, `--accent: #8B2F2B`)
- **PWA** via service worker (`sw.js`) with cache-first strategy for same-origin assets

All dependencies are loaded from CDN (unpkg, jsdelivr) — there is no `package.json` or dependency management.

## Running Locally

No build step. Serve the `esplora-caravaggio/` directory over HTTP:

```bash
cd esplora-caravaggio
python3 -m http.server 8000
# or: npx serve
```

Opening `index.html` directly works for basic testing but the service worker and some features require HTTP.

## Architecture

The entire app lives in a single file **`app.js`** (~1580 lines), organized into numbered sections:

| Section | Lines (approx) | Purpose |
|---------|----------------|---------|
| 1) Mappa | 1–100 | Leaflet map init, CARTO tiles, `routesPane` (z-index 350), route mode, GPS tracking state |
| 2) Stato | 386–445 | Global state: `allPOIs[]`, `markers[]`, active layers, favorites from `localStorage` |
| 3) UI | 446–677 | Topbar collapse, drawer open/close animations, category/level drawer logic |
| 4) Icone | 678–735 | `L.icon` definitions per POI category (one icon per `.png` in `icons/`) |
| 5) Helpers | 736–806 | Distance calculations (Haversine), `distanceLabel()`, markdown rendering helper |
| 6) Side panel + Slider | 807–972 | POI detail panel: image slider, description, links, favorites toggle |
| 7) Markers | 973–1046 | Creates Leaflet markers from `allPOIs`, applies category icons and click handlers |
| 8) Legenda categorie | 1047–1112 | Category filter drawer: toggle visibility per category, "select all/none" |
| 9) Vicino a me | 1113–1203 | Sorts POIs by distance from user's GPS position, displays ranked list |
| 10) Preferiti | 1204–1225 | Favorites panel (localStorage-backed) |
| 11) Geolocalizzazione | 1226–1303 | User location marker with compass arrow, `DeviceOrientationEvent` |
| 12) Search | 1304–1334 | Text search filtering POIs by name |
| 13) Init | 1335–end | Bootstrap: fetch `poi.json` + `itinerari.geojson`, build markers, load itineraries, lightbox |

### Key Patterns

- **Route mode**: Clicking an itinerary highlights it, dims unrelated POIs (those >180m from the polyline via `ROUTE_NEAR_METERS`), shows exit button + route info control.
- **GPS tracking**: Uses `navigator.geolocation.watchPosition` with a "follow user" mode (Maps-style). Tracking UI is a Leaflet control (`bottomleft`). Accuracy filter at 35m, jitter filter at 10m.
- **Compass arrow**: `DeviceOrientationEvent` rotates user marker icon. iOS requires explicit permission request.
- **Favorites**: Stored as POI name array in `localStorage["favs"]`.
- **Layers/Levels**: POIs have `type` (e.g., `see`, `eat`, `sleep`) controlling which layer toggle shows them. Categories within types control icons and legend filtering.
- **POIs with `-MANCANTE` suffix**: Incomplete entries (missing data). The suffix on `type` and `category` fields marks them as work-in-progress.

## Data Files

- **`poi.json`** — Array of POI objects: `{ name, type, category, short, long, lat, lon, links[], imgs[] }`
  - `long` field supports Markdown (rendered via `marked.js`)
  - `imgs` are relative paths into `img/`
- **`itinerari.geojson`** — FeatureCollection of LineString features with `name`, `desc`, `stroke`, `stroke-width` properties
- **`cuts.json`** — Additional GeoJSON route data

## Service Worker (`sw.js`)

Cache name: `mappacaravaggio-v1`. Cache-first for same-origin, network pass-through for CDN. The `ASSETS` array lists all files to precache — **update it when adding new HTML pages or static assets**.

## Multilingual Setup

Italian is the primary version (`index.html`, `guida.html`, `privacy.html`, `note-legali.html`). English pages are suffixed with `-en` (e.g., `index-en.html`, `guida-en.html`). Both versions share the same `app.js`, `styles.css`, and data files.

## Conventions

- All UI strings in `app.js` are in Italian (e.g., button labels, alert messages)
- CSS uses the `:root` custom property palette — maintain the warm dark theme
- `prefers-reduced-motion: reduce` is respected — avoid adding animations without checking
- Focus-visible outlines are styled — maintain keyboard accessibility
- Icon files in `icons/` follow category naming (e.g., `chiese.png`, `edifici.png`, `militari.png`)
