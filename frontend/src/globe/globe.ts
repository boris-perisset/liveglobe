import Globe, { GlobeInstance } from "globe.gl";
import type { CategoryDef, CategoryId, Cluster } from "../types";

/** Ab dieser Pin-Zahl wechseln wir von DOM-Markern auf ein GPU-Punktlayer. */
const HTML_MARKER_LIMIT = 600;

export interface GlobeOptions {
  container: HTMLElement;
  categories: CategoryDef[];
  onPinClick: (cluster: Cluster) => void;
  onZoomChange: (zoom: number) => void;
}

export class NewsGlobe {
  private globe: GlobeInstance;
  private colorByCategory: Map<CategoryId, string>;
  private onPinClick: (c: Cluster) => void;
  private lastAltitude = 2.5;

  constructor(opts: GlobeOptions) {
    this.onPinClick = opts.onPinClick;
    this.colorByCategory = new Map(
      opts.categories.map((c) => [c.id, c.color] as [CategoryId, string]),
    );

    this.globe = new Globe(opts.container)
      .backgroundColor("rgba(0,0,0,0)")
      // „earth-night" zeigt Lichter statt Landmassen: ruhig, dunkel und
      // thematisch passend – wo Menschen sind, entstehen Nachrichten.
      .globeImageUrl(`${import.meta.env.BASE_URL}textures/earth-night.jpg`)
      .bumpImageUrl(`${import.meta.env.BASE_URL}textures/earth-topology.png`)
      .showAtmosphere(true)
      .atmosphereColor("#3f6fa8")
      .atmosphereAltitude(0.16)
      .pointOfView({ lat: 25, lng: 10, altitude: 2.5 }, 0);

    const controls = this.globe.controls() as {
      autoRotate: boolean;
      autoRotateSpeed: number;
      enableDamping: boolean;
      minDistance: number;
      maxDistance: number;
      addEventListener: (t: string, fn: () => void) => void;
    };
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.enableDamping = true;

    // Autorotation ist reine Deko für den ersten Eindruck: Sie pausiert, sobald
    // der Zeiger über dem Globus ist (sonst wandern die Pins unter dem Klick weg)
    // und läuft nach längerer Ruhe wieder an.
    let idleTimer: number | undefined;
    const pause = () => {
      controls.autoRotate = false;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        controls.autoRotate = true;
      }, 20_000);
    };
    for (const ev of ["pointerdown", "pointermove", "wheel", "touchstart"]) {
      opts.container.addEventListener(ev, pause, { passive: true });
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      controls.autoRotate = false;
    }

    controls.addEventListener("change", () => {
      const alt = this.globe.pointOfView().altitude;
      if (Math.abs(alt - this.lastAltitude) > 0.05) {
        this.lastAltitude = alt;
        opts.onZoomChange(altitudeToZoom(alt));
      }
    });

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const el = this.globe.renderer().domElement.parentElement;
    if (!el) return;
    this.globe.width(el.clientWidth).height(el.clientHeight);
  }

  get zoom(): number {
    return altitudeToZoom(this.globe.pointOfView().altitude);
  }

  setClusters(clusters: Cluster[]) {
    if (clusters.length > HTML_MARKER_LIMIT) {
      this.globe.htmlElementsData([]);
      this.globe
        .pointsData(clusters)
        .pointLat((d) => (d as Cluster).lat)
        .pointLng((d) => (d as Cluster).lon)
        .pointColor((d) => this.colorFor((d as Cluster).top_category))
        .pointAltitude(0.008)
        .pointRadius((d) => 0.14 + Math.min(0.5, Math.log10((d as Cluster).n + 1) * 0.28))
        .onPointClick((d) => this.onPinClick(d as Cluster));
      return;
    }

    this.globe.pointsData([]);
    this.globe
      .htmlElementsData(clusters)
      .htmlLat((d) => (d as Cluster).lat)
      .htmlLng((d) => (d as Cluster).lon)
      .htmlAltitude(0.012)
      .htmlElement((d) => this.makePin(d as Cluster));
  }

  flyTo(lat: number, lon: number, altitude = 0.8) {
    this.globe.pointOfView({ lat, lng: lon, altitude }, 900);
  }

  private colorFor(cat: CategoryId): string {
    return this.colorByCategory.get(cat) ?? "#8a8f98";
  }

  private makePin(c: Cluster): HTMLElement {
    const el = document.createElement("button");
    el.className = "pin";
    el.type = "button";
    el.style.setProperty("--pin-color", this.colorFor(c.top_category));
    el.setAttribute(
      "aria-label",
      `${c.n} ${c.n === 1 ? "Meldung" : "Meldungen"} – ${c.location_name}`,
    );
    el.title = c.location_name;
    el.innerHTML =
      `<span class="pin__head">${c.n > 1 ? c.n : ""}</span><span class="pin__tail"></span>`;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onPinClick(c);
    });
    return el;
  }
}

/** globe.gl arbeitet mit Kamerahöhe, unsere RPC mit einer Zoomstufe 0..8. */
export function altitudeToZoom(altitude: number): number {
  const z = Math.log2(2.5 / Math.max(altitude, 0.05)) + 1;
  return Math.max(0, Math.min(8, z));
}
