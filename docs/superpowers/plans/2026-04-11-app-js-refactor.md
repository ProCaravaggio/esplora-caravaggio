# app.js Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up app.js internals — group globals into namespaces, extract DOM helpers, deduplicate patterns, normalize formatting — without changing behavior.

**Architecture:** Single-file refactor. All changes in `esplora-caravaggio/app.js`. No new files. No build tools. No tests (vanilla JS, no test framework). Verification is manual browser testing.

**Tech Stack:** Vanilla JavaScript, Leaflet 1.9.4, marked.js, DOMPurify

**Note:** Since this is a single-file refactor with no test infrastructure, all tasks are applied as edits to `app.js`. Each task is a logical grouping. Because intermediate states may break cross-references, the recommended execution is to apply all tasks as one coordinated rewrite.

---

### Task 1: Add DOM Helper Functions

**Files:**
- Modify: `esplora-caravaggio/app.js:1-2` (insert at very top, before section 1)

- [ ] **Step 1: Insert DOM helpers at file top**

Insert before `// ===== 1) Mappa =====`:

```js
// ===== DOM Helpers =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function show(el) { if (el) el.style.display = ""; }
function hide(el) { if (el) el.style.display = "none"; }
function toggle(el, on) { if (el) el.style.display = on ? "" : "none"; }
function isHidden(el) { return !el || el.classList.contains("hidden"); }
```

- [ ] **Step 2: Verify helpers don't conflict with existing names**

Grep `app.js` for existing `function show`, `function hide`, `function toggle`, `const $`. None exist — safe.

---

### Task 2: Group Globals into Namespace Objects

**Files:**
- Modify: `esplora-caravaggio/app.js` (sections 1, 2, and all references throughout)

- [ ] **Step 1: Create State namespace**

Replace the scattered globals in section 2 (lines 387-392):

```js
// Before:
let allPois = [];
let markers = [];
let userLatLng = null;
let userLocateMarker = null;
let activeCategory = "all";

// After:
const State = {
  allPois: [],
  markers: [],
  activeCategory: "all",
};
```

- [ ] **Step 2: Create Track namespace**

Replace scattered tracking globals (lines 50-62):

```js
// Before:
let tracking = false;
let watchId = null;
let trackStartMs = 0;
let trackMeters = 0;
let lastLatLng = null;
let uiTimer = null;
let followUser = true;
let didAutoCenter = false;
let userMarker = null;
let accCircle = null;

// After:
const Track = {
  active: false,
  watchId: null,
  startMs: 0,
  meters: 0,
  lastLatLng: null,
  uiTimer: null,
  followUser: true,
  didAutoCenter: false,
  userMarker: null,
  accCircle: null,
};
```

- [ ] **Step 3: Create Route namespace**

Replace route globals (lines 27-29, 45-47):

```js
// Before:
let itinerariLayer = null;
let routesVisible = true;
let routePolylines = [];
let activeRouteLayer = null;
const ROUTE_NEAR_METERS = 180;

// After:
const Route = {
  itinerariLayer: null,
  visible: true,
  polylines: [],
  activeLayer: null,
  NEAR_METERS: 180,
};
```

- [ ] **Step 4: Create Geo namespace**

Replace geolocation globals:

```js
// Before:
let userLatLng = null;
let userLocateMarker = null;
let compassOn = false;

// After:
const Geo = {
  userLatLng: null,
  locateMarker: null,
  compassOn: false,
};
```

- [ ] **Step 5: Create Lightbox namespace**

Replace lightbox globals (lines 1473-1475):

```js
// Before:
let lbImgs = [];
let lbIndex = 0;
let lbTitle = "";

// After:
const Lb = {
  imgs: [],
  index: 0,
  title: "",
};
```

- [ ] **Step 6: Create Favs namespace**

Replace favorites globals (lines 399-401):

```js
// Before:
const FAV_KEY = "caravaggio_favs_v1";
let favSet = new Set();
let onlyFavs = false;

// After:
const Favs = {
  KEY: "caravaggio_favs_v1",
  set: new Set(),
  onlyActive: false,
};
```

- [ ] **Step 7: Update ALL references throughout the file**

Every reference to the old globals must be updated. Key mappings:

| Old | New |
|-----|-----|
| `allPois` | `State.allPois` |
| `markers` | `State.markers` |
| `activeCategory` | `State.activeCategory` |
| `tracking` | `Track.active` |
| `watchId` | `Track.watchId` |
| `trackStartMs` | `Track.startMs` |
| `trackMeters` | `Track.meters` |
| `lastLatLng` | `Track.lastLatLng` |
| `uiTimer` | `Track.uiTimer` |
| `followUser` | `Track.followUser` |
| `didAutoCenter` | `Track.didAutoCenter` |
| `userMarker` | `Track.userMarker` |
| `accCircle` | `Track.accCircle` |
| `itinerariLayer` | `Route.itinerariLayer` |
| `routesVisible` | `Route.visible` |
| `routePolylines` | `Route.polylines` |
| `activeRouteLayer` | `Route.activeLayer` |
| `ROUTE_NEAR_METERS` | `Route.NEAR_METERS` |
| `userLatLng` | `Geo.userLatLng` |
| `userLocateMarker` | `Geo.locateMarker` |
| `compassOn` | `Geo.compassOn` |
| `lbImgs` | `Lb.imgs` |
| `lbIndex` | `Lb.index` |
| `lbTitle` | `Lb.title` |
| `favSet` | `Favs.set` |
| `FAV_KEY` | `Favs.KEY` |
| `onlyFavs` | `Favs.onlyActive` |

---

### Task 3: Extract Generic Leaflet Control Helper

**Files:**
- Modify: `esplora-caravaggio/app.js` (after DOM helpers, before section 1)

- [ ] **Step 1: Add `lazyControl` factory**

```js
// ===== Leaflet Control Helper =====
function lazyControl(position, className) {
  let ctrl = null;
  let el = null;
  return {
    ensure(buildHtml) {
      if (ctrl) return;
      ctrl = L.control({ position });
      ctrl.onAdd = () => {
        el = L.DomUtil.create("div", className);
        el.innerHTML = buildHtml();
        L.DomEvent.disableClickPropagation(el);
        return el;
      };
      ctrl.addTo(map);
    },
    el() { return el || $(`.${className}`); },
    show(on, html) {
      this.ensure(() => html || "");
      const node = this.el();
      toggle(node, on);
      if (on && html !== undefined) node.innerHTML = html;
    },
  };
}
```

- [ ] **Step 2: Replace exitRouteCtrl with lazyControl**

```js
// Before: ensureExitRouteBtn() + showExitRouteBtn() (~20 lines)
// After:
const exitRouteControl = lazyControl("topright", "route-exit");

function showExitRouteBtn(on) {
  exitRouteControl.ensure(() =>
    `<button type="button" class="route-exit-btn">Esci percorso</button>`
  );
  const btn = exitRouteControl.el()?.querySelector("button");
  if (btn) btn.onclick = clearRouteMode;
  exitRouteControl.show(on);
}
```

- [ ] **Step 3: Replace routeInfoCtrl with lazyControl**

```js
// Before: ensureRouteInfoUI() + showRouteInfo() (~18 lines)
// After:
const routeInfoControl = lazyControl("topright", "route-info");

function showRouteInfo(on, html) {
  routeInfoControl.show(on, html);
}
```

- [ ] **Step 4: Replace trackCtrl with lazyControl**

```js
// Before: ensureTrackUI() + showTrackUI() + inline event listener (~50 lines)
// After:
const trackControl = lazyControl("bottomleft", "track-box");

function showTrackUI(on) {
  trackControl.ensure(() => `
    <div class="track-row">
      <strong>Tracciamento</strong>
      <button type="button" class="track-btn" data-act="toggle">Start</button>
    </div>
    <div class="track-metrics">
      ⏱ <span data-t="time">00:00</span>
      <span class="track-sep">•</span>
      📏 <span data-t="dist">0.00</span> km
    </div>
  `);
  const btn = trackControl.el()?.querySelector('[data-act="toggle"]');
  if (btn && !btn.__bound) {
    btn.__bound = true;
    btn.addEventListener("click", handleTrackToggle);
  }
  toggle(trackControl.el(), on);
}
```

Where `handleTrackToggle` is extracted from the inline anonymous function currently at lines 148-174.

---

### Task 4: Replace querySelector/Display Patterns with Helpers

**Files:**
- Modify: `esplora-caravaggio/app.js` (throughout)

- [ ] **Step 1: Replace document.getElementById calls in UI section**

```js
// Before:
const searchInput = document.getElementById("searchInput");
const clearSearchBtn = document.getElementById("clearSearch");
const sidePanel = document.getElementById("sidePanel");
// ... etc

// After:
const searchInput = $("#searchInput");
const clearSearchBtn = $("#clearSearch");
const sidePanel = $("#sidePanel");
// ... etc
```

Apply to all ~20 `document.getElementById` and `document.querySelector` calls in the UI section.

- [ ] **Step 2: Replace display toggle patterns**

```js
// Before:
if (el) el.style.display = show ? "" : "none";

// After:
toggle(el, show);
```

```js
// Before:
lbPrev.style.display = total > 1 ? "" : "none";
lbNext.style.display = total > 1 ? "" : "none";

// After:
toggle(lbPrev, total > 1);
toggle(lbNext, total > 1);
```

- [ ] **Step 3: Replace querySelectorAll with $$**

```js
// Before:
legendEl.querySelectorAll(".legend-item").forEach(el => { ... });

// After:
$$(".legend-item", legendEl).forEach(el => { ... });
```

- [ ] **Step 4: Use isHidden helper for drawer state checks**

```js
// Before:
if (nearbyDrawer && !nearbyDrawer.classList.contains("hidden")) renderNearbyList();
if (favsDrawer && !favsDrawer.classList.contains("hidden")) renderFavsList();

// After:
if (!isHidden(nearbyDrawer)) renderNearbyList();
if (!isHidden(favsDrawer)) renderFavsList();
```

This pattern appears 6 times in the file.

---

### Task 5: Deduplicate POI Card HTML

**Files:**
- Modify: `esplora-caravaggio/app.js` (section 9-10)

- [ ] **Step 1: Merge poiCardHtml and favCardHtml into one function**

```js
// Before: two separate functions (poiCardHtml ~15 lines, favCardHtml ~14 lines)
// After:
function poiCardHtml(p, { compact = false } = {}) {
  const d = getPrettyDistance(p);
  const fav = isFav(p);
  const cls = compact ? "poi-card poi-card--fav" : "poi-card";

  return `
    <div class="${cls}" data-poi="${escapeHtml(poiId(p))}">
      <div class="poi-top">
        <div class="t">${escapeHtml(p.name)}</div>
        <button class="fav-mini" type="button"
          aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}"
          aria-pressed="${fav ? "true" : "false"}">${fav ? "★" : "☆"}</button>
      </div>
      ${compact
        ? (d ? `<div class="s">${escapeHtml(d)}</div>` : "")
        : `<div class="s">${escapeHtml(p.category || "")}${d ? ` • ${escapeHtml(d)}` : ""}</div>
           <div class="m">${escapeHtml(truncate(p.short || p.long || "", 110))}</div>`
      }
    </div>
  `;
}
```

- [ ] **Step 2: Update callers**

```js
// renderNearbyList: poiCardHtml(x.p) → poiCardHtml(x.p) (unchanged — default)
// renderFavsList: favCardHtml(p) → poiCardHtml(p, { compact: true })
```

---

### Task 6: Extract Track Toggle Handler

**Files:**
- Modify: `esplora-caravaggio/app.js` (section 1, tracking area)

- [ ] **Step 1: Extract inline handler to named function**

```js
// Before: anonymous function inside ensureTrackUI (lines 148-174)
// After:
function handleTrackToggle() {
  if (!Track.active) {
    showRouteInfo(false);
    startTracking();
    if (Track.lastLatLng) map.setView(Track.lastLatLng, 17, { animate: true });
    return;
  }

  if (!Track.followUser) {
    Track.followUser = true;
    Track.didAutoCenter = false;
    if (Track.lastLatLng) {
      map.setView(Track.lastLatLng, Math.max(map.getZoom(), 17), { animate: true });
      Track.didAutoCenter = true;
    }
    updateTrackUI();
    return;
  }

  stopTracking();
}
```

---

### Task 7: Normalize Formatting

**Files:**
- Modify: `esplora-caravaggio/app.js` (entire file)

- [ ] **Step 1: Normalize indentation to 2 spaces**

Fix all lines using 4 spaces, tabs, or mixed indent. Key areas with inconsistent indent:
- `renderMarkers` inner block (lines 1015-1020): 3-space + mixed
- `applyRouteMode` (line 326): no indent on if-statement
- `clearRouteMode` (line 369): no indent on if-statement
- `locateMe` callback (lines 1284-1289): mixed 2/0 indent
- `loadItinerari` style callback (lines 1401-1411): mixed

- [ ] **Step 2: Add consistent semicolons**

Missing semicolons on ~15 lines. Key spots:
- After `ASSETS` array items in callbacks
- Several `if` blocks with single statements

- [ ] **Step 3: Remove trailing blank lines**

Lines 1553-1582 are all blank. Remove them.

- [ ] **Step 4: Normalize spacing around operators and keywords**

Fix: `makeIcon ("icons/farmacia.png")` → `makeIcon("icons/farmacia.png")` (line 698 — space before paren).

- [ ] **Step 5: Consistent blank lines between sections**

Use exactly 1 blank line between functions, 2 blank lines between major sections (the `// =====` headers).

---

### Task 8: Verify

- [ ] **Step 1: Open app in browser**

```bash
cd esplora-caravaggio && python3 -m http.server 8000
```

- [ ] **Step 2: Manual verification checklist**

1. Map loads with CARTO tiles
2. POI markers appear on map
3. Click marker → side panel opens with images, description
4. Category filter drawer opens/closes, filters markers
5. Level switcher works (see/stories/hidden/lost)
6. Search filters markers by text
7. Route click → highlights route, dims distant POIs, shows info
8. Exit route button works
9. Favorites: add/remove, persists on reload
10. Nearby list shows sorted by distance (if GPS available)
11. Lightbox opens on image click, arrows navigate
12. ESC closes panels and lightbox
13. Deep-link `?poi=...` opens correct panel
