# app.js Single-File Refactor — Design Spec

## Goal

Clean up `app.js` (~1580 lines) without splitting into multiple files. Reduce globals, extract repeated patterns, normalize formatting. Keep all behavior identical.

## Approach: Namespace Objects + DOM Helpers

### 1. Group Globals into Namespace Objects

Current state: ~30 loose `let`/`const` globals scattered across sections.

**After:**

| Namespace | Contains |
|-----------|----------|
| `State` | `allPOIs`, `markers`, `activeCat`, `activeLevels`, `favs` |
| `Track` | `active`, `watchId`, `startMs`, `meters`, `lastLatLng`, `followUser`, `didAutoCenter`, `uiTimer` |
| `Route` | `polylines`, `activeLayer`, `NEAR_METERS` (180) |
| `Geo` | `userLatLng`, `userMarker`, `userLocateMarker`, `accCircle`, `compassHeading` |
| `Controls` | `exitRouteCtrl`, `routeInfoCtrl`, `trackCtrl` |
| `UI` | `sidePanel`, `map` (Leaflet instance ref) |

Rules:
- `DEFAULT_VIEW` stays as top-level const (immutable config).
- `map` stays top-level (used everywhere, namespace adds noise not clarity).
- Only group things that are logically related AND mutated together.

### 2. DOM Helpers

Extract repeated querySelector + display toggle pattern:

```js
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => root.querySelectorAll(sel);

function show(el) { if (el) el.style.display = ""; }
function hide(el) { if (el) el.style.display = "none"; }
function toggle(el, on) { on ? show(el) : hide(el); }
```

These replace ~40+ instances of `document.querySelector(x)` and `el.style.display = show ? "" : "none"` patterns.

### 3. Generic Leaflet Control Helper

Three pairs (`ensureExitRouteBtn`/`showExitRouteBtn`, `ensureRouteInfoUI`/`showRouteInfo`, `ensureTrackUI`/`showTrackUI`) follow identical pattern: lazy-create a Leaflet control, show/hide it. Extract:

```js
function lazyControl(cfg) {
  let ctrl = null;
  return {
    ensure() { /* create once, add to map */ },
    show(on, html) { /* toggle display, optionally set innerHTML */ },
    el() { /* return DOM element */ }
  };
}
```

Then each control becomes a one-liner definition instead of ~20 lines.

### 4. Formatting Normalization

- **Indentation**: Normalize to 2-space everywhere (currently mixed 2/4/tabs)
- **Semicolons**: Add consistently (currently ~90% present, some missing)
- **Brace style**: K&R / 1TBS consistently
- **Spacing**: Consistent space after keywords (`if (`, `for (`), around operators
- **Trailing whitespace**: Remove
- **Blank lines**: Max 2 consecutive, 1 between functions, 2 between sections

### 5. Naming Cleanup

- Keep section comment headers (`// ===== 1) Mappa =====`) — they're useful navigation
- Keep Italian comments — they document domain knowledge
- Variable names: consistent camelCase (already mostly true, just fix outliers)
- Function names: verb-first (`formatHMS` stays, already good pattern)

### 6. Reduce Repetition — Other Patterns

- **Event listener setup**: Several places do `L.DomEvent.disableClickPropagation(div)` + `div.querySelector("button").addEventListener(...)` — leave as-is, not enough repetition to justify abstraction.
- **POI rendering in panels**: `openSidePanel()` builds HTML string. Keep as-is — it's a single function, extracting pieces would scatter related logic.
- **Category/icon mapping**: Already a clean object lookup. No change.

## Out of Scope

- No file splitting (user chose single-file)
- No build tools / ES modules
- No new features
- No changes to HTML, CSS, data files, or service worker
- No changes to behavior — pure refactor

## Verification

After refactor, manually verify:
- Map loads with markers
- Category filter works
- Search works
- Side panel opens with images
- Route mode highlights route
- GPS tracking starts/stops
- Favorites persist across reload
- Nearby POI list sorts by distance
