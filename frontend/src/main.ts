import "./styles.css";
import categoryMap from "../../data/category-map.json";
import type { CategoryDef, CategoryId, Cluster, Filters } from "./types";
import {
  fetchArticlesAt,
  fetchArticlesOfEvent,
  fetchClusters,
  hasSupabase,
  radiusForZoom,
} from "./data/api";
import { CONNECTORS, createSettingsPanel, loadSettings, OWNERSHIP } from "./ui/settings";
import { NewsMap } from "./map/map";
import { createFilterBar } from "./ui/filters";
import { createInfoDialog } from "./ui/info";
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
  settings: document.getElementById("settings")!,
  settingsToggle: document.getElementById("settings-toggle")!,
  info: document.getElementById("info") as HTMLDialogElement,
  infoToggle: document.getElementById("info-toggle")!,
};

const settings = loadSettings();
// Wie viele Möglichkeiten es überhaupt gibt – daran erkennt die Abfrage, ob
// überhaupt gefiltert wird und der schnelle Snapshot noch taugt.
const QUELLEN_GESAMT = CONNECTORS.filter((c) => c.status === "active").length;
const TRAEGER_GESAMT = OWNERSHIP.length;

const filters: Filters = {
  categories: readCategoriesFromUrl(),
  connectors: settings.connectors,
  ownership: settings.ownership,
  until: new Date(),
  windowHours: 24,
  biasMin: null,
  biasMax: null,
};

/**
 * Beim ersten Laden ohne `?cat=` wählt der Zufall eine Rubrik.
 *
 * Der Globus mit allen Rubriken gleichzeitig ist ein Farbrauschen, in dem nichts
 * auffällt. Eine einzelne Rubrik erzählt sofort etwas — und weil sie bei jedem
 * Aufruf wechselt, sieht man beim zweiten Besuch eine andere Welt. Die Wahl
 * wandert bewusst *nicht* in die URL: geteilt wird nur, was jemand selbst
 * ausgewählt hat.
 */
let starterWahlOffen = filters.categories.size === 0;

const panel = new TeaserPanel(els.panel, CATEGORIES, () => globe.setAuswahl(null));

const globe = new NewsMap({
  container: els.globe,
  categories: CATEGORIES,
  onPinClick: openCluster,
  onZoomChange: () => scheduleReload(),
  onHinweis: (text) => setStatus(text, true),
});

// Erst schliessen, wenn `globe` steht: Der Schliess-Rückruf greift darauf zu,
// und eine `const` vor ihrer Auswertung anzufassen wirft.
panel.close();

const filterBar = createFilterBar({
  container: els.filters,
  categories: CATEGORIES,
  selected: filters.categories,
  onChange: (sel) => {
    filters.categories = sel;
    starterWahlOffen = false; // ab jetzt entscheidet die Person, nicht der Zufall
    writeCategoriesToUrl(sel);
    scheduleReload(0);
  },
});

createSettingsPanel({
  container: els.settings,
  toggle: els.settingsToggle,
  settings,
  onChange: (s) => {
    filters.connectors = s.connectors;
    filters.ownership = s.ownership;
    scheduleReload(0);
  },
});

createInfoDialog(els.info, els.infoToggle);

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
    const clusters = await fetchClusters(
      filters, globe.zoom, QUELLEN_GESAMT, TRAEGER_GESAMT, globe.bounds,
    );
    if (ticket !== inFlight) return; // veraltete Antwort verwerfen

    // Die Startrubrik lässt sich erst wählen, wenn wir wissen, was heute
    // überhaupt da ist. Gefiltert wird sie danach hier im Browser — ein zweiter
    // Gang zum Server nur fürs Aufräumen wäre verschwendet.
    let sichtbar = clusters;
    if (starterWahlOffen) {
      starterWahlOffen = false;
      const gewaehlt = zufallsRubrik(clusters);
      if (gewaehlt) {
        filters.categories.add(gewaehlt);
        filterBar.render();
        sichtbar = clusters.filter((c) => c.top_category === gewaehlt);
      }
    }

    globe.setClusters(sichtbar);
    const total = sichtbar.reduce((s, c) => s + c.n, 0);
    const quelle = hasSupabase ? "" : " · Demodaten";
    if (filters.connectors.size === 0) {
      setStatus("Alle Quellen abgewählt — nichts anzuzeigen.");
      return;
    }
    setStatus(
      sichtbar.length === 0
        ? `Keine Meldungen in diesem Zeitfenster.${quelle}`
        : `${total} Meldungen an ${sichtbar.length} Orten${quelle}`,
    );
  } catch (e) {
    if (ticket !== inFlight) return;
    setStatus(e instanceof Error ? e.message : "Daten konnten nicht geladen werden.", true);
  }
}

async function openCluster(c: Cluster) {
  panel.open(c.location_name);
  // Radius passend zur Zoomstufe VOR dem Heranfliegen bestimmen: Der Pin steht
  // im Schwerpunkt seiner Rasterzelle, die Meldungen liegen verstreut darin.
  const radius = radiusForZoom(globe.zoom);
  globe.flyTo(c.lat, c.lon, 0.9);
  try {
    // Gilt der Klick einem Ereignis, wird genau dessen Berichterstattung
    // geladen — nicht alles im Umkreis. Sonst stünden die Nachbarereignisse
    // wieder mit im Panel, und die Trennung wäre nur auf der Karte sichtbar.
    const articles = c.event_id
      ? await fetchArticlesOfEvent(c.event_id)
      : await fetchArticlesAt(c.lat, c.lon, filters, radius);
    panel.render(articles, settings.language);
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

/**
 * Zieht eine Rubrik, die heute tatsächlich etwas zu zeigen hat.
 *
 * Gezählt werden Orte, nicht Meldungen: Eine Rubrik mit acht Pins über die Welt
 * verteilt ergibt eine lebendigere Startansicht als eine mit fünfzig Meldungen
 * an einem einzigen Ort. Rubriken unterhalb der Mindestzahl bleiben aussen vor —
 * ein leerer Globus als erster Eindruck wäre das schlechteste Ergebnis.
 */
function zufallsRubrik(clusters: Cluster[]): CategoryId | null {
  const MINDEST_ORTE = 3;

  const orteJeRubrik = new Map<CategoryId, number>();
  for (const c of clusters) {
    // „Übriges" ist keine Aussage und steht auch nicht in der Rubrikenleiste.
    if (c.top_category === "other") continue;
    orteJeRubrik.set(c.top_category, (orteJeRubrik.get(c.top_category) ?? 0) + 1);
  }

  let kandidaten = [...orteJeRubrik].filter(([, n]) => n >= MINDEST_ORTE).map(([id]) => id);
  // Bei dünner Datenlage lieber eine schwach besetzte Rubrik als gar keine.
  if (kandidaten.length === 0) kandidaten = [...orteJeRubrik.keys()];
  if (kandidaten.length === 0) return null;

  return kandidaten[Math.floor(Math.random() * kandidaten.length)];
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
