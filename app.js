// ===== DOM Helpers =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
function show(el) { if (el) el.style.display = ""; }
function hide(el) { if (el) el.style.display = "none"; }
function toggle(el, on) { if (el) el.style.display = on ? "" : "none"; }
function isHidden(el) { return !el || el.classList.contains("hidden") || el.style.display === "none"; }


// ===== Leaflet Control Helper =====
function lazyControl(position, className) {
  let ctrl = null;
  return {
    ensure(buildHtml) {
      if (ctrl) return;
      ctrl = L.control({ position });
      ctrl.onAdd = () => {
        const div = L.DomUtil.create("div", className);
        div.innerHTML = buildHtml();
        L.DomEvent.disableClickPropagation(div);
        return div;
      };
      ctrl.addTo(map);
    },
    el() { return $(`.${className}`); },
    show(on, html) {
      this.ensure(() => html || "");
      toggle(this.el(), on);
      if (on && html !== undefined) { const node = this.el(); if (node) node.innerHTML = html; }
    },
  };
}


// ===== 1) Mappa =====
const DEFAULT_VIEW = { center: [45.497, 9.644], zoom: 15 };

const map = L.map("map", { zoomControl: false });

function kickLeafletResize() {
  setTimeout(() => map.invalidateSize(), 50);
  setTimeout(() => map.invalidateSize(), 250);
}

window.addEventListener("resize", kickLeafletResize);
window.addEventListener("orientationchange", kickLeafletResize);
map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
}).addTo(map);

// se l'utente trascina la mappa, smetti di seguirlo (stile Maps)
map.on("dragstart", () => {
  if (Track.active) Track.followUser = false;
});


// ===== Pane itinerari (sotto ai marker) =====
map.createPane("routesPane");
map.getPane("routesPane").style.zIndex = 350;


// ===== Itinerari (LineString) + Punti pericolosi (Point) =====
const Route = {
  itinerariLayer: null,
  visible: true,
  polylines: [],
  activeLayer: null,
  NEAR_METERS: 180,
};

function setRoutesVisible(on) {
  Route.visible = !!on;

  if (Route.itinerariLayer) {
    if (Route.visible) Route.itinerariLayer.addTo(map);
    else Route.itinerariLayer.remove();
  }

  // se nascondi i percorsi mentre sei in route mode -> esci
  if (!Route.visible && Route.activeLayer) clearRouteMode();

  // aggiorna UI categorie se aperta
  updateLegendActiveState();
}


// ===== Modalità percorso =====
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

const Geo = {
  userLatLng: null,
  locateMarker: null,
  compassOn: false,
};

function formatHMS(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return (h ? `${h}:` : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function getRouteLengthKm(layer) {
  const latlngs = layer.getLatLngs();
  const segs = Array.isArray(latlngs[0]) ? latlngs : [latlngs];

  let meters = 0;
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      meters += seg[i - 1].distanceTo(seg[i]);
    }
  }
  return meters / 1000;
}

function estimateTimeMinutes(km, speedKmh) {
  return Math.round((km / speedKmh) * 60);
}

const exitRouteControl = lazyControl("topright", "route-exit");

function showExitRouteBtn(on) {
  exitRouteControl.ensure(() =>
    `<button type="button" class="route-exit-btn">Esci percorso</button>`
  );
  const btn = exitRouteControl.el()?.querySelector("button");
  if (btn && !btn.__bound) {
    btn.__bound = true;
    btn.addEventListener("click", clearRouteMode);
  }
  toggle(exitRouteControl.el(), on);
}

const routeInfoControl = lazyControl("topright", "route-info");

function showRouteInfo(on, html) {
  routeInfoControl.show(on, html);
}

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

function updateTrackUI() {
  const box = $(".track-box");
  if (!box) return;

  const tEl = $('[data-t="time"]', box);
  const dEl = $('[data-t="dist"]', box);
  const btn = $('[data-act="toggle"]', box);

  const now = Date.now();
  const elapsed = Track.active ? now - Track.startMs : 0;

  if (tEl) tEl.textContent = Track.active ? formatHMS(elapsed) : "00:00";
  if (dEl) dEl.textContent = (Track.meters / 1000).toFixed(2);
  if (btn) btn.textContent = !Track.active ? "Start" : (Track.followUser ? "Stop" : "Centra");
}

function startTracking() {
  if (!("geolocation" in navigator)) {
    alert("Geolocalizzazione non supportata dal browser.");
    return;
  }

  Track.active = true;
  Track.startMs = Date.now();
  Track.meters = 0;
  Track.lastLatLng = null;
  Track.followUser = true;
  Track.didAutoCenter = false;
  if (Track.uiTimer) clearInterval(Track.uiTimer);
  Track.uiTimer = setInterval(updateTrackUI, 1000);

  Track.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const cur = L.latLng(latitude, longitude);

      // filtro: ignora GPS troppo impreciso
      if (accuracy && accuracy > 35) return;

      // SOLO freccia (stessa cosa del "pallino"): crea o aggiorna Geo.locateMarker
      if (!Geo.locateMarker) {
        Geo.locateMarker = L.marker(cur, { icon: userArrowIcon }).addTo(map);
        enableCompassOnce();
      } else {
        Geo.locateMarker.setLatLng(cur);
      }

      // aggiorna anche Geo.userLatLng così distanze/"vicino a me" restano coerenti
      Geo.userLatLng = cur;

      // comportamento "Maps": al primo fix centra forte, poi segue con pan
      if (Track.followUser) {
        if (!Track.didAutoCenter) {
          map.setView(cur, Math.max(map.getZoom(), 17), { animate: true });
          Track.didAutoCenter = true;
        } else {
          map.panTo(cur, { animate: true });
        }
      }

      if (Track.lastLatLng) {
        const d = Track.lastLatLng.distanceTo(cur);
        // ignora jitter sotto 10m
        if (d >= 10) Track.meters += d;
      }

      Track.lastLatLng = cur;
      updateTrackUI();
    },
    () => {
      stopTracking();
      alert("Posizione non disponibile (permesso negato o segnale debole).");
    },
    { enableHighAccuracy: true, maximumAge: 1500, timeout: 12000 }
  );

  updateTrackUI();
}

function stopTracking() {
  Track.active = false;

  if (Track.watchId !== null) {
    navigator.geolocation.clearWatch(Track.watchId);
    Track.watchId = null;
  }
  if (Track.uiTimer) {
    clearInterval(Track.uiTimer);
    Track.uiTimer = null;
  }
  if (Track.userMarker) {
    map.removeLayer(Track.userMarker);
    Track.userMarker = null;
  }
  if (Track.accCircle) {
    map.removeLayer(Track.accCircle);
    Track.accCircle = null;
  }
  updateTrackUI();
}

// distanza punto -> polilinea (metri) in WebMercator
function pointToPolylineMeters(polyLayer, latlng) {
  const latlngs = polyLayer.getLatLngs();
  const segs = Array.isArray(latlngs[0]) ? latlngs : [latlngs];

  const crs = map.options.crs;
  const p = crs.project(latlng);

  function distPointToSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;

    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);

    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);

    const t = c1 / c2;
    const px = a.x + t * vx;
    const py = a.y + t * vy;
    return Math.hypot(p.x - px, p.y - py);
  }

  let best = Infinity;
  for (const seg of segs) {
    for (let i = 1; i < seg.length; i++) {
      const a = crs.project(seg[i - 1]);
      const b = crs.project(seg[i]);
      best = Math.min(best, distPointToSeg(p, a, b));
    }
  }
  return best;
}

function applyRouteMode(routeLayer, routeName = "", routeDesc = "") {
  Route.activeLayer = routeLayer;
  if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(true);

  // evidenzia percorso attivo, spegne gli altri
  Route.polylines.forEach(l => {
    if (l === Route.activeLayer) l.setStyle({ weight: 7, opacity: 1 });
    else l.setStyle({ weight: 4, opacity: 0.18 });
  });

  // zoom sul percorso
  try { map.fitBounds(Route.activeLayer.getBounds(), { padding: [30, 30] }); } catch {}

  // POI: tutti attenuati, ma quelli vicini restano normali
  State.markers.forEach(m => {
    const p = m.__poi;
    if (!p) return;
    const d = pointToPolylineMeters(Route.activeLayer, L.latLng(p.lat, p.lon));
    const near = d <= Route.NEAR_METERS;
    m.setOpacity(near ? 1 : 0.28);
  });

  // box info percorso (km + minuti stimati)
  const km = getRouteLengthKm(Route.activeLayer);
  const walkMin = estimateTimeMinutes(km, 3.5);
  const bikeMin = estimateTimeMinutes(km, 15);

  const html = `
    <div class="route-info-title">${escapeHtml(routeName || "Percorso")}</div>
    <div class="route-info-row">📏 <strong>${km.toFixed(1)} km</strong></div>
    <div class="route-info-row">🚶 ${walkMin} min &nbsp; <span class="route-info-muted">•</span> &nbsp; 🚴 ${bikeMin} min</div>
    ${routeDesc ? `<div class="route-info-desc">${escapeHtml(routeDesc)}</div>` : ""}
  `;
  showRouteInfo(true, html);

  // bottoni
  showExitRouteBtn(true);

  // tracking box (start/stop manuale)
  showTrackUI(true);
  updateTrackUI();
}

function clearRouteMode() {
  Route.activeLayer = null;
  if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(false);

  // reset stile itinerari
  Route.polylines.forEach(l => l.setStyle({ weight: 5, opacity: 0.9 }));

  // reset POI
  State.markers.forEach(m => m.setOpacity(1));

  // nascondi box
  showExitRouteBtn(false);
  showRouteInfo(false);
  showTrackUI(false);

  // stop tracking se attivo
  stopTracking();
}


// ===== 2) Stato =====
const State = {
  allPois: [],
  markers: [],
  activeCategory: "all",
  activeTypes: new Set(["see"]),
};

const Favs = {
  KEY: "caravaggio_favs_v1",
  set: new Set(),
  onlyActive: false,
};

function loadFavs() {
  try {
    const raw = localStorage.getItem(Favs.KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) Favs.set = new Set(arr);
  } catch {}
}

function saveFavs() {
  try {
    localStorage.setItem(Favs.KEY, JSON.stringify([...Favs.set]));
  } catch {}
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function poiId(p) {
  if (!p) return "";
  if (p.id) return String(p.id);
  const base = slugify(p.name);
  const lat = Number(p.lat).toFixed(5);
  const lon = Number(p.lon).toFixed(5);
  return `${base}-${lat}-${lon}`;
}

function isFav(p) { return Favs.set.has(poiId(p)); }

function toggleFav(p) {
  const id = poiId(p);
  if (!id) return false;
  if (Favs.set.has(id)) Favs.set.delete(id);
  else Favs.set.add(id);
  saveFavs();
  return Favs.set.has(id);
}


// ===== 3) UI =====
const searchInput = $("#searchInput");
const clearSearchBtn = $("#clearSearch");

const sidePanel = $("#sidePanel");
const closePanel = $("#closePanel");
const panelContent = $("#panelContent");

// Header height (per drawer)
const headerEl = $(".topbar");

function syncHeaderHeight() {
  if (!headerEl) return;
  document.documentElement.style.setProperty("--header-h", headerEl.offsetHeight + "px");
}

const footerEl = $(".footer");

function syncFooterHeight() {
  if (!footerEl) return;
  document.documentElement.style.setProperty("--footer-h", footerEl.offsetHeight + "px");
}

window.addEventListener("resize", syncFooterHeight);
syncFooterHeight();

window.addEventListener("resize", syncHeaderHeight);
syncHeaderHeight();
let fullHeaderH = headerEl ? headerEl.offsetHeight : 120;

window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    syncHeaderHeight();
    syncFooterHeight();
    if (map) map.invalidateSize();
  }
});


// ===== Topbar collassabile =====
const topbarToggle = $("#toggleTopbar");

function setTopbarCollapsed(collapsed) {
  if (!headerEl) return;

  if (!collapsed) {
    // expanding: restore full height immediately so map doesn't get overlapped
    document.documentElement.style.setProperty("--header-h", fullHeaderH + "px");
  } else {
    // collapsing: calculate target height (full minus controls + its margin) so map moves immediately
    const controlsEl = headerEl.querySelector(".controls");
    if (controlsEl) {
      const mt = parseFloat(getComputedStyle(controlsEl).marginTop) || 0;
      const targetH = fullHeaderH - controlsEl.offsetHeight - mt;
      document.documentElement.style.setProperty("--header-h", targetH + "px");
    }
  }

  headerEl.classList.toggle("is-collapsed", collapsed);
  document.body.classList.toggle("ui-hidden", collapsed);

  if (topbarToggle) {
    topbarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    topbarToggle.textContent = collapsed ? "▴" : "▾";
    topbarToggle.setAttribute("aria-label", collapsed ? "Espandi pannello" : "Comprimi pannello");
  }

  // Sync after transition completes (max-height takes 250ms)
  setTimeout(() => {
    syncHeaderHeight();
    map.invalidateSize();
  }, 270);
}

if (topbarToggle) {
  topbarToggle.addEventListener("click", () => {
    const isCollapsed = headerEl.classList.contains("is-collapsed");
    setTopbarCollapsed(!isCollapsed);
  });
}


// ===== Drawer helper (animazione leggera) =====
function openDrawer(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");
  el.classList.remove("anim-in");
  requestAnimationFrame(() => el.classList.add("anim-in"));
}

function closeDrawer(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
  el.classList.remove("anim-in");
}


// ===== Drawer livelli =====
const toggleLevels = $("#toggleLevels");
const levelsDrawer = $("#levelsDrawer");
const closeLevels = $("#closeLevels");
const levelsList = $("#levelsList");
const toggleRoutes = $("#toggleRoutes");

function openLevels() {
  openDrawer(levelsDrawer);
  syncLevelsUI();
  syncRoutesUI();
}

function closeLevelsDrawer() { closeDrawer(levelsDrawer); }

if (toggleLevels) toggleLevels.addEventListener("click", () => {
  if (!levelsDrawer) return;
  isHidden(levelsDrawer) ? openLevels() : closeLevelsDrawer();
});
if (closeLevels) closeLevels.addEventListener("click", closeLevelsDrawer);

function syncRoutesUI() {
  if (!toggleRoutes) return;
  toggleRoutes.classList.toggle("active", Route.visible);
  toggleRoutes.setAttribute("aria-pressed", Route.visible ? "true" : "false");
}

if (toggleRoutes) {
  toggleRoutes.addEventListener("click", () => {
    setRoutesVisible(!Route.visible);
    syncRoutesUI();
  });
}

function setLevel(mode) {
  // includi anche "services" quando scegli "Tutti"
  if (mode === "all") State.activeTypes = new Set(["see", "stories", "hidden", "lost"]);
  else State.activeTypes = new Set([mode]);

  State.activeCategory = "all";

  closeLevelsDrawer();
  closeSidePanel();

  // mostra disclaimer quando attivi "services"
  if (mode === "services") showServicesDisclaimer();

  buildLegend();
  renderMarkers({ shouldZoom: true });

  if (!isHidden(nearbyDrawer)) renderNearbyList();
  if (!isHidden(favsDrawer)) renderFavsList();
}

function syncLevelsUI() {
  if (!levelsList) return;
  const chips = $$(".level-chip", levelsList);

  const isAll = ["see", "stories", "hidden", "lost", "services"].every(x => State.activeTypes.has(x));
  chips.forEach(ch => {
    const lv = ch.dataset.level;
    ch.classList.toggle("active",
      (lv === "all" && isAll) || (lv !== "all" && !isAll && State.activeTypes.has(lv))
    );
  });
}

if (levelsList) {
  levelsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".level-chip");
    if (!btn) return;
    setLevel(btn.dataset.level);
  });
}


// Drawer categorie
const toggleCats = $("#toggleCats");
const catsDrawer = $("#catsDrawer");
const closeCats = $("#closeCats");
const legendEl = $("#legend");

function openCats() { openDrawer(catsDrawer); }
function closeCatsDrawer() { closeDrawer(catsDrawer); }

if (toggleCats) toggleCats.addEventListener("click", () => {
  if (!catsDrawer) return;
  isHidden(catsDrawer) ? openCats() : closeCatsDrawer();
});
if (closeCats) closeCats.addEventListener("click", closeCatsDrawer);

// Drawer vicini
const toggleNearby = $("#toggleNearby");
const nearbyDrawer = $("#nearbyDrawer");
const closeNearby = $("#closeNearby");
const nearbyList = $("#nearbyList");

// Drawer preferiti: toggle "solo preferiti"
const toggleOnlyFavsBtn = $("#toggleOnlyFavs");

function syncOnlyFavsUI() {
  if (!toggleOnlyFavsBtn) return;
  toggleOnlyFavsBtn.classList.toggle("active", Favs.onlyActive);
  toggleOnlyFavsBtn.setAttribute("aria-pressed", Favs.onlyActive ? "true" : "false");
}

if (toggleOnlyFavsBtn) {
  toggleOnlyFavsBtn.addEventListener("click", () => {
    Favs.onlyActive = !Favs.onlyActive;

    renderMarkers({ shouldZoom: true });
    renderFavsList();
    buildLegend();
    updateLegendActiveState();

    syncOnlyFavsUI();
  });
}

const openGuide = $("#openGuide");

if (openGuide) {
  openGuide.addEventListener("pointerup", (e) => {
    e.preventDefault();
    window.location.href = "guida.html";
  }, { passive: false });
}

function openNearby() {
  openDrawer(nearbyDrawer);

  // "Vicino a me" fa anche "Dove sono io?"
  if (!Geo.userLatLng) {
    locateMe();
    return; // aspetta il callback del GPS, che poi aggiorna lista e marker
  }

  renderNearbyList();
}

function closeNearbyDrawer() { closeDrawer(nearbyDrawer); }

if (toggleNearby) toggleNearby.addEventListener("click", () => {
  if (!nearbyDrawer) return;
  isHidden(nearbyDrawer) ? openNearby() : closeNearbyDrawer();
});
if (closeNearby) closeNearby.addEventListener("click", closeNearbyDrawer);

// Drawer preferiti
const toggleFavs = $("#toggleFavs");
const favsDrawer = $("#favsDrawer");
const closeFavs = $("#closeFavs");
const favsList = $("#favsList");

function openFavs() {
  openDrawer(favsDrawer);
  renderFavsList();
  syncOnlyFavsUI();
}

function closeFavsDrawer() { closeDrawer(favsDrawer); }

if (toggleFavs) toggleFavs.addEventListener("click", () => {
  if (!favsDrawer) return;
  isHidden(favsDrawer) ? openFavs() : closeFavsDrawer();
});
if (closeFavs) closeFavs.addEventListener("click", closeFavsDrawer);


// ===== 4) Icone =====
function makeIcon(url) {
  return L.icon({
    iconUrl: url,
    iconSize: [32, 37],
    iconAnchor: [16, 37],
    popupAnchor: [0, -33]
  });
}

const categoryIcons = {
  "Chiese e monasteri": makeIcon("icons/chiese.png"),
  "Museo": makeIcon("icons/museo.png"),
  "Natura": makeIcon("icons/natura.png"),
  "Opere militari e fortificazioni": makeIcon("icons/militari.png"),
  "Personaggi della storia": makeIcon("icons/personaggi.png"),
  "Storia": makeIcon("icons/storia.png"),
  "Tesori nascosti": makeIcon("icons/tesorinascosti.png"),
  "Edifici": makeIcon("icons/edificio.png"),
  "DAE": makeIcon("icons/DAE.png"),
  "Farmacia": makeIcon("icons/farmacia.png"),
  "Stazione del treno": makeIcon("icons/treno.png"),
  "Stazione del bus": makeIcon("icons/bus.png"),
  "Parcheggio": makeIcon("icons/parcheggio.png"),
  "Località": makeIcon("icons/localita.png"),
  "Luoghi": makeIcon("icons/localita.png"),
  "Postazione di polizia": makeIcon("icons/polizia.png")
};

const defaultIcon = makeIcon("icons/default.png");

// --- varianti "lost" (type === "lost") per alcune categorie ---
const lostTypeIcons = {
  "Chiese e monasteri": makeIcon("icons/chiesesco.png"),
  "Opere militari e fortificazioni": makeIcon("icons/militarisco.png"),
  "Edifici": makeIcon("icons/edificisco.png"),
};

// Helper: normalizza type in modo robusto
function normalizeType(t) {
  return String(t || "").trim().toLowerCase();
}

// Questa è la funzione da usare quando crei i marker
function getIconForFeature(feature) {
  const categoria = feature?.properties?.categoria || feature?.properties?.category;
  const type = normalizeType(feature?.properties?.type);

  // Se è "lost" e la categoria è tra quelle speciali -> icona speciale
  if (type === "lost" && lostTypeIcons[categoria]) {
    return lostTypeIcons[categoria];
  }

  // Altrimenti icona standard per categoria
  return categoryIcons[categoria] || defaultIcon;
}


// ===== 5) Helpers =====
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function truncate(str, max = 220) {
  const s = String(str || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "\u2026";
}

function distanceMetersTo(p) {
  if (!Geo.userLatLng) return null;
  return Geo.userLatLng.distanceTo(L.latLng(p.lat, p.lon));
}

function getPrettyDistance(p) {
  const meters = distanceMetersTo(p);
  if (meters == null) return "";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

// URL indicazioni Google Maps (se ho posizione: origine=io, altrimenti apre destinazione)
function googleMapsDirectionsUrl(p) {
  if (!p) return "#";
  const dest = `${p.lat},${p.lon}`;
  if (Geo.userLatLng) {
    const orig = `${Geo.userLatLng.lat},${Geo.userLatLng.lng}`;
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(orig)}&destination=${encodeURIComponent(dest)}&travelmode=walking`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`;
}

// deep-link: set / clear parametro in URL
function setPoiUrlParam(p) {
  const id = poiId(p);
  if (!id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("poi", id);
  history.replaceState({}, "", url.toString());
}

function clearPoiUrlParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("poi");
  history.replaceState({}, "", url.toString());
}

async function copyLinkForPoi(p) {
  const id = poiId(p);
  if (!id) return;
  const url = new URL(window.location.href);
  url.searchParams.set("poi", id);
  const text = url.toString();

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      alert("Link copiato negli appunti.");
    } else {
      prompt("Copia questo link:", text);
    }
  } catch {
    prompt("Copia questo link:", text);
  }
}


// ===== 6) Side panel + Slider =====
function openPanel(p, distancePretty) {
  if (!sidePanel || !panelContent) return;

  if (window.matchMedia("(max-width: 640px)").matches) setTopbarCollapsed(true);

  const imgs = Array.isArray(p.imgs) ? p.imgs : (p.img ? [p.img] : []);
  const sliderHtml = imgs.length
    ? `
      <div class="slider" data-slider>
        <button class="slider-btn prev" type="button" aria-label="Foto precedente">&#8249;</button>
        <button class="slider-btn next" type="button" aria-label="Foto successiva">&#8250;</button>

        <div class="slider-track" data-track>
          ${imgs.map((src, i) => `
            <div class="slide">
              <img src="${src}" alt="${escapeHtml(p.name)} (${i + 1})" data-open-lightbox="${i}">
            </div>
          `).join("")}
        </div>

        <div class="slider-dots" data-dots>
          ${imgs.map((_, i) => `<span class="slider-dot ${i === 0 ? "active" : ""}" data-dot="${i}"></span>`).join("")}
        </div>
      </div>
    `
    : "";

  const directionsUrl = googleMapsDirectionsUrl(p);
  const fav = isFav(p);

  panelContent.innerHTML = `
    <div class="panel-title">${escapeHtml(p.name)}</div>
    <div class="badge">${escapeHtml(p.category)}</div>

    ${sliderHtml}

    <div class="panel-actions">
      <a class="btn-primary" href="${directionsUrl}" target="_blank" rel="noopener">Apri Google Maps</a>

      <button class="icon-btn" type="button" data-fav-act="toggle"
        aria-label="${fav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti"}"
        aria-pressed="${fav ? "true" : "false"}">
        ${fav ? "\u2605" : "\u2606"}
      </button>

      <button class="icon-btn" type="button" data-share-act="copy" aria-label="Copia link">\uD83D\uDD17</button>
    </div>

    <div class="panel-text" id="panelText"></div>

    ${distancePretty ? `<div class="panel-distance">\uD83D\uDCCD Distanza: <strong>${escapeHtml(distancePretty)}</strong></div>` : ""}
  `;

  // Markdown sicuro: escape HTML -> parse -> sanitize -> render
  const panelText = $("#panelText");
  const raw = p.long || p.short || "";

  const escaped = escapeHtml(raw);
  const parsed = marked.parse(escaped);
  const safeHtml = DOMPurify.sanitize(parsed);
  panelText.innerHTML = safeHtml;

  sidePanel.classList.remove("hidden");
  sidePanel.setAttribute("aria-hidden", "false");

  // animazione leggera
  sidePanel.classList.remove("anim-in");
  requestAnimationFrame(() => sidePanel.classList.add("anim-in"));

  const favBtn = $('[data-fav-act="toggle"]', panelContent);
  if (favBtn) {
    favBtn.addEventListener("click", () => {
      const nowFav = toggleFav(p);
      favBtn.textContent = nowFav ? "\u2605" : "\u2606";
      favBtn.setAttribute("aria-pressed", nowFav ? "true" : "false");
      favBtn.setAttribute("aria-label", nowFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti");

      if (!isHidden(favsDrawer)) renderFavsList();
      if (!isHidden(nearbyDrawer)) renderNearbyList();
    });
  }

  const shareBtn = $('[data-share-act="copy"]', panelContent);
  if (shareBtn) {
    shareBtn.addEventListener("click", () => copyLinkForPoi(p));
  }

  setupSliderAndLightbox(imgs, p.name);
  setPoiUrlParam(p);
}

function closeSidePanel() {
  if (!sidePanel) return;
  sidePanel.classList.add("hidden");
  sidePanel.setAttribute("aria-hidden", "true");
  clearPoiUrlParam();
}

if (closePanel) closePanel.addEventListener("click", closeSidePanel);

// ESC chiude pannello e drawer (accessibilità)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // se lightbox aperto, gestisce lui (vedi sotto)
  if (!isHidden(lightbox)) return;
  closeSidePanel();
  closeCatsDrawer();
  closeNearbyDrawer();
  closeFavsDrawer();
});

// Slider behavior (scroll-snap + pallini + frecce + click immagine)
function setupSliderAndLightbox(imgs, title) {
  const slider = $("[data-slider]", panelContent);
  if (!slider || !imgs || imgs.length === 0) return;

  const track = $("[data-track]", slider);
  const dotsWrap = $("[data-dots]", slider);
  const btnPrev = $(".slider-btn.prev", slider);
  const btnNext = $(".slider-btn.next", slider);
  if (!track || !dotsWrap) return;

  const dots = $$("[data-dot]", dotsWrap);

  function setActiveDot(i) {
    dots.forEach((d, idx) => d.classList.toggle("active", idx === i));
  }

  function scrollToIndex(i) {
    const w = track.clientWidth;
    track.scrollTo({ left: i * (w + 10), behavior: "smooth" });
    setActiveDot(i);
  }

  track.addEventListener("scroll", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    const clamped = Math.max(0, Math.min(i, imgs.length - 1));
    setActiveDot(clamped);
  }, { passive: true });

  if (btnPrev) btnPrev.addEventListener("click", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    scrollToIndex(Math.max(0, i - 1));
  });

  if (btnNext) btnNext.addEventListener("click", () => {
    const w = track.clientWidth;
    const i = Math.round(track.scrollLeft / (w + 10));
    scrollToIndex(Math.min(imgs.length - 1, i + 1));
  });

  dots.forEach(d => d.addEventListener("click", () => scrollToIndex(Number(d.dataset.dot))));

  $$("[data-open-lightbox]", slider).forEach(imgEl => {
    imgEl.style.cursor = "zoom-in";
    imgEl.addEventListener("click", () => {
      const i = Number(imgEl.dataset.openLightbox);
      openLightbox(imgs, i, title);
    });
  });
}


// ===== 7) Markers =====
function clearMarkers() {
  State.markers.forEach(m => m.remove());
  State.markers = [];
}

function computeFiltered() {
  const q = searchInput ? searchInput.value.trim().toLowerCase() : "";

  return State.allPois.filter(p => {
    const t = (p.type || "see");
    const matchType = State.activeTypes.has(t);

    const matchCat = (State.activeCategory === "all") || (p.category === State.activeCategory);

    const hay = `${p.name} ${p.short || ""} ${p.long || ""}`.toLowerCase();
    const matchQ = !q || hay.includes(q);
    const matchFav = !Favs.onlyActive || Favs.set.has(poiId(p));
    return matchType && matchCat && matchQ && matchFav;
  });
}

function zoomToVisibleMarkers() {
  if (State.markers.length === 0) return;

  if (State.markers.length === 1) {
    map.setView(State.markers[0].getLatLng(), 17, { animate: true });
    return;
  }

  const group = L.featureGroup(State.markers);
  map.fitBounds(group.getBounds(), { padding: [30, 30], animate: true });
}

function renderMarkers({ shouldZoom = false } = {}) {
  clearMarkers();

  const filtered = computeFiltered();

  filtered.forEach(p => {
    const pretty = getPrettyDistance(p);
    const icon = getIconForFeature({
      properties: {
        categoria: p.category,
        type: p.type
      }
    });

    const m = L.marker([p.lat, p.lon], { icon }).addTo(map);
    m.__poi = p;
    m.on("click", () => openPanel(p, pretty));
    State.markers.push(m);
  });

  if (shouldZoom) zoomToVisibleMarkers();

  // se sei in modalità percorso e cambi filtri: riapplica opacità coerente
  if (Route.activeLayer) {
    State.markers.forEach(m => {
      const p = m.__poi;
      if (!p) return;
      const d = pointToPolylineMeters(Route.activeLayer, L.latLng(p.lat, p.lon));
      const near = d <= Route.NEAR_METERS;
      m.setOpacity(near ? 1 : 0.28);
    });
  }

  // aggiorna liste se aperte
  if (!isHidden(nearbyDrawer)) renderNearbyList();
  if (!isHidden(favsDrawer)) renderFavsList();
}


// ===== 8) Legenda categorie (drawer) =====
function updateLegendActiveState() {
  if (!legendEl) return;

  $$(".legend-item", legendEl).forEach(el => {
    el.classList.toggle(
      "active",
      State.activeCategory !== "all" && el.dataset.cat === State.activeCategory
    );
  });
}

function buildLegend() {
  if (!legendEl) return;
  legendEl.innerHTML = "";

  const counts = {};
  computeFiltered().forEach(p => {
    if (!p.category) return;
    counts[p.category] = (counts[p.category] || 0) + 1;
  });

  const cats = Object.keys(counts).sort((a, b) => a.localeCompare(b, "it"));

  L.DomEvent.disableClickPropagation(legendEl);
  L.DomEvent.disableScrollPropagation(legendEl);

  cats.forEach(cat => {
    const row = document.createElement("div");
    row.className = "legend-item";
    row.dataset.cat = cat;

    const iconUrl =
      (categoryIcons[cat] && categoryIcons[cat].options && categoryIcons[cat].options.iconUrl)
        ? categoryIcons[cat].options.iconUrl
        : "icons/default.png";

    row.innerHTML = `
      <div class="legend-left">
        <img class="legend-icon" src="${iconUrl}" alt="">
        <div class="legend-name">${escapeHtml(cat)}</div>
      </div>
      <div class="legend-count">${counts[cat] || 0}</div>
    `;

    row.addEventListener("click", () => {
      State.activeCategory = (State.activeCategory === cat) ? "all" : cat;
      closeCatsDrawer();
      closeSidePanel();
      renderMarkers({ shouldZoom: true });
      updateLegendActiveState();
    });

    legendEl.appendChild(row);
  });

  updateLegendActiveState();
}


// ===== 9) Vicino a me =====
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
          aria-pressed="${fav ? "true" : "false"}">${fav ? "\u2605" : "\u2606"}</button>
      </div>
      ${compact
        ? (d ? `<div class="s">${escapeHtml(d)}</div>` : "")
        : `<div class="s">${escapeHtml(p.category || "")}${d ? ` \u2022 ${escapeHtml(d)}` : ""}</div>
           <div class="m">${escapeHtml(truncate(p.short || p.long || "", 110))}</div>`
      }
    </div>
  `;
}

function bindPoiCardActions(container) {
  if (!container) return;

  $$(".poi-card", container).forEach(card => {
    const id = card.dataset.poi;
    const p = State.allPois.find(x => poiId(x) === id);
    if (!p) return;

    card.addEventListener("click", (e) => {
      if (e.target && e.target.closest(".fav-mini")) return;
      map.setView([p.lat, p.lon], 17, { animate: true });
      openPanel(p, getPrettyDistance(p));
    });

    const favBtn = $(".fav-mini", card);
    if (favBtn) {
      favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const nowFav = toggleFav(p);
        favBtn.textContent = nowFav ? "\u2605" : "\u2606";
        favBtn.setAttribute("aria-pressed", nowFav ? "true" : "false");
        favBtn.setAttribute("aria-label", nowFav ? "Rimuovi dai preferiti" : "Aggiungi ai preferiti");
        if (!isHidden(favsDrawer)) renderFavsList();
      });
    }
  });
}

function renderNearbyList() {
  if (!nearbyList) return;

  if (!Geo.userLatLng) {
    nearbyList.innerHTML = `
      <div class="hint-box">
        Per vedere cosa c'è vicino, premi <strong>Dove sono io?</strong>.
      </div>
    `;
    return;
  }

  const filtered = computeFiltered();
  const withDist = filtered
    .map(p => ({ p, d: distanceMetersTo(p) }))
    .filter(x => x.d != null)
    .sort((a, b) => a.d - b.d)
    .slice(0, 20);

  if (withDist.length === 0) {
    nearbyList.innerHTML = `<div class="hint-box">Nessun luogo trovato con i filtri attuali.</div>`;
    return;
  }

  nearbyList.innerHTML = withDist.map(x => poiCardHtml(x.p)).join("");
  bindPoiCardActions(nearbyList);
}


// ===== 10) Preferiti =====
function renderFavsList() {
  if (!favsList) return;

  const favPois = State.allPois.filter(p => Favs.set.has(poiId(p)));

  if (favPois.length === 0) {
    favsList.innerHTML = `<div class="hint-box">Nessun preferito salvato.</div>`;
    return;
  }

  let sorted = [...favPois];
  if (Geo.userLatLng) {
    sorted.sort((a, b) => (distanceMetersTo(a) ?? 1e12) - (distanceMetersTo(b) ?? 1e12));
  } else {
    sorted.sort((a, b) => String(a.name).localeCompare(String(b.name), "it"));
  }

  favsList.innerHTML = sorted.map(p => poiCardHtml(p, { compact: true })).join("");
  bindPoiCardActions(favsList);
}


// ===== 11) Geolocalizzazione =====
const userArrowIcon = L.divIcon({
  className: "user-arrow",
  html: "\u27A4",
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

function enableCompassOnce() {
  if (Geo.compassOn) return;

  const start = () => {
    Geo.compassOn = true;

    const handler = (e) => {
      if (!Geo.locateMarker) return;

      const alpha = (e && typeof e.alpha === "number") ? e.alpha : null;
      if (alpha == null) return;

      const heading = 360 - alpha;
      const el = Geo.locateMarker.getElement();
      if (el) el.style.transform = `rotate(${heading}deg)`;
    };

    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
  };

  // iOS: chiede permesso
  if (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") {
    DeviceOrientationEvent.requestPermission()
      .then(state => { if (state === "granted") start(); })
      .catch(() => {});
  } else {
    start();
  }
}

function locateMe() {
  if (!("geolocation" in navigator)) {
    alert("Geolocalizzazione non supportata dal browser.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      Geo.userLatLng = L.latLng(latitude, longitude);

      map.setView([latitude, longitude], 16, { animate: true });

      // evita frecce duplicate
      if (!Geo.locateMarker) {
        Geo.locateMarker = L.marker([latitude, longitude], { icon: userArrowIcon }).addTo(map);
        enableCompassOnce();
      } else {
        Geo.locateMarker.setLatLng([latitude, longitude]);
      }

      // niente popup "fastidioso": solo marker
      renderMarkers(); // aggiorna distanze
      if (!isHidden(nearbyDrawer)) renderNearbyList();
      if (!isHidden(favsDrawer)) renderFavsList();
    },
    () => alert("Posizione non disponibile (permesso negato o segnale debole).")
  );
}


// ===== 12) Search: X interna =====
function syncClearBtn() {
  if (!clearSearchBtn || !searchInput) return;
  const has = !!searchInput.value.trim();
  clearSearchBtn.style.opacity = has ? "1" : "0";
  clearSearchBtn.style.pointerEvents = has ? "auto" : "none";
  clearSearchBtn.setAttribute("aria-hidden", has ? "false" : "true");
}

if (searchInput) {
  searchInput.addEventListener("input", () => {
    closeSidePanel();
    renderMarkers();
    updateLegendActiveState();
    syncClearBtn();
  });
}

if (clearSearchBtn && searchInput) {
  clearSearchBtn.addEventListener("click", () => {
    searchInput.value = "";
    syncClearBtn();
    closeSidePanel();
    renderMarkers({ shouldZoom: false });
    updateLegendActiveState();
    searchInput.focus();
  });
}

syncClearBtn();


// ===== 13) Init =====
async function init() {
  loadFavs();

  const res = await fetch("poi.json");
  State.allPois = await res.json();

  buildLegend();
  renderMarkers();

  // deep-link: ?poi=
  const url = new URL(window.location.href);
  const poiParam = url.searchParams.get("poi");
  if (poiParam) {
    const p = State.allPois.find(x => poiId(x) === poiParam);
    if (p) {
      map.setView([p.lat, p.lon], 17, { animate: false });
      openPanel(p, getPrettyDistance(p));
    }
  }

  // carica itinerari dopo tutto
  loadItinerari();
}

init();


// ===== Carica Itinerari =====
const palette = [
  "#C8A15A", "#4DA3FF", "#38D39F", "#F05D5E",
  "#9B8CFF", "#FFB020", "#6BA368", "#B85C38",
  "#5F7DA3", "#8E6C8A", "#A3A847", "#3F8F8B",
  "#C27C2C", "#7A5C3E"
];

const colorByName = new Map();
let colorIndex = 0;

function getColorForName(name) {
  if (colorByName.has(name)) return colorByName.get(name);
  const c = palette[colorIndex % palette.length];
  colorByName.set(name, c);
  colorIndex++;
  return c;
}

async function loadItinerari() {
  try {
    const res = await fetch("itinerari.geojson", { cache: "no-store" });
    if (!res.ok) throw new Error("Impossibile caricare itinerari.geojson");
    const geo = await res.json();

    if (Route.itinerariLayer) Route.itinerariLayer.remove();

    // reset route mode storage
    Route.polylines = [];
    Route.activeLayer = null;
    showExitRouteBtn(false);
    showRouteInfo(false);
    showTrackUI(false);
    stopTracking();

    Route.itinerariLayer = L.geoJSON(geo, {
      pane: "routesPane",

      // stile linee (colori stabili per nome)
      style: (f) => {
        const t = f.geometry?.type;
        if (t !== "LineString" && t !== "MultiLineString") return null;

        const name = String(
          f.properties?.name || f.properties?.Nome || f.properties?.title || "Itinerario"
        );

        const color = getColorForName(name);
        return { color, weight: 5, opacity: 0.9 };
      },

      // punti pericolosi come cerchi rossi (sotto ai marker)
      pointToLayer: (f, latlng) => {
        return L.circleMarker(latlng, {
          pane: "routesPane",
          radius: 7,
          color: "#ff3b30",
          fillColor: "#ff3b30",
          fillOpacity: 0.9,
          weight: 2
        });
      },

      onEachFeature: (f, layer) => {
        const g = f.geometry?.type;

        if (g === "Point") {
          const name =
            f.properties?.name ||
            f.properties?.Nome ||
            f.properties?.title ||
            "Punto pericoloso";

          layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`, { autoPan: true });
        }

        if (g === "LineString" || g === "MultiLineString") {
          const name =
            f.properties?.name ||
            f.properties?.Nome ||
            f.properties?.title ||
            "Itinerario";

          const desc =
            f.properties?.desc ||
            f.properties?.descrizione ||
            f.properties?.short ||
            "";

          Route.polylines.push(layer);
          layer.on("click", () => applyRouteMode(layer, name, desc));
        }
      }
    });

    if (Route.visible) Route.itinerariLayer.addTo(map);

  } catch (err) {
    console.warn(err);
  }
}


// ===== Lightbox (fullscreen) =====
const lightbox = $("#lightbox");
const lbImg = $("#lbImg");
const lbClose = $("#lbClose");
const lbPrev = $("#lbPrev");
const lbNext = $("#lbNext");
const lbCounter = $("#lbCounter");

const Lb = {
  imgs: [],
  index: 0,
  title: "",
};

function openLightbox(imgs, startIndex = 0, title = "") {
  if (!lightbox || !lbImg) return;

  Lb.imgs = imgs;
  Lb.index = startIndex;
  Lb.title = title;

  lightbox.classList.remove("hidden");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  renderLightbox();
}

function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.add("hidden");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderLightbox() {
  if (!lbImg) return;
  const total = Lb.imgs.length;
  const src = Lb.imgs[Lb.index];

  lbImg.src = src;
  lbImg.alt = Lb.title ? `${Lb.title} (${Lb.index + 1}/${total})` : `Foto ${Lb.index + 1}/${total}`;

  if (lbCounter) lbCounter.textContent = `${Lb.index + 1}/${total}`;
  toggle(lbPrev, total > 1);
  toggle(lbNext, total > 1);
}

function lbSetIndex(i) {
  const total = Lb.imgs.length;
  Lb.index = (i + total) % total;
  renderLightbox();
}

if (lbClose) lbClose.addEventListener("click", closeLightbox);
if (lbPrev) lbPrev.addEventListener("click", () => lbSetIndex(Lb.index - 1));
if (lbNext) lbNext.addEventListener("click", () => lbSetIndex(Lb.index + 1));

if (lightbox) {
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
}

document.addEventListener("keydown", (e) => {
  if (!lightbox || isHidden(lightbox)) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") lbSetIndex(Lb.index - 1);
  if (e.key === "ArrowRight") lbSetIndex(Lb.index + 1);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js");
  });
}

function showServicesDisclaimer() {
  const el = $("#servicesDisclaimer");
  if (!el) return;

  el.classList.remove("hidden");

  const btn = $("#closeDisclaimer");
  if (btn && !btn.__bound) {
    btn.__bound = true;
    btn.addEventListener("click", () => {
      el.classList.add("hidden");
    });
  }
}
