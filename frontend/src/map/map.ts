// maplibre-gl 6 liefert kein Default-Export mehr – alles kommt benannt.
import {
  AttributionControl,
  type GeoJSONSource,
  MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import type { CategoryDef, CategoryId, Cluster } from "../types";
import { istNotfall, ladeStil } from "./style";
import { t, tn } from "../i18n";

/**
 * Ab dieser Pin-Zahl wechseln wir von DOM-Markern auf eine GPU-Ebene.
 * DOM-Marker sind bequem (echtes HTML, CSS, Fokus), skalieren aber nicht:
 * Jeder kostet ein Element, das bei jeder Kamerabewegung neu positioniert wird.
 */
const MARKER_LIMIT = 400;

const PUNKT_QUELLE = "meldungen";
const PUNKT_EBENE = "meldungen-punkte";
const SCHEIN_EBENE = "meldungen-schein";
const GRUPPE_EBENE = "meldungen-gruppe";
const AUSWAHL_EBENE = "meldungen-auswahl";

const BUBBLE_MIN = 11;

/** Eigendrehung im Normalbetrieb, Grad je Sekunde. */
const DREHUNG_NORMAL = 2.5;
/** Eigendrehung während eines Replays — siehe `drehTempo`. */
const DREHUNG_REPLAY = 0.8;

/**
 * Obergrenze und Sättigung hängen an der Zoomstufe — und das ist der Kern.
 *
 * Die Rasterzelle der Datenbank wächst mit dem Herauszoomen (`20 / 2^zoom`
 * Grad). Bei Startzoom ist sie rund 7,6° breit, also etwa ein Land, und
 * sammelt in 24 Stunden leicht mehrere hundert Meldungen ein. Eine feste
 * Sättigung bei 60 lief dort bei fast jeder Zelle ans obere Ende: lauter
 * gleich grosse Blasen, eine pro Land, ohne jede Aussage.
 *
 * Also wandern beide Werte mit. Weit draussen wird hart gestaucht — die Zahlen
 * sind gross, die Unterschiede sollen trotzdem lesbar bleiben und keine Bubble
 * darf ein Land zudecken. Beim Hineinzoomen werden die Zellen klein, die Zahlen
 * klein, und die Skala darf sich wieder öffnen.
 */
const STUFEN = {
  weit: { zoom: 2, max: 21, saettigung: 300 },
  nah:  { zoom: 6, max: 34, saettigung: 25 },
} as const;

function zwischen(zoom: number, weit: number, nah: number): number {
  const t = Math.max(0, Math.min(1, (zoom - STUFEN.weit.zoom) / (STUFEN.nah.zoom - STUFEN.weit.zoom)));
  return weit + (nah - weit) * t;
}

/**
 * Durchmesser einer Bubble in Pixeln.
 *
 * Die Wurzel statt der rohen Zahl: Ein Ort mit dreissig Meldungen soll deutlich
 * grösser wirken als einer mit einer — aber nicht dreissigmal so gross, sonst
 * verdeckt ein einziges Grossereignis den halben Kontinent.
 */
/**
 * Womit eine Bubble ihre Grösse bemisst: **immer die Zahl der Meldungen.**
 *
 * Zwischendurch war es einmal die Zahl der Medien, einmal die der Ereignisse.
 * Beides war falsch: Dieselbe Fläche bedeutete dann je nach Zoomstufe oder
 * Ebene etwas anderes. Eine Karte darf ihre eigene Masseinheit nicht wechseln.
 *
 * Reichweite und Ereigniszahl stehen im Panel, wo Platz für Worte ist.
 */
export function bubbleMenge(c: Cluster): number {
  return c.n;
}

export function bubbleGroesse(n: number, zoom: number): number {
  const max = zwischen(zoom, STUFEN.weit.max, STUFEN.nah.max);
  const saettigung = zwischen(zoom, STUFEN.weit.saettigung, STUFEN.nah.saettigung);
  const gekappt = Math.min(Math.max(n, 1), saettigung);
  const anteil = (Math.sqrt(gekappt) - 1) / (Math.sqrt(saettigung) - 1);
  return Math.round(BUBBLE_MIN + (max - BUBBLE_MIN) * anteil);
}

/** Luft zwischen zwei aufgefächerten Bubbles, in Pixeln. */
const FAECHER_LUFT = 4;

/**
 * Bis zu diesem Halbmesser bleibt es bei **einem** Ring.
 *
 * Bei drei oder acht Ereignissen ist ein Ring das Richtige und sah bisher gut
 * aus — das wird nicht angefasst. Erst wenn er darüber hinauswüchse, beginnt
 * die Spirale. Bei 11-px-Bubbles kippt es bei rund zwanzig Stück.
 */
const FAECHER_EINRING = 46;

/** Grösster Halbmesser des Fächers, in Pixeln. */
const FAECHER_MAX = 150;

/**
 * Ab hier — und erst ab hier — wird aufgefächert.
 *
 * Der Versatz ist ein **Pixelmass**. Auf Globusstufe sind 70 px mehrere
 * hundert Kilometer: Ein Ring um Kiew legt Pins nach Belarus und Polen, und
 * die Karte behauptet damit Orte, an denen nichts geschehen ist.
 *
 * Die Schwelle ist nicht gesetzt, sondern hergeleitet — dieselbe wie in
 * Migration 0020: Die Rasterweite der Datenbank ist `max(0.05, 20 / 2^zoom)`
 * Grad und läuft ab Zoom 8,64 in die untere Schranke. Ab Stufe 9 schrumpft die
 * Zelle nicht mehr, sie ist rund 5,5 km breit — Stadtmass. Genau dort sitzen
 * mehrere Ereignisse auf exakt derselben Koordinate, und nur dort ist ein Ring
 * die richtige Antwort darauf.
 *
 * Das Tor steht bewusst **zusätzlich** zu dem in der Datenbank: Der Snapshot
 * wird mit einem festen `p_zoom` vorgerechnet und dann bei Startzoom gezeigt.
 * Die beiden Stufen sind also nicht dieselbe Zahl, und der Ring muss sich nach
 * der richten, bei der wirklich hingesehen wird.
 */
const ORTSSTUFE_ZOOM = 9;

/**
 * Wie viele Bubbles auf welchen Ring passen.
 *
 * Ein **einzelner** Ring trägt nur eine Handvoll. Sein Halbmesser wächst mit
 * der Zahl (`d / (2·sin(π/k))`), und mit einem Deckel dagegen fangen die
 * Bubbles ab etwa einem Dutzend an, sich zu überdecken. Über Deir al-Balah
 * liegen 86 Ereignisse auf derselben Koordinate — als ein Ring wäre das ein
 * Klumpen, in dem man nichts anwählen kann.
 *
 * Deshalb konzentrische Ringe. Der Abstand zwischen zwei Ringen ist ein
 * Bubble-Durchmesser plus Luft, und auf einen Ring vom Halbmesser r passen
 * `2πr / schritt` Stück. Die Fläche wächst quadratisch mit dem Halbmesser,
 * die Zahl also auch: 86 Bubbles zu je 11 px stehen nach fünf Ringen und
 * 75 px Halbmesser — eine Blüte, keine Wolke.
 */
function ringplan(k: number, schritt: number): { r: number; n: number }[] {
  // `schritt / (2·sin(π/k))` ist genau der Halbmesser, bei dem sich k Kreise
  // vom Durchmesser `schritt` berühren. Solange der klein bleibt, ist ein Ring
  // die knappste und ruhigste Anordnung — und genau die, die hier bisher
  // stand. Die Spirale ist die Antwort auf ein Mengenproblem, nicht auf ein
  // Gestaltungsproblem, und soll deshalb nicht früher kommen als nötig.
  const einRing = schritt / (2 * Math.sin(Math.PI / k));
  if (einRing <= FAECHER_EINRING) return [{ r: einRing, n: k }];

  const plan: { r: number; n: number }[] = [];
  let uebrig = k;
  let i = 1;
  while (uebrig > 0) {
    // Deckel gegen den pathologischen Fall. Wird er erreicht, drängen sich die
    // restlichen auf dem äussersten Ring — überlappend, aber im Bild. Ein
    // Fächer, der über den Bildschirm hinauswächst, hilft niemandem.
    const r = Math.min(FAECHER_MAX, i * schritt);
    const platz = Math.max(1, Math.floor((2 * Math.PI * r) / schritt));
    const n = Math.min(uebrig, platz);
    plan.push({ r, n });
    uebrig -= n;
    i++;
    if (r >= FAECHER_MAX && uebrig > 0) {
      plan.push({ r, n: uebrig });
      break;
    }
  }
  return plan;
}

/**
 * Ereignisse am selben Ort auffächern.
 *
 * GDELT verortet Meldungen auf Städte. Drei Ereignisse in Zürich bekommen
 * deshalb **exakt** dieselben Koordinaten und lägen ohne Zutun perfekt
 * übereinander — sichtbar wäre nur das oberste.
 *
 * Der Anfangswinkel kommt aus der kleinsten Ereignis-Kennung der Gruppe, die
 * Reihenfolge ebenfalls. Damit steht die Anordnung bei jedem Aufruf gleich —
 * ein Ereignis, das gestern rechts sass, sitzt heute nicht links.
 *
 * Jeder Ring bekommt zusätzlich einen halben Schritt Drehung gegen den
 * vorigen: Sonst stehen die Bubbles in Speichen, und Speichen liest man als
 * Struktur, wo keine ist.
 */
function faecher(
  clusters: Cluster[],
  groesse: (c: Cluster) => number,
): Map<Cluster, [number, number]> {
  const gruppen = new Map<string, Cluster[]>();
  for (const c of clusters) {
    const key = `${c.lat.toFixed(3)}|${c.lon.toFixed(3)}`;
    const liste = gruppen.get(key);
    if (liste) liste.push(c);
    else gruppen.set(key, [c]);
  }

  const versatz = new Map<Cluster, [number, number]>();
  for (const gruppe of gruppen.values()) {
    if (gruppe.length < 2) continue;
    const sortiert = [...gruppe].sort((a, b) => (a.event_id ?? a.top_id) - (b.event_id ?? b.top_id));
    const d = Math.max(...sortiert.map(groesse));
    const schritt = d + FAECHER_LUFT;
    const basis = ((sortiert[0].event_id ?? sortiert[0].top_id) % 360) * Math.PI / 180;

    let i = 0;
    ringplan(sortiert.length, schritt).forEach(({ r, n }, ring) => {
      for (let j = 0; j < n; j++, i++) {
        const w = basis + (ring % 2) * Math.PI / n + (2 * Math.PI * j) / n;
        versatz.set(sortiert[i], [Math.cos(w) * r, Math.sin(w) * r]);
      }
    });
  }
  return versatz;
}

export interface MapOptions {
  container: HTMLElement;
  categories: CategoryDef[];
  onPinClick: (cluster: Cluster) => void;
  onZoomChange: (zoom: number) => void;
  /** Meldet Kartenprobleme nach aussen, damit sie nicht nur in der Konsole stehen. */
  onHinweis?: (text: string) => void;
}

export class NewsMap {
  private map: MapLibreMap | null = null;
  /** Läuft gerade ein Replay? Dann tritt die ganze Karte zurück. */
  private imReplay = false;
  private colorByCategory: Map<CategoryId, string>;
  private onPinClick: (c: Cluster) => void;
  private onZoomChange: (z: number) => void;

  private clusters: Cluster[] = [];
  private marker: Marker[] = [];
  private bereit = false;
  /** Index des angeklickten Ereignisses in `clusters`, oder -1. */
  private auswahl = -1;
  private schleier: HTMLElement | null = null;
  private drehen = true;
  /**
   * Drehgeschwindigkeit in Grad je Sekunde.
   *
   * Während eines Replays langsamer: Dort steht die Kamera schräg auf die
   * Bogenebene, und jede Drehung schiebt das Ereignis aus dieser Stellung
   * heraus. Bei 0,8°/s sind es über einen ganzen Lauf rund 14° — sichtbar
   * genug, dass die Kugel lebt, klein genug, dass die Schlaufen bleiben.
   */
  private drehTempo = DREHUNG_NORMAL;
  private drehTimer: number | undefined;

  constructor(private opts: MapOptions) {
    this.onPinClick = opts.onPinClick;
    this.onZoomChange = opts.onZoomChange;
    this.colorByCategory = new Map(
      opts.categories.map((c) => [c.id, c.color] as [CategoryId, string]),
    );
    void this.starten();
  }

  private async starten() {
    const style = await ladeStil();

    const map = new MapLibreMap({
      container: this.opts.container,
      style,
      center: [10, 25],
      zoom: 1.4,
      minZoom: 0.6,
      maxZoom: 14,
      attributionControl: false,
      // Der Globus lebt von der Aufsicht; Neigen würde nur verwirren.
      pitchWithRotate: false,
      dragRotate: false,
    });
    this.map = map;

    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · ' +
          "© OpenMapTiles · Daten © OpenStreetMap-Mitwirkende · " +
          'Meldungen: <a href="https://www.gdeltproject.org/" target="_blank" rel="noopener">The GDELT Project</a>',
      }),
      "bottom-right",
    );
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "bottom-right",
    );

    if (istNotfall()) {
      this.opts.onHinweis?.(t("status.mapFallback"));
    }

    // Kachel- und Stilfehler landen sonst stumm in der Konsole.
    map.on("error", (e) => {
      const grund = e.error?.message ?? "unbekannt";
      console.warn("MapLibre:", grund);
    });

    map.on("load", () => {
      this.bereit = true;
      this.schleierAnlegen();
      this.punktEbeneAnlegen();
      this.zeichnen();
    });

    // Klick ins Leere hebt die Auswahl auf.
    //
    // Bei den HTML-Bubbles genügt `stopPropagation` am Element. Auf der
    // GPU-Ebene gibt es kein Element: Dort feuert MapLibre den ebenenbezogenen
    // *und* den allgemeinen Handler für denselben Klick — der allgemeine würde
    // die eben gesetzte Auswahl sofort wieder löschen. Deshalb hier nachsehen,
    // ob unter dem Zeiger überhaupt eine Bubble liegt.
    map.on("click", (e) => {
      if (map.getLayer(PUNKT_EBENE)) {
        const treffer = map.queryRenderedFeatures(e.point, { layers: [PUNKT_EBENE] });
        if (treffer.length > 0) return;
      }
      this.setAuswahl(null);
    });

    map.on("zoomend", () => this.onZoomChange(this.zoom));
    map.on("moveend", () => this.onZoomChange(this.zoom));

    // Eigendrehung als erster Eindruck – pausiert, sobald jemand die Karte anfasst,
    // und läuft nach längerer Ruhe wieder an.
    for (const ev of ["mousedown", "touchstart", "wheel", "mousemove"] as const) {
      map.on(ev, () => this.drehenPausieren());
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.drehen = false;
    }
    this.drehschleife();
  }

  // ---------------------------------------------------------------- Drehung
  private drehenPausieren() {
    this.drehen = false;
    window.clearTimeout(this.drehTimer);
    this.drehTimer = window.setTimeout(() => {
      this.drehen = true;
    }, 20_000);
  }

  private drehschleife() {
    let zuletzt = performance.now();
    const schritt = (jetzt: number) => {
      const dt = (jetzt - zuletzt) / 1000;
      zuletzt = jetzt;
      // Nur weit draussen drehen – beim Hineinzoomen wäre es störend.
      if (this.drehen && this.map && this.map.getZoom() < 2.5) {
        const c = this.map.getCenter();
        this.map.setCenter([c.lng + this.drehTempo * dt, c.lat]);
      }
      requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
  }

  // ---------------------------------------------------------------- Pins
  private punktEbeneAnlegen() {
    const map = this.map!;
    if (map.getSource(PUNKT_QUELLE)) return;

    map.addSource(PUNKT_QUELLE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Der Schein liegt als eigene, weichgezeichnete Ebene unter den Bubbles.
    // Ein Kreis kann nicht gleichzeitig scharf und verlaufend sein, deshalb zwei.
    map.addLayer({
      id: SCHEIN_EBENE,
      type: "circle",
      source: PUNKT_QUELLE,
      paint: {
        "circle-color": ["get", "farbe"],
        "circle-radius": ["*", ["get", "r"], 2.1],
        "circle-blur": 1,
        "circle-opacity": 0.4,
      },
    });
    /**
     * Der Ring sagt, was ein Klick tut.
     *
     * Bisher sah eine Bubble mit acht Meldungen **eines** Ereignisses genauso
     * aus wie eine mit acht **verschiedenen**. Die erste öffnet das Panel, die
     * zweite zoomt näher heran — und welche von beiden man vor sich hat, sah
     * man ihr nicht an. Ein Klick, dessen Wirkung man erst nach dem Klicken
     * kennt, ist ein Ratespiel.
     *
     * Ein zweiter, dünner Ring drei Pixel ausserhalb der Bubble heisst: **hier
     * liegt mehr darunter.** Keine Beschriftung, kein Symbol, kein zweiter
     * Zustand im Frontend — die Antwort steht schon in `ereignisse`, sie war
     * nur nie zu sehen.
     *
     * Vor der Punktebene, damit der volle Kreis den inneren Teil des Rings
     * verdeckt und nur der Kranz stehenbleibt.
     */
    map.addLayer({
      id: GRUPPE_EBENE,
      type: "circle",
      source: PUNKT_QUELLE,
      filter: ["==", ["get", "gruppe"], true],
      paint: {
        "circle-color": "rgba(0,0,0,0)",
        "circle-opacity": 0,
        "circle-radius": ["+", ["get", "r"], 3],
        "circle-stroke-width": 1.2,
        "circle-stroke-color": ["get", "farbe"],
        "circle-stroke-opacity": 0.55,
      },
    });
    map.addLayer({
      id: PUNKT_EBENE,
      type: "circle",
      source: PUNKT_QUELLE,
      paint: {
        "circle-color": ["get", "farbe"],
        // Radius kommt fertig aus `bubbleGroesse` – dieselbe Formel wie bei den
        // HTML-Bubbles, damit der Wechsel bei 400 Orten nicht ins Auge springt.
        "circle-radius": ["get", "r"],
        // Kein Rand: Der Schein trennt die Bubble vom Untergrund.
        "circle-stroke-width": 0,
        // Deckend, wie die HTML-Bubbles auch – nichts soll durchscheinen.
        "circle-opacity": 1,
      },
    });

    // Die gewählte Bubble noch einmal obendrauf, grösser und mit stärkerem
    // Schein. Ein Filter statt einer eigenen Quelle: Die Daten liegen schon da,
    // es fehlt nur die Hervorhebung.
    map.addLayer({
      id: AUSWAHL_EBENE,
      type: "circle",
      source: PUNKT_QUELLE,
      filter: ["==", ["get", "index"], -1],
      paint: {
        "circle-color": ["get", "farbe"],
        "circle-radius": ["*", ["get", "r"], 2.8],
        "circle-blur": 0.9,
        "circle-opacity": 0.75,
      },
    });

    map.on("click", PUNKT_EBENE, (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const i = Number(f.properties?.index);
      const c = this.clusters[i];
      if (!c) return;
      this.setAuswahl(c);
      this.onPinClick(c);
    });
    map.on("mouseenter", PUNKT_EBENE, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", PUNKT_EBENE, () => {
      map.getCanvas().style.cursor = "";
    });
  }

  setClusters(clusters: Cluster[]) {
    this.clusters = clusters;
    // Nach neuen Daten stimmt der alte Index nicht mehr — lieber keine Auswahl
    // als die falsche hervorgehoben.
    this.auswahl = -1;
    if (this.bereit) this.zeichnen();
    this.auswahlAnwenden();
  }

  private schleierAnlegen() {
    if (this.schleier) return;
    const el = document.createElement("div");
    el.className = "globus-schleier";
    // In den Canvas-Container, damit er die Karte verdunkelt. Die Marker landen
    // im selben Container und liegen per z-index darüber — so bleiben sie
    // sichtbar und lassen sich einzeln dimmen statt pauschal mitverdunkelt zu
    // werden.
    this.map?.getCanvasContainer().appendChild(el);
    this.schleier = el;
  }

  /**
   * Ein Ereignis hervorheben und alles andere zurücktreten lassen.
   *
   * `null` hebt die Auswahl auf. Wird vom Panel beim Schliessen aufgerufen und
   * von einem Klick auf die leere Karte.
   */
  setAuswahl(cluster: Cluster | null) {
    const neu = cluster ? this.clusters.indexOf(cluster) : -1;
    if (neu === this.auswahl) return;
    this.auswahl = neu;
    this.auswahlAnwenden();
  }

  /**
   * Während eines Replays tritt die ganze Karte zurück.
   *
   * Nicht dieselbe Stufe wie bei einer Auswahl: Dort bleiben die Nachbarn
   * lesbar, weil man sie noch anklicken können soll. Hier sollen sie nur noch
   * andeuten, dass es sie gibt — die Bögen sind dünne Linien, und gegen ein
   * Feld leuchtender Punkte verlieren sie.
   *
   * Kein eigener Zeichenweg: derselbe Durchgang wie die Auswahl, nur mit
   * anderen Werten. Beide Zustände können gleichzeitig gelten, und dann
   * gewinnt der schwächere.
   */
  replayModus(aktiv: boolean) {
    if (this.imReplay === aktiv) return;
    this.imReplay = aktiv;

    /*
     * Die Kugel dreht **während** des Replays, nicht danach.
     *
     * Vorher sah es so aus, als setzte die Drehung am Ende ein. Sie tat es
     * auch — nur nicht als Folge des Endes: `zentrieren()` beim Öffnen des
     * Panels ruft `drehenPausieren()`, und das hält 20 Sekunden an. Ein Replay
     * dauert rund 18. Die Pause lief einfach ab, und das fiel zufällig mit dem
     * Schluss zusammen.
     *
     * Beim Start wird die Pause deshalb aufgehoben und das Tempo gedrosselt.
     * Wer die Karte anfasst, pausiert weiterhin — die Zuhörer auf `mousedown`
     * und Co. bleiben unberührt, und ein Handgriff soll die Drehung anhalten,
     * ob ein Replay läuft oder nicht.
     */
    window.clearTimeout(this.drehTimer);
    this.drehTempo = aktiv ? DREHUNG_REPLAY : DREHUNG_NORMAL;
    if (aktiv && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.drehen = true;
    }

    this.auswahlAnwenden();
  }

  private auswahlAnwenden() {
    const map = this.map;
    const aktiv = this.auswahl >= 0;
    const replay = this.imReplay;

    this.opts.container.classList.toggle("hat-auswahl", aktiv);
    this.opts.container.classList.toggle("laeuft-replay", replay);

    // HTML-Bubbles: Klasse setzen, das Dimmen macht das Stylesheet.
    this.marker.forEach((m, i) => {
      m.getElement().classList.toggle("ist-gewaehlt", i === this.auswahl);
    });

    // GPU-Ebene: Deckkraft senken, Auswahl-Ebene auf den gewählten Index filtern.
    if (map?.getLayer(PUNKT_EBENE)) {
      map.setPaintProperty(PUNKT_EBENE, "circle-opacity", replay ? 0.1 : aktiv ? 0.3 : 1);
      map.setPaintProperty(SCHEIN_EBENE, "circle-opacity", replay ? 0.03 : aktiv ? 0.12 : 0.4);
      map.setPaintProperty(
        GRUPPE_EBENE, "circle-stroke-opacity", replay ? 0.05 : aktiv ? 0.16 : 0.55,
      );
      // Der starke Schein der Auswahl geht mit: Das Replay setzt seinen eigenen
      // Marker auf das Ereignis, und zwei Hervorhebungen auf einem Punkt lesen
      // sich als Fehler im Bild.
      map.setPaintProperty(AUSWAHL_EBENE, "circle-opacity", replay ? 0.12 : 0.75);
      map.setFilter(AUSWAHL_EBENE, ["==", ["get", "index"], this.auswahl]);
    }
  }

  private zeichnen() {
    const map = this.map;
    if (!map) return;

    for (const m of this.marker) m.remove();
    this.marker = [];

    const vieleMeldungen = this.clusters.length > MARKER_LIMIT;
    const z = this.zoom;
    // Oberhalb der Ortsstufe liefert die Datenbank gar keine gleichen
    // Koordinaten mehr (0020) — die leere Karte hier ist der zweite Riegel,
    // und er greift auch für den Snapshot, der mit fremdem Zoom gerechnet ist.
    // **Gerundet**, weil `api.ts` der Datenbank `Math.round(zoom)` übergibt.
    // Ungerundet gäbe es zwischen 8,5 und 9,0 ein Fenster, in dem die Zelle
    // schon zerfällt, der Fächer aber noch nicht auffächert — Ereignisse auf
    // identischer Koordinate lägen dann übereinander, sichtbar nur das
    // oberste. Beide Seiten müssen dieselbe Zahl prüfen.
    const versatz: Map<Cluster, [number, number]> =
      Math.round(z) >= ORTSSTUFE_ZOOM
        ? faecher(this.clusters, (c) => bubbleGroesse(bubbleMenge(c), z))
        : new Map();

    const quelle = map.getSource(PUNKT_QUELLE) as GeoJSONSource | undefined;
    quelle?.setData({
      type: "FeatureCollection",
      features: vieleMeldungen
        ? this.clusters.map((c, index) => ({
          type: "Feature" as const,
          // Auf der GPU-Ebene gibt es kein `offset` je Punkt. Der Versatz wandert
          // deshalb in die Koordinate: in Pixel umrechnen, verschieben,
          // zurückrechnen. Beim nächsten Zoom wird ohnehin neu gezeichnet.
          geometry: { type: "Point" as const, coordinates: this.verschoben(c, versatz.get(c)) },
          properties: {
            index,
            n: c.n,
            // Trägt den Unterschied zwischen „öffnet das Panel" und „zoomt
            // näher heran" auf die Karte. Dieselbe Bedingung wie in
            // `openCluster` — sie steht bewusst an beiden Stellen gleich.
            gruppe: (c.ereignisse ?? 1) > 1,
            r: bubbleGroesse(bubbleMenge(c), z) / 2,
            farbe: this.colorFor(c.top_category),
          },
        }))
        : [],
    });

    if (vieleMeldungen) return;

    for (const c of this.clusters) {
      this.marker.push(
        new Marker({
          element: this.makeBubble(c, z),
          // Bei DOM-Bubbles bleibt der Versatz in Pixeln — er hält sich damit
          // auch während einer Zoomfahrt, ohne dass neu gerechnet werden muss.
          offset: versatz.get(c) ?? [0, 0],
          // Ein Kreis hat keine Spitze – er sitzt mittig auf der Koordinate.
          anchor: "center",
          // Standard wäre 0.2 – Bubbles der Rückseite schimmerten dann durch die
          // Kugel und liessen sie durchscheinend wirken. Wir blenden sie ganz aus.
          opacityWhenCovered: 0,
        })
          .setLngLat([c.lon, c.lat])
          .addTo(map),
      );
    }
  }

  /** Punkt um einen Pixelversatz verschieben und als Koordinate zurückgeben. */
  private verschoben(c: Cluster, v: [number, number] | undefined): [number, number] {
    if (!v || !this.map) return [c.lon, c.lat];
    const p = this.map.project([c.lon, c.lat]);
    const l = this.map.unproject([p.x + v[0], p.y + v[1]]);
    return [l.lng, l.lat];
  }

  private makeBubble(c: Cluster, zoom: number): HTMLElement {
    const groesse = bubbleGroesse(bubbleMenge(c), zoom);

    // Dieselbe Frage wie in `openCluster`: mehrere Ereignisse heisst „näher
    // heran", eines heisst „Panel auf". Sie steht bewusst an beiden Stellen
    // wortgleich — was ein Klick tut, soll die Bubble selbst sagen.
    const gruppe = (c.ereignisse ?? 1) > 1;

    const el = document.createElement("button");
    el.className = gruppe ? "bubble bubble--gruppe" : "bubble";
    el.type = "button";
    el.style.setProperty("--bubble-color", this.colorFor(c.top_category));
    el.style.setProperty("--bubble-size", `${groesse}px`);

    const menge = tn("count.report", "count.reports", c.n);
    // Bei einer Gruppe gehört die Ereigniszahl dazu — sie ist der Grund, warum
    // der Klick hier etwas anderes tut. Bei einem Ereignis wäre „1 Ereignis"
    // eine Zeile ohne Neuigkeit.
    const wirkung = gruppe ? t("map.group", { n: c.ereignisse ?? 0 }) : t("map.single");
    el.setAttribute("aria-label", `${menge} – ${c.location_name} · ${wirkung}`);
    el.title = `${c.location_name} · ${wirkung}`;

    const kern = document.createElement("span");
    kern.className = "bubble__kern";
    // Die Zahl erst zeigen, wenn sie lesbar hineinpasst. Darunter trägt die
    // Grösse die Information allein – eine 4-Pixel-Ziffer tut das nicht.
    kern.textContent = c.n > 1 && groesse >= 16 ? String(c.n) : "";
    el.appendChild(kern);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.setAuswahl(c);
      this.onPinClick(c);
    });
    return el;
  }

  private colorFor(cat: CategoryId): string {
    return this.colorByCategory.get(cat) ?? "#7B808A";
  }

  /**
   * Die MapLibre-Karte selbst.
   *
   * Bewusst schmal und nur für Aufsätze gedacht, die auf **derselben** Kugel
   * zeichnen — das Replay projiziert seine Bögen mit `project()` und fragt die
   * Verdeckung ab. Alles, was die Karte *steuert*, geht weiterhin über die
   * Methoden dieser Klasse; sonst wandert die Kamerahoheit an drei Stellen
   * gleichzeitig, und keine weiss von den anderen.
   *
   * `null`, solange die Karte nicht steht — der Aufrufer muss das prüfen.
   */
  get karte(): MapLibreMap | null {
    return this.map;
  }

  // ---------------------------------------------------------------- Kamera
  /**
   * Zoomstufe für die Datenabfrage.
   *
   * **Hier stand einmal `Math.min(8, …)`**, aus der Zeit von
   * `articles_clustered`, das nur 0–8 kannte. Die Kappung war seither zweimal
   * überholt und einmal schädlich:
   *
   *   * Die Rasterweite begrenzt sich in der Datenbank selbst
   *     (`greatest(0.05, 20 / 2^zoom)`) — es kann gar nichts zu fein werden.
   *   * Seit Migration 0022 trägt der Wert **ab 9** eine eigene Bedeutung: Dort
   *     zerfällt eine Zelle in ihre Ereignisse. Mit dem Deckel erreichte
   *     `p_zoom` die 9 nie, und die Zelle zerfiel nie — egal wie nah man
   *     heranging. Die Migration war korrekt und wirkungslos.
   *
   * Also kein Deckel mehr. Nach oben begrenzt die Karte selbst (`maxZoom`),
   * und das ist die einzige Grenze, die es hier wirklich gibt.
   */
  get zoom(): number {
    return Math.max(0, this.map?.getZoom() ?? 1.4);
  }

  /**
   * Sichtbarer Ausschnitt, für die Ereignisabfrage.
   *
   * Auf dem Globus kann die Kugelkante im Bild liegen; MapLibre liefert dann
   * einen Ausschnitt, der die halbe Welt umspannt. Das ist richtig so — die
   * Abfrage begrenzt zusätzlich über ihre eigene Obergrenze.
   */
  get bounds(): { west: number; south: number; east: number; north: number } | undefined {
    const b = this.map?.getBounds();
    if (!b) return undefined;
    return {
      west: Math.max(-180, b.getWest()),
      south: Math.max(-90, b.getSouth()),
      east: Math.min(180, b.getEast()),
      north: Math.min(90, b.getNorth()),
    };
  }

  /**
   * Näher an eine Bubble heran — ein spürbarer Schritt, nicht nur ein Schwenk.
   *
   * Vorher stand hier `Math.max(getZoom(), 5)`. Ab Stufe 5 hiess das: dieselbe
   * Stufe, also bloss zentrieren. Ein Klick auf ein Cluster tat dann sichtbar
   * nichts — die Rasterweite blieb, die Gruppe blieb, und die Karte wirkte, als
   * reagiere sie nicht.
   *
   * Die Rasterweite halbiert sich je Zoomstufe; zwei Stufen vierteln also die
   * Zelle. Das genügt, damit eine Gruppe auseinanderfällt, und ist kurz genug,
   * dass man den Weg dorthin noch mitverfolgt.
   *
   * Bewusst ohne `essential`: Wer im System „weniger Bewegung" eingestellt hat,
   * bekommt von MapLibre einen Sprung statt einer Fahrt. Das ist richtig so —
   * die Fahrt ist Beiwerk, das Ankommen ist der Zweck.
   */
  naeherAn(lat: number, lon: number, schritt = 2) {
    const map = this.map;
    if (!map) return;
    this.drehenPausieren();
    const ziel = Math.min(map.getMaxZoom(), Math.max(map.getZoom() + schritt, 4));
    map.flyTo({ center: [lon, lat], zoom: ziel, duration: 1000 });
  }

  /**
   * Auf einen Punkt zentrieren, ohne die Auflösung zu verändern.
   *
   * Für den Klick auf ein einzelnes Ereignis: Das Panel geht auf, die Bubble
   * soll neben dem Panel sichtbar bleiben — aber die Umgebung darf sich nicht
   * neu gruppieren, sonst verschwindet unter der Hand, worauf man eben geklickt
   * hat. Nur ganz weit draussen wird ein Stück herangegangen.
   */
  zentrieren(lat: number, lon: number) {
    const map = this.map;
    if (!map) return;
    this.drehenPausieren();
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 3.5), duration: 800 });
  }

  resize() {
    this.map?.resize();
  }
}
