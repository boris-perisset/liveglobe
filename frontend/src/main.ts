import "./styles.css";
import { t, tn, uebersetzeMarkup } from "./i18n";
import categoryMap from "../../data/category-map.json";
import type { CategoryDef, CategoryId, Cluster, Filters } from "./types";
import {
  fetchArticle,
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

// Die Beschriftungen im Markup stehen auf Englisch; hier werden sie auf die
// eingestellte Sprache gebracht, bevor irgendetwas gezeichnet wird.
uebersetzeMarkup();

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

/**
 * Die Karte kennt nur einen Gegenstand: das Ereignis.
 *
 * Es gab einmal einen zweiten Zustand — „dieser Ort ist aufgeklappt" —, in dem
 * die Karte statt der Umgebung nur noch die Ereignisse eines Ortes zeigte. Das
 * war ein Modus, und Modi muss man erklären: Beim Schliessen des Panels kam die
 * Umgebung nicht zurück, und man sah nur noch, was man selbst angeklickt hatte.
 *
 * Jetzt macht die Datenbank die Unterscheidung von sich aus: Solange eine
 * Rasterzelle mehrere Orte umfasst, ist sie eine Bubble; sobald nur noch einer
 * darin liegt, zerfällt sie in ihre Ereignisse. Zoomen ist dadurch wieder das
 * Einzige, was die Auflösung ändert — und im Frontend bleibt kein Zustand übrig,
 * der aus dem Tritt geraten könnte.
 */

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
  setStatus(t("status.loading"));
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
    const quelle = hasSupabase ? "" : ` · ${t("status.demo")}`;
    if (filters.connectors.size === 0) {
      setStatus(t("status.noSources"));
      return;
    }
    // Gezählt werden Meldungen und Ereignisse — nicht Punkte. Eine Bubble kann
    // mehrere Ereignisse enthalten; „an 40 Punkten" wäre eine Aussage über die
    // Darstellung, nicht über die Welt.
    const ereignisse = sichtbar.reduce((s, c) => s + (c.ereignisse ?? 1), 0);
    setStatus(
      sichtbar.length === 0
        ? `${t("status.empty")}${quelle}`
        : t("status.summary", {
          reports: tn("count.report", "count.reports", total),
          events: tn("count.event", "count.events", ereignisse),
        }) + quelle,
    );
  } catch (e) {
    if (ticket !== inFlight) return;
    setStatus(e instanceof Error ? e.message : t("status.error"), true);
  }
}

/**
 * Ein Klick, zwei Bedeutungen — mehr braucht es nicht.
 *
 *   mehrere Ereignisse → näher heran. Die Gruppe zerfällt beim Hineinzoomen von
 *                        selbst; ein Panel mit fünf Ereignissen wäre eine Liste,
 *                        und Listen kann die Karte nicht besser als eine Liste.
 *   ein Ereignis       → Panel mit dessen Meldungen.
 *
 * Kein Moduswechsel dazwischen. Was ein Klick tut, steht in der Bubble selbst.
 */
async function openCluster(c: Cluster) {
  if ((c.ereignisse ?? 1) > 1) {
    globe.naeherAn(c.lat, c.lon);
    return;
  }

  panel.open(c.location_name);
  // Radius passend zur Zoomstufe VOR dem Heranfliegen bestimmen: Der Pin steht
  // im Schwerpunkt seiner Rasterzelle, die Meldungen liegen verstreut darin.
  const radius = radiusForZoom(globe.zoom);
  // Zentrieren, nicht heranzoomen: Beim Ereignis ist das Panel das Ziel. Ein
  // Zoomsprung würde die Umgebung neu gruppieren, während man liest.
  globe.zentrieren(c.lat, c.lon);
  try {
    // Genau die Berichterstattung dieses Ereignisses — nicht alles im Umkreis.
    // Der letzte Zweig gilt einem alten Snapshot ohne Ereignisangaben: lieber
    // die Nachbarschaft im Panel als ein Klick, der nichts tut.
    const articles = c.event_id
      ? await fetchArticlesOfEvent(c.event_id)
      : c.article_id
      ? await fetchArticle(c.article_id)
      : await fetchArticlesAt(c.lat, c.lon, filters, radius);
    // Zielsprache ist die Oberflächensprache – aber nur, wenn Übersetzen
    // überhaupt eingeschaltet ist.
    panel.render(articles, settings.translateHeadlines ? settings.uiLang : "off");
  } catch (e) {
    panel.showError(
      e instanceof Error ? `${t("panel.error")}: ${e.message}` : t("panel.error"),
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
 * Gezählt werden Punkte, nicht Meldungen: Eine Rubrik mit acht Pins über die
 * Welt verteilt ergibt eine lebendigere Startansicht als eine mit fünfzig
 * Meldungen an einem Ort. Rubriken unterhalb der Mindestzahl bleiben aussen vor —
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
