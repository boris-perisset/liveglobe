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

/**
 * Ab dieser Pin-Zahl wechseln wir von DOM-Markern auf eine GPU-Ebene.
 * DOM-Marker sind bequem (echtes HTML, CSS, Fokus), skalieren aber nicht:
 * Jeder kostet ein Element, das bei jeder Kamerabewegung neu positioniert wird.
 */
const MARKER_LIMIT = 400;

const PUNKT_QUELLE = "meldungen";
const PUNKT_EBENE = "meldungen-punkte";
const SCHEIN_EBENE = "meldungen-schein";
const AUSWAHL_EBENE = "meldungen-auswahl";

const BUBBLE_MIN = 11;

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
 * Womit eine Bubble ihre Grösse bemisst.
 *
 * Rasterzellen zählen Meldungen — das ist dort das einzig Vorhandene. Ein
 * Ereignis zählt besser die **Medien**: Ob drei Häuser oder eines darüber
 * berichten, ist die Aussage dieses Projekts; ob ein Haus drei Fassungen
 * publiziert hat, ist es nicht.
 */
export function bubbleMenge(c: Cluster): number {
  return c.event_id ? Math.max(c.outlets ?? 1, 1) : c.n;
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
 * Ereignisse am selben Ort auffächern.
 *
 * GDELT verortet Meldungen auf Städte. Drei Ereignisse in Zürich bekommen
 * deshalb **exakt** dieselben Koordinaten und lägen ohne Zutun perfekt
 * übereinander — sichtbar wäre nur das oberste.
 *
 * Sie werden auf einen kleinen Ring gesetzt, dessen Halbmesser sich aus der
 * Sehnenlänge ergibt: `d / (2·sin(π/k))` ist genau der Abstand, bei dem sich
 * k Kreise vom Durchmesser d berühren. Ein paar Pixel Luft dazu, und sie
 * hängen beieinander, ohne sich zu verdecken.
 *
 * Der Anfangswinkel kommt aus der kleinsten Ereignis-Kennung der Gruppe, die
 * Reihenfolge ebenfalls. Damit steht die Anordnung bei jedem Aufruf gleich —
 * ein Ereignis, das gestern rechts sass, sitzt heute nicht links.
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
    const k = sortiert.length;
    const d = Math.max(...sortiert.map(groesse));
    const ring = Math.min(70, (d + FAECHER_LUFT) / (2 * Math.sin(Math.PI / k)));
    const basis = ((sortiert[0].event_id ?? sortiert[0].top_id) % 360) * Math.PI / 180;

    sortiert.forEach((c, i) => {
      const w = basis + (2 * Math.PI * i) / k;
      versatz.set(c, [Math.cos(w) * ring, Math.sin(w) * ring]);
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
      this.opts.onHinweis?.(
        "Basiskarte nicht erreichbar — Pins stehen, Länder fehlen.",
      );
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
        this.map.setCenter([c.lng + 2.5 * dt, c.lat]);
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

  private auswahlAnwenden() {
    const map = this.map;
    const aktiv = this.auswahl >= 0;

    this.opts.container.classList.toggle("hat-auswahl", aktiv);

    // HTML-Bubbles: Klasse setzen, das Dimmen macht das Stylesheet.
    this.marker.forEach((m, i) => {
      m.getElement().classList.toggle("ist-gewaehlt", i === this.auswahl);
    });

    // GPU-Ebene: Deckkraft senken, Auswahl-Ebene auf den gewählten Index filtern.
    if (map?.getLayer(PUNKT_EBENE)) {
      map.setPaintProperty(PUNKT_EBENE, "circle-opacity", aktiv ? 0.3 : 1);
      map.setPaintProperty(SCHEIN_EBENE, "circle-opacity", aktiv ? 0.12 : 0.4);
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
    const versatz = faecher(this.clusters, (c) => bubbleGroesse(bubbleMenge(c), z));

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

    const el = document.createElement("button");
    el.className = "bubble";
    el.type = "button";
    el.style.setProperty("--bubble-color", this.colorFor(c.top_category));
    el.style.setProperty("--bubble-size", `${groesse}px`);
    el.setAttribute(
      "aria-label",
      `${c.n} ${c.n === 1 ? "Meldung" : "Meldungen"} – ${c.location_name}`,
    );
    el.title = c.location_name;

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

  // ---------------------------------------------------------------- Kamera
  /**
   * Zoomstufe für die Datenabfrage.
   *
   * Die Cluster-Funktion in der Datenbank rechnet mit 0–8 und leitet daraus die
   * Rasterweite ab. MapLibres Zoom passt dazu unmittelbar; wir kappen nur oben,
   * damit die Rasterzellen nicht kleiner werden als sinnvoll.
   */
  get zoom(): number {
    return Math.max(0, Math.min(8, this.map?.getZoom() ?? 1.4));
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

  flyTo(lat: number, lon: number, _altitude = 0.8) {
    this.drehenPausieren();
    this.map?.flyTo({ center: [lon, lat], zoom: Math.max(this.map.getZoom(), 5), duration: 900 });
  }

  resize() {
    this.map?.resize();
  }
}
