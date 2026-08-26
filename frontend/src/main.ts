import "./styles.css";
import { locale, t, tn, uebersetzeMarkup } from "./i18n";
import categoryMap from "../../data/category-map.json";
import type { Arc, CategoryDef, CategoryId, Cluster, Filters, ReplayVorschlag } from "./types";
import {
  fetchArticle,
  fetchArticlesAt,
  fetchArticlesOfEvent,
  fetchClusters,
  fetchEventArcs,
  fetchTopReplays,
  hasSupabase,
  radiusForZoom,
} from "./data/api";
import { CONNECTORS, createSettingsPanel, loadSettings, OWNERSHIP } from "./ui/settings";
import { NewsMap } from "./map/map";
import { createFilterBar } from "./ui/filters";
import { createReplayBar } from "./ui/replaybar";
import { createInfoDialog } from "./ui/info";
import { createTimeSlider } from "./ui/timeslider";
import { TeaserPanel, type ReplayAnstoss } from "./ui/panel";
import { Replay } from "./map/replay";

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

/**
 * Der vierte Parameter ist der Replay-Knopf — und er wird nur gesetzt, wenn
 * Supabase konfiguriert ist.
 *
 * Das Replay hängt an `event_outlets`, und die gibt es nur live. Ohne
 * Verbindung erscheint der Knopf gar nicht erst, statt zu erscheinen und dann
 * nichts zu tun: Ein Knopf, der nichts tut, ist schlechter als kein Knopf.
 */
const panel = new TeaserPanel(
  els.panel,
  CATEGORIES,
  () => globe.setAuswahl(null),
  hasSupabase ? starteReplay : undefined,
);

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

/**
 * Die Replay-Leiste hängt sich selbst unter die Rubriken.
 *
 * Kein Eintrag in `index.html`: Die Datei wird von Hand gepflegt, und ein
 * Element, das nur zusammen mit seinem Modul einen Sinn ergibt, gehört zu
 * diesem Modul. Die Kopfzeile ist eine Spalte mit Abstand — ein weiteres Kind
 * reiht sich von selbst ein.
 */
const replayLeisteEl = document.createElement("div");
replayLeisteEl.id = "replays";
els.filters.after(replayLeisteEl);

const replayBar = createReplayBar({
  container: replayLeisteEl,
  categories: CATEGORIES,
  onWaehlen: (v) => void replayAusLeiste(v),
});

/**
 * Nur nachladen, wenn sich Rubriken oder Zeitfenster geändert haben.
 *
 * `load()` läuft bei jedem Schwenk und jeder Zoomstufe; die Leiste hängt aber
 * an keinem Kartenausschnitt. Ohne diese Merkzeile wäre jedes Verschieben der
 * Karte eine zusätzliche Abfrage, die dasselbe Ergebnis liefert.
 */
let replaySignatur = "";

async function replaysNachziehen() {
  const signatur = [...filters.categories].sort().join(",")
    + `|${filters.until.getTime()}|${filters.windowHours}`;
  if (signatur === replaySignatur) return;
  replaySignatur = signatur;
  replayBar.setzen(await fetchTopReplays(filters, 3));
}

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

const infoDialog = createInfoDialog(els.info, els.infoToggle);
// Das Beta-Etikett im Titel öffnet denselben Dialog wie das Info-Zeichen.
document.getElementById("beta-badge")
  ?.addEventListener("click", () => infoDialog.open());

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
    // Nicht abwarten: Die Karte soll nicht auf eine Nebensache warten.
    void replaysNachziehen();
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
    // Erst jetzt entscheidet sich, ob es einen Replay-Knopf gibt: `outlet_count`
    // zählt alle Medien, gezeichnet werden nur die mit Koordinate. Nachgeladen
    // **nach** dem Zeichnen — die Meldungen stehen sofort da, der Knopf kommt
    // dazu, sobald er belegt ist. Nie umgekehrt warten.
    if (c.event_id) {
      const id = c.event_id;
      void fetchEventArcs(id)
        .then((arcs) => panel.replayAnbieten(zeichenbar(arcs) >= 2 ? arcs : null))
        .catch(() => panel.replayAnbieten(null));
    }
  } catch (e) {
    panel.showError(
      e instanceof Error ? `${t("panel.error")}: ${e.message}` : t("panel.error"),
    );
  }
}

/**
 * Ein Replay läuft, oder keines.
 *
 * Zwei gleichzeitig wären zwei Kameras auf einer Karte — das vorige wird
 * deshalb beendet, bevor das nächste anläuft.
 */
let replay: Replay | null = null;

/**
 * Wie viele dieser Bögen lassen sich überhaupt zeichnen?
 *
 * `event_arcs` liefert seit 0026 **alle** Medien eines Ereignisses, auch die
 * ohne bekannten Sitz — sie zählen mit, werden aber nicht gemalt. Ob sich ein
 * Replay lohnt, entscheidet die zeichenbare Zahl, nicht die Gesamtzahl.
 */
function zeichenbar(arcs: Arc[]): number {
  return arcs.filter((a) => typeof a.lat === "number" && typeof a.lon === "number").length;
}

async function starteReplay(anstoss: ReplayAnstoss) {
  const karte = globe.karte;
  if (!karte) return;
  replay?.beenden();
  replay = null;
  globe.replayModus(false);

  try {
    // Kommt der Anstoss aus dem Panel, sind die Bögen schon da — der Knopf
    // erscheint erst, wenn sie geladen und tragfähig sind. Aus der Leiste
    // dagegen wird jetzt geholt; dort ist nur die Zahl bekannt.
    let arcs = anstoss.arcs;
    if (arcs.length === 0) {
      setStatus(t("replay.loading"));
      arcs = await fetchEventArcs(anstoss.eventId);
    }
    // Letzter Riegel — gezählt werden die **zeichenbaren** Bögen. Ein Ereignis
    // mit neun Medien, von denen sieben keinen bekannten Sitz haben, ergibt
    // keine Verbreitung, sondern einen Strich.
    if (zeichenbar(arcs) < 2) {
      setStatus(t("replay.none"), true);
      return;
    }
    setStatus("");
    // Das Panel bleibt offen: Wer beim Zusehen wissen will, was da eigentlich
    // steht, soll es nicht erst wieder aufklappen müssen.
    replay = new Replay({
      map: karte,
      buehne: els.globe,
      farbe: anstoss.farbe,
      locale: locale(),
      texte: {
        aria: t("replay.aria"),
        medien: t("replay.outlets"),
        laender: t("replay.countries"),
        sprachen: t("replay.languages"),
        regionen: t("replay.regions"),
        abspielen: t("replay.play"),
        pause: t("replay.pause"),
        nochmal: t("replay.again"),
        schliessen: t("replay.close"),
        ohneSitz: (n: number) => t("replay.noSeat", { n }),
        weitere: (n: number) => t("panel.andMore", { n }),
        ortsguete: (land: number, region: number) =>
          [
            land > 0 ? t("replay.geoLand", { n: land }) : "",
            region > 0 ? t("replay.geoRegion", { n: region }) : "",
          ].filter(Boolean).join(" "),
      },
      onEnde: () => {
        replay = null;
        globe.replayModus(false);
      },
    });
    globe.replayModus(true);
    replay.start(
      {
        id: anstoss.eventId,
        lat: anstoss.lat,
        lon: anstoss.lon,
        titel: anstoss.titel,
        ort: anstoss.ort,
      },
      arcs,
    );
  } catch (e) {
    setStatus(e instanceof Error ? `${t("panel.error")}: ${e.message}` : t("panel.error"), true);
  }
}

/**
 * Ein Replay aus der Leiste.
 *
 * Panel und Replay gehen gemeinsam auf: Wer beim Zusehen wissen will, was da
 * eigentlich steht, soll es nicht erst suchen müssen. Nicht zentriert wird
 * bewusst — das Replay setzt seine Kamera selbst, und zwei Kamerafahrten
 * übereinander sähen aus wie ein Fehler.
 */
async function replayAusLeiste(v: ReplayVorschlag) {
  const ort = v.location_name ?? v.title;
  panel.open(ort);
  const farbe = CATEGORIES.find((c) => c.id === v.category)?.color ?? "#8a8f98";
  void starteReplay({
    eventId: v.event_id,
    arcs: [],
    lat: v.lat,
    lon: v.lon,
    titel: v.title,
    ort,
    farbe,
  });
  try {
    const articles = await fetchArticlesOfEvent(v.event_id);
    panel.render(articles, settings.translateHeadlines ? settings.uiLang : "off");
    panel.replayAnbieten(null); // Es läuft bereits — ein zweiter Knopf wäre Lärm.
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
/**
 * Geteilte Links von vor der IPTC-Umstellung.
 *
 * `?cat=peace_talks` war ein gültiger Link, den jemand jemandem geschickt hat.
 * Ihn stillschweigend zu verwerfen hiesse: Die Seite öffnet sich mit einer
 * zufälligen Rubrik, und niemand erfährt, dass er die falsche Welt ansieht.
 * Ein paar Zeilen Tabelle sind billiger als ein Link, der lügt.
 */
const RUBRIK_UMZUG: Record<string, CategoryId> = {
  natural_disasters: "disaster_accident",
  accidents: "disaster_accident",
  conflicts: "conflict_war_peace",
  peace_talks: "conflict_war_peace",
  diplomacy: "politics",
  nature: "environment",
  sports: "sport",
  culture: "arts_culture",
  art: "arts_culture",
};

function readCategoriesFromUrl(): Set<CategoryId> {
  const raw = new URLSearchParams(location.search).get("cat");
  const valid = new Set(CATEGORIES.map((c) => c.id));
  const set = new Set<CategoryId>();
  if (!raw) return set;
  for (const part of raw.split(",")) {
    const roh = part.trim();
    const id = (RUBRIK_UMZUG[roh] ?? roh) as CategoryId;
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
