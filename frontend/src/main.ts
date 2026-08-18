import "./styles.css";
import categoryMap from "../../data/category-map.json";
import type { CategoryDef, CategoryId, Cluster, Filters } from "./types";
import { fetchArticlesAt, fetchClusters } from "./data/api";
import { NewsGlobe } from "./globe/globe";
import { createFilterBar } from "./ui/filters";
import { createTimeSlider } from "./ui/timeslider";
import { TeaserPanel } from "./ui/panel";

const CATEGORIES = (categoryMap as { categories: CategoryDef[] }).categories;
const MAX_HOURS_BACK = 8 * 24;

const els = {
  globe: document.getElementById("globe")!,
  filters: document.getElementById("filters")!,
  timebar: document.getElementById("timebar")!,
  panel: document.getElementById("panel")!,
  status: document.getElementById("status")!,
};

const filters: Filters = {
  categories: readCategoriesFromUrl(),
  until: new Date(),
  windowHours: 24,
  biasMin: null,
  biasMax: null,
};

const panel = new TeaserPanel(els.panel, CATEGORIES);
panel.close();

const globe = new NewsGlobe({
  container: els.globe,
  categories: CATEGORIES,
  onPinClick: openCluster,
  onZoomChange: () => scheduleReload(),
});

createFilterBar({
  container: els.filters,
  categories: CATEGORIES,
  selected: filters.categories,
  onChange: (sel) => {
    filters.categories = sel;
    writeCategoriesToUrl(sel);
    scheduleReload(0);
  },
});

const timeSlider = createTimeSlider({
  container: els.timebar,
  maxHoursBack: MAX_HOURS_BACK,
  onChange: (until, windowHours) => {
    filters.until = until;
    filters.windowHours = windowHours;
    scheduleReload(0);
  },
});
filters.until = timeSlider.until;
filters.windowHours = timeSlider.windowHours;

// ------------------------------------------------------------------ Laden
let reloadTimer: number | undefined;
let inFlight = 0;

function scheduleReload(delay = 350) {
  window.clearTimeout(reloadTimer);
  reloadTimer = window.setTimeout(load, delay);
}

async function load() {
  const ticket = ++inFlight;
  setStatus("Lade Meldungen …");
  try {
    const clusters = await fetchClusters(filters, globe.zoom);
    if (ticket !== inFlight) return; // veraltete Antwort verwerfen
    globe.setClusters(clusters);
    const total = clusters.reduce((s, c) => s + c.n, 0);
    setStatus(
      clusters.length === 0
        ? "Keine Meldungen in diesem Zeitfenster."
        : `${total} Meldungen an ${clusters.length} Orten`,
    );
  } catch (e) {
    if (ticket !== inFlight) return;
    setStatus(e instanceof Error ? e.message : "Daten konnten nicht geladen werden.", true);
  }
}

async function openCluster(c: Cluster) {
  panel.open(c.location_name);
  globe.flyTo(c.lat, c.lon, 0.9);
  try {
    const articles = await fetchArticlesAt(c.lat, c.lon, filters);
    panel.render(articles);
  } catch (e) {
    panel.showError(
      e instanceof Error
        ? `Details nicht ladbar: ${e.message}`
        : "Details konnten nicht geladen werden.",
    );
  }
}

function setStatus(text: string, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("is-error", isError);
}

// ------------------------------------------------------------------ URL-Zustand
function readCategoriesFromUrl(): Set<CategoryId> {
  const raw = new URLSearchParams(location.search).get("cat");
  const valid = new Set(CATEGORIES.map((c) => c.id));
  const set = new Set<CategoryId>();
  if (!raw) return set;
  for (const part of raw.split(",")) {
    const id = part.trim() as CategoryId;
    if (valid.has(id)) set.add(id);
  }
  return set;
}

function writeCategoriesToUrl(sel: Set<CategoryId>) {
  const url = new URL(location.href);
  if (sel.size) url.searchParams.set("cat", [...sel].join(","));
  else url.searchParams.delete("cat");
  history.replaceState(null, "", url);
}

// Alle 5 Minuten nachladen, solange das Live-Fenster aktiv ist.
window.setInterval(() => {
  if (Math.abs(filters.until.getTime() - Date.now()) < 20 * 60_000) {
    filters.until = new Date();
    timeSlider.refresh();
    load();
  }
}, 5 * 60_000);

load();
