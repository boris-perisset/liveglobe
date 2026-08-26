import { LngLat } from "maplibre-gl";
import type { Map as MapLibreMap, Point } from "maplibre-gl";
import type { Arc } from "../types";
import { weltregion } from "../data/weltregionen";

/**
 * Replay — wie sich eine Meldung über die Welt bewegt.
 *
 * Ein statischer Fächer von zwölf Bögen sagt „zwölf Medien". Das Replay sagt,
 * ob die zwölf in zwanzig Minuten kamen oder über zwei Tage tröpfelten — und
 * das ist die Frage nach Diffusion, um die es dem ganzen Werkzeug geht
 * (`EREIGNISMODELL.md` §4).
 *
 * Gezeichnet wird auf eine Leinwand **über** dem bestehenden Globus, nicht in
 * einem zweiten 3D-Globus. Das hat drei Folgen, alle erwünscht:
 *
 *   * Es gibt keine zweite Kamera. Die Lehre „die Kamera muss mitgehen"
 *     erledigt `easeTo` auf der vorhandenen Karte, und wer während des
 *     Abspielens dreht, dreht die Bögen mit — sie werden jeden Rahmen neu
 *     projiziert.
 *   * Es gibt keinen Bruch. Man bleibt auf der Karte, die man eben noch vor
 *     sich hatte.
 *   * Es kostet keine neue Abhängigkeit.
 *
 * ---------------------------------------------------------------------------
 * Zeitliche Ehrlichkeit — die Regel, an der alles hängt
 * ---------------------------------------------------------------------------
 *
 * Der Bogen **landet** auf dem Veröffentlichungszeitpunkt, er startet nicht
 * dort. Die erste Fassung des Durchstichs machte es umgekehrt, und dann nannte
 * das Etikett 17:32, während die Uhr unten auf 18:36 stand. Bei einem
 * Werkzeug, dessen Kernaussage aus Zeitpunkten besteht, ist das nicht tragbar.
 *
 * Deshalb läuft jeder Bogen `ANLAUF` **vor** seiner Veröffentlichung an und
 * kommt exakt auf ihr an. Uhr, Etikett und Zähler sagen dieselbe Zeit. Am
 * Anfang wird der Anlauf gekappt, damit bei null kein Bogen halb gezeichnet in
 * der Luft hängt.
 */

// ---------------------------------------------------------------- Stellwerte

/** Wiedergabedauer für die gesamte Zeitspanne des Ereignisses. */
const DAUER_MS = 16_000;

/**
 * Wie lange ein Bogen anläuft, als Anteil der Zeitachse.
 *
 * Bewusst ein *Anteil* und keine feste Millisekundenzahl: Bei einem Ereignis
 * über zwei Tage sollen die Bögen genauso zügig einfliegen wie bei einem über
 * zwanzig Minuten. Was sich dehnt, ist der Abstand zwischen ihnen — und genau
 * der ist die Aussage.
 */
const ANLAUF = 0.055;

/** Standbild am Ende, bevor der Knopf auf „Nochmal" springt. */
const NACHLAUF_MS = 1_800;

/**
 * Bogenhöhe bei halbem Erdumfang, als Anteil des Erdradius.
 *
 * Die Höhe wächst mit der **Wurzel** der Distanz, nicht linear: Sonst sind
 * kurze Bögen unsichtbar flach und nur die interkontinentalen zu sehen.
 *
 * Ein echter Anteil, kein Pixelmass — der Bogen ist ein Weg im Raum über der
 * Kugel, und wie hoch er auf dem Bildschirm erscheint, entscheidet die
 * Projektion, nicht wir.
 */
const HOEHE = 0.42;

/** Obergrenze, damit auch ein Bogen um die halbe Welt im Bild bleibt. */
const HOEHE_MAX = 0.55;

/**
 * Zusatzhöhe je Index für Bögen mit gleichem Ziel, als Anteil des Erdradius.
 *
 * Reuters und der Guardian sitzen beide in London: gleiche Sehne, gleiche
 * Wölbung, exakt deckungsgleich. Sie werden deshalb **ineinander geschachtelt**
 * statt seitlich verschoben — die Sehne ist ja dieselbe, seitlich gäbe es
 * nichts zu verschieben. Streng additiv, nie negativ: Ein Bogen, dessen
 * Zusatzhöhe seine Grundhöhe überschritte, klappte auf die andere Seite.
 */
const SPREIZUNG = 0.022;

/**
 * Untergrenze für die Weite, die in die Höhe eingeht — in Radiant, rund 3°.
 *
 * Der häufigste Fall überhaupt: Ein Lokalmedium berichtet über sein eigenes
 * Ereignis, Redaktion und Ort fallen zusammen, die Weite ist null. Ohne diesen
 * Boden wäre die Höhe ebenfalls null, der Bogen ein Punkt unter dem
 * Ereignismarker — unsichtbar, und sein Etikett zeigte auf das Ereignis statt
 * auf die Redaktion.
 *
 * Mit dem Boden wird daraus ein kleiner Hüpfer an Ort und Stelle. Das ist
 * keine erfundene Entfernung: Die Aussage „dieses Medium sitzt dort, wo es
 * passiert ist" wird damit erst sichtbar, statt zu verschwinden.
 *
 * Nachgemessen bei 1°: Der Scheitel lag 9 px über der Sehne und sah flach aus.
 * Bei 3° sind es rund 15 px. Die Wurzelkennlinie macht den Unterschied gerade
 * unten gross — genau dort, wo er gebraucht wird.
 */
const WEITE_MIN = 0.05;

/** Höchstzahl Namen im Titel der Zeile „ohne bekannten Sitz". */
const NAMEN_MAX = 12;

/** Höchstzahl gleichzeitig sichtbarer Etiketten. */
const ETIKETTEN = 9;

/** Deckkraft der Abschnitte, die hinter der Kugel liegen. */
const VERDECKT = 0.13;

const GRAD = Math.PI / 180;

/**
 * Mindestwinkel, um den die Kamera aus der Bogenebene kippt.
 *
 * **Die eine Zahl, an der man hier dreht.** Seit die Bögen richtig projiziert
 * werden (Streckung von der Kugelmitte weg), sind sie echte Wege im Raum — und
 * ein Weg, auf den man senkrecht von oben blickt, ist eine Linie. Erst der
 * Blick von der Seite macht die Schlaufe sichtbar.
 *
 * Wie viel man sieht, ist der Sinus dieses Winkels: bei 26° rund 44 % der
 * vollen Wölbung, bei 45° rund 71 %. Grösser wäre eindrücklicher, zwingt aber
 * den Zoom zurück — die Kamera muss Ereignis *und* Redaktionen fassen, und der
 * Kippwinkel geht voll in diese Weite ein. 26° ist der Handel: Globusansicht
 * bei einer engen Szene, Schlaufen deutlich sichtbar.
 */
const KIPPUNG_MIN = 26 * GRAD;

// ---------------------------------------------------------------- Kugelmathe

type Vektor = [number, number, number];

function alsVektor(lat: number, lon: number): Vektor {
  const phi = lat * GRAD;
  const lam = lon * GRAD;
  const c = Math.cos(phi);
  return [c * Math.cos(lam), c * Math.sin(lam), Math.sin(phi)];
}

function alsGrad(v: Vektor): [number, number] {
  const z = Math.max(-1, Math.min(1, v[2]));
  return [Math.atan2(v[1], v[0]) / GRAD, Math.asin(z) / GRAD];
}

function normiere(v: Vektor): Vektor | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? null : [v[0] / l, v[1] / l, v[2] / l];
}

function kreuz(a: Vektor, b: Vektor): Vektor {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function winkel(a: Vektor, b: Vektor): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/**
 * Stützstellen entlang des Grosskreises.
 *
 * Die Zahl richtet sich nach der Weite: Ein Bogen von Zürich nach Bern braucht
 * keine 48 Punkte, einer von Zürich nach Auckland schon. Das spart je Rahmen
 * hunderte Projektionen, ohne dass man es sieht.
 *
 * Auf dem Grosskreis und nicht auf der geraden Bildschirmlinie, weil Letztere
 * bei weiten Zielen quer durch die Kugel schneiden würde.
 */
function grosskreis(a: Vektor, b: Vektor, w: number): [number, number][] {
  const n = Math.max(10, Math.min(48, Math.round((w / Math.PI) * 40) + 10));
  const sinW = Math.sin(w);
  const pfad: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (sinW < 1e-9) {
      pfad.push(alsGrad(a));
      continue;
    }
    const s1 = Math.sin((1 - t) * w) / sinW;
    const s2 = Math.sin(t * w) / sinW;
    pfad.push(alsGrad([
      a[0] * s1 + b[0] * s2,
      a[1] * s1 + b[1] * s2,
      a[2] * s1 + b[2] * s2,
    ]));
  }
  return pfad;
}

/**
 * Liegt dieser Punkt hinter der Kugel?
 *
 * MapLibre beantwortet das selbst, markiert die Methode aber als `@internal`.
 * Deshalb wird sie einmal erfragt und nicht fest verdrahtet: Verschwindet sie
 * in einer künftigen Fassung, zeichnet das Replay die Bögen durchgehend
 * sichtbar — falsch, aber nicht kaputt.
 */
type Verdeckung = (lngLat: LngLat) => boolean;

function verdeckungPruefen(map: MapLibreMap): Verdeckung {
  const tf = (map as unknown as {
    transform?: { isLocationOccluded?: (l: LngLat) => boolean };
  }).transform;
  const fn = tf?.isLocationOccluded;
  if (typeof fn !== "function") return () => false;
  return (l: LngLat) => {
    try {
      return fn.call(tf, l);
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------- Schnittstelle

export interface ReplayEreignis {
  id: number;
  lat: number;
  lon: number;
  titel: string;
  ort: string;
}

export interface ReplayTexte {
  aria: string;
  medien: string;
  laender: string;
  sprachen: string;
  regionen: string;
  abspielen: string;
  pause: string;
  nochmal: string;
  schliessen: string;
  /**
   * Wie belastbar die Koordinaten sind, als Fusszeile.
   *
   * Zwei Zahlen und nicht eine: Eine Regionsmitte ist eine Näherung, eine
   * Landesmitte tut so, als wüsste man etwas. Sie in einen Topf zu werfen
   * nimmt `geo_quelle` genau die Unterscheidung, für die es da ist.
   */
  ortsguete: (land: number, region: number) => string;
  /**
   * Wie viele Medien mitgezählt, aber nicht gezeichnet werden.
   *
   * Wer sechs Bögen sieht, hält sechs für die Antwort. Dass drei Häuser nur
   * deshalb fehlen, weil **wir** ihren Sitz nicht kennen, ist eine Aussage über
   * unser Register — und die gehört ins Bild, nicht in eine Fussnote irgendwo.
   */
  ohneSitz: (n: number) => string;
  /** „und N weitere" — für die gedeckelte Namensliste im Titel. */
  weitere: (n: number) => string;
}

export interface ReplayOptionen {
  map: MapLibreMap;
  /** Element, in das Leinwand und Bedienung gehängt werden. */
  buehne: HTMLElement;
  farbe: string;
  locale: string;
  texte: ReplayTexte;
  /** Wird beim Schliessen gerufen — auch beim Schliessen von innen. */
  onEnde: () => void;
}

interface Bogen {
  arc: Arc;
  /** Zielrichtung als Einheitsvektor — für Kamera und Winkelmessung. */
  ziel: Vektor;
  /** Stützstellen in [lon, lat]. Hängen nicht an der Kamera, also einmal gerechnet. */
  pfad: [number, number][];
  /** Winkelabstand Ereignis ↔ Ziel in Radiant; bestimmt die Höhe. */
  weite: number;
  /** Anteil der Zeitachse, auf dem der Bogen landet. */
  fLand: number;
  /** Anteil, an dem er anläuft. Am Anfang gekappt. */
  fStart: number;
  /** Zusatzhöhe gegen Bögen mit demselben Ziel — sie schachteln sich. */
  zusatzHoehe: number;
  tSeen: number;
}

/**
 * Ein Medium ohne bekannten Sitz.
 *
 * Es hat einen Zeitpunkt, ein Land und eine Sprache — es fehlt ihm nur die
 * Koordinate. Deshalb wächst es in den Zählern mit wie jeder Bogen; gezeichnet
 * wird es nicht.
 */
interface Still {
  arc: Arc;
  fLand: number;
  tSeen: number;
}

// ---------------------------------------------------------------- Der Lauf

export class Replay {
  private wurzel: HTMLElement;
  private leinwand: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private uhrEl: HTMLElement;
  private versatzEl: HTMLElement;
  private zahlEls: HTMLElement[] = [];
  private leisteEl: HTMLElement;
  private spielenEl: HTMLButtonElement;
  private fussEl: HTMLElement;
  private ohneEl: HTMLElement;

  private boegen: Bogen[] = [];
  private stille: Still[] = [];
  private ereignis: ReplayEreignis | null = null;
  private t0 = 0;
  private spanne = 1;

  private f = 0;
  private laeuft = false;
  private raf = 0;
  private letzterTakt = 0;
  private kameraZuletzt = 0;
  private zoomZiel = 5;
  private zoomStart = 5;
  /** Wohin die Kamera blickt — einmal je Lauf bestimmt, danach unverändert. */
  private blick: [number, number] = [0, 0];
  private blickV: Vektor = [1, 0, 0];

  private verdeckt: Verdeckung;
  private uhrFormat: Intl.DateTimeFormat;
  private sanft: boolean;

  constructor(private opts: ReplayOptionen) {
    this.verdeckt = verdeckungPruefen(opts.map);
    this.uhrFormat = new Intl.DateTimeFormat(opts.locale, {
      hour: "2-digit",
      minute: "2-digit",
    });
    // Wer im System „weniger Bewegung" eingestellt hat, bekommt Sprünge statt
    // Fahrten. Die Fahrt ist Beiwerk, das Ankommen ist der Zweck.
    this.sanft = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const wurzel = document.createElement("div");
    wurzel.className = "replay";
    wurzel.setAttribute("role", "group");
    wurzel.setAttribute("aria-label", opts.texte.aria);
    wurzel.innerHTML = `
      <canvas class="replay__leinwand" aria-hidden="true"></canvas>
      <div class="replay__hud">
        <div class="replay__uhrzeile">
          <span class="replay__uhr"></span>
          <span class="replay__versatz"></span>
        </div>
        <div class="replay__zahlen">
          ${this.zahlFeld(opts.texte.medien)}
          ${this.zahlFeld(opts.texte.laender)}
          ${this.zahlFeld(opts.texte.sprachen)}
          ${this.zahlFeld(opts.texte.regionen)}
        </div>
        <div class="replay__leiste"><i></i></div>
        <p class="replay__ohne"></p>
        <div class="replay__knoepfe">
          <button type="button" class="replay__knopf" data-rolle="spielen"></button>
          <button type="button" class="replay__knopf" data-rolle="schliessen"></button>
        </div>
        <p class="replay__fuss"></p>
      </div>`;

    this.wurzel = wurzel;
    this.leinwand = wurzel.querySelector("canvas")!;
    const ctx = this.leinwand.getContext("2d");
    if (!ctx) throw new Error("Replay: kein 2D-Kontext.");
    this.ctx = ctx;
    this.uhrEl = wurzel.querySelector(".replay__uhr")!;
    this.versatzEl = wurzel.querySelector(".replay__versatz")!;
    this.zahlEls = [...wurzel.querySelectorAll<HTMLElement>(".replay__zahl b")];
    this.leisteEl = wurzel.querySelector(".replay__leiste i")!;
    this.spielenEl = wurzel.querySelector('[data-rolle="spielen"]')!;
    this.fussEl = wurzel.querySelector(".replay__fuss")!;
    this.ohneEl = wurzel.querySelector(".replay__ohne")!;

    const schliessen = wurzel.querySelector<HTMLButtonElement>('[data-rolle="schliessen"]')!;
    schliessen.textContent = opts.texte.schliessen;
    schliessen.addEventListener("click", () => this.beenden());
    this.spielenEl.addEventListener("click", () => this.umschalten());

    opts.buehne.appendChild(wurzel);
    document.addEventListener("keydown", this.aufTaste, true);
  }

  private zahlFeld(beschriftung: string): string {
    const sicher = beschriftung.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
    return `<div class="replay__zahl"><b>0</b><span>${sicher}</span></div>`;
  }

  /**
   * Escape schliesst, Leertaste hält an.
   *
   * In der Einfangphase und mit `stopPropagation`: Sonst schlösse Escape das
   * Teaser-Panel gleich mit, das seinen eigenen Zuhörer am Dokument hat — und
   * ein Tastendruck darf nur eine Sache tun.
   */
  private aufTaste = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.beenden();
    } else if (e.key === " " && this.wurzel.contains(document.activeElement)) {
      e.preventDefault();
      e.stopPropagation();
      this.umschalten();
    }
  };

  // -------------------------------------------------------------- Vorbereiten

  /**
   * Bögen aufbereiten und loslaufen.
   *
   * Der Nullpunkt der Uhr kommt aus dem ersten Bogen und seinem `minutes_after`
   * — die Ereigniszeit steckt also schon in der Nutzlast, und es braucht keine
   * zweite Abfrage dafür.
   */
  start(ereignis: ReplayEreignis, arcs: Arc[]) {
    this.ereignis = ereignis;
    const ziel = alsVektor(ereignis.lat, ereignis.lon);

    const erster = arcs[0];
    this.t0 = erster
      ? Date.parse(erster.first_seen_at) - erster.minutes_after * 60_000
      : Date.now();
    const letzter = arcs[arcs.length - 1];
    const tEnde = letzter ? Date.parse(letzter.first_seen_at) : this.t0;
    // Ein Boden von einer Minute: Bei einem Ereignis, dessen Medien alle
    // dieselbe Minute tragen, wäre die Spanne null — und jede Division daran
    // ergäbe Unendlich statt einer Aussage.
    this.spanne = Math.max(60_000, tEnde - this.t0);

    /*
     * Zwei Gruppen, eine Zeitleiste.
     *
     * Seit Migration 0026 liefert `event_arcs` **alle** Medien eines
     * Ereignisses. Die mit Sitz werden gezeichnet, die ohne zählen mit — Land
     * und Sprache stehen ja auch bei ihnen. Der Nullpunkt und die Spanne oben
     * kommen deshalb aus der vollen Liste: Ein Medium ohne Koordinate darf die
     * Uhr genauso weit tragen wie jedes andere.
     */
    const hatSitz = (a: Arc): a is Arc & { lat: number; lon: number } =>
      typeof a.lat === "number" && typeof a.lon === "number";
    const mitSitz = arcs.filter(hatSitz);

    this.stille = arcs.filter((a) => !hatSitz(a)).map((arc) => {
      const tSeen = Date.parse(arc.first_seen_at);
      return {
        arc,
        tSeen,
        fLand: Math.max(0, Math.min(1, (tSeen - this.t0) / this.spanne)),
      };
    });

    // Wie viele Bögen enden auf derselben Koordinate? Reuters und der Guardian
    // sitzen beide in London; ohne Versatz lägen sie exakt übereinander.
    const nachOrt = new Map<string, number>();
    for (const a of mitSitz) {
      const k = `${a.lat.toFixed(2)}|${a.lon.toFixed(2)}`;
      nachOrt.set(k, (nachOrt.get(k) ?? 0) + 1);
    }
    const lauf = new Map<string, number>();

    this.boegen = mitSitz.map((arc) => {
      const v = alsVektor(arc.lat, arc.lon);
      const w = winkel(ziel, v);
      const tSeen = Date.parse(arc.first_seen_at);
      const fLand = Math.max(0, Math.min(1, (tSeen - this.t0) / this.spanne));

      const k = `${arc.lat.toFixed(2)}|${arc.lon.toFixed(2)}`;
      const gesamt = nachOrt.get(k) ?? 1;
      const i = lauf.get(k) ?? 0;
      lauf.set(k, i + 1);

      return {
        arc,
        ziel: v,
        pfad: grosskreis(ziel, v, w),
        weite: w,
        fLand,
        // Gekappt: Bei fLand ≈ 0 ist der Bogen von Anfang an da, statt bei
        // null halb gezeichnet in der Luft zu hängen.
        fStart: Math.max(0, fLand - ANLAUF),
        zusatzHoehe: gesamt > 1 ? i * SPREIZUNG : 0,
        tSeen,
      };
    });

    // Die Werte stammen aus dem Aufzählungstyp `geo_quelle` (Migration 0013):
    // wikidata_sitz und handarbeit sind belegte Sitze und werden nicht
    // erwähnt — nur was eine Näherung ist, gehört in die Fusszeile.
    const aufLand = mitSitz.filter((a) => a.geo_quelle === "land").length;
    const aufRegion = mitSitz.filter((a) => a.geo_quelle === "region_iso3166_2").length;
    this.fussEl.textContent = this.opts.texte.ortsguete(aufLand, aufRegion);

    // Blickpunkt einmal aus **allen** Bögen bestimmen, nicht aus den bereits
    // gelandeten: Sonst schwenkte die Kamera bei jeder Landung nach, und die
    // Unruhe erzählte nichts. Was sich bewegt, ist der Zoom — und der erzählt
    // die Ausbreitung.
    this.szeneBestimmen(ereignis);
    // Eng anfangen: Zunächst muss nur das Ereignis ins Bild, nicht die ganze
    // Szene. Alles Weitere holt die Rückfahrt.
    const zumEreignis = winkel(this.blickV, ziel) / GRAD;
    this.zoomStart = this.zoomFuer(zumEreignis * 1.4 + 3);
    this.zoomZiel = this.zoomStart;
    this.kameraFahren(this.zoomStart, 900);

    this.f = 0;
    this.laeuft = true;
    this.letzterTakt = 0;
    this.spielenEl.textContent = this.opts.texte.pause;
    this.wurzel.classList.add("is-open");
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.takt);
  }

  beenden() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("keydown", this.aufTaste, true);
    this.wurzel.remove();
    this.opts.onEnde();
  }

  private umschalten() {
    if (this.f >= 1) {
      this.f = 0;
      this.laeuft = true;
      this.zoomZiel = this.zoomStart;
      this.kameraFahren(this.zoomStart, 700);
    } else {
      this.laeuft = !this.laeuft;
    }
    this.spielenEl.textContent = this.laeuft ? this.opts.texte.pause : this.opts.texte.abspielen;
    // `letzterTakt` zurücksetzen, damit die Pausendauer nicht als Fortschritt
    // nachgeholt wird. **Keine** neue Schleife starten: `takt` läuft auch im
    // Standbild weiter, und eine zweite Anmeldung liesse die Uhr doppelt so
    // schnell gehen — ein Fehler, den man nur an der Zeit merkt, und der genau
    // die Aussage zerstört, um die es hier geht.
    this.letzterTakt = 0;
  }

  // -------------------------------------------------------------- Takt

  private takt = (jetzt: number) => {
    if (this.laeuft) {
      if (this.letzterTakt) {
        this.f = Math.min(1, this.f + (jetzt - this.letzterTakt) / DAUER_MS);
      }
      this.letzterTakt = jetzt;
      if (this.f >= 1) {
        this.laeuft = false;
        window.setTimeout(() => {
          this.spielenEl.textContent = this.opts.texte.nochmal;
        }, NACHLAUF_MS);
      }
    }
    this.zeichnen();
    // Weiterlaufen auch im Standbild: Wer die Kugel dreht, soll die Bögen
    // mitdrehen sehen. Ein eingefrorenes Overlay über einer bewegten Karte
    // wäre eine Lüge über die Geometrie.
    this.raf = requestAnimationFrame(this.takt);
  };

  // -------------------------------------------------------------- Zeichnen

  private groesseAngleichen(): { b: number; h: number } {
    const b = this.wurzel.clientWidth;
    const h = this.wurzel.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.leinwand.width !== Math.round(b * dpr) || this.leinwand.height !== Math.round(h * dpr)) {
      this.leinwand.width = Math.round(b * dpr);
      this.leinwand.height = Math.round(h * dpr);
      this.leinwand.style.width = `${b}px`;
      this.leinwand.style.height = `${h}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { b, h };
  }

  /**
   * Mitte der Kugel auf dem Bildschirm.
   *
   * Der Punkt, auf den die Kamera blickt — und zugleich der Ursprung, von dem
   * aus ein angehobener Punkt weggestreckt wird. Mehr braucht es nicht: Die
   * frühere Fassung hat zusätzlich den Kugelradius mit vier Proben je Bild
   * vermessen, weil die Höhe damals in Pixeln gerechnet wurde. Als Streckung
   * ist sie verhältnismässig und der Radius kürzt sich heraus.
   */
  private globusMitte(): Point {
    return this.opts.map.project(this.opts.map.getCenter());
  }

  private zeichnen() {
    const ereignis = this.ereignis;
    if (!ereignis) return;
    const { b, h } = this.groesseAngleichen();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, b, h);

    const map = this.opts.map;
    const mitte = this.globusMitte();

    const gelandet: Bogen[] = [];
    const lngLat = new LngLat(0, 0);

    for (const bogen of this.boegen) {
      const p = bogen.fLand <= bogen.fStart
        ? (this.f >= bogen.fLand ? 1 : 0)
        : (this.f - bogen.fStart) / (bogen.fLand - bogen.fStart);
      if (p <= 0) continue;
      const anteil = Math.min(1, p);
      if (anteil >= 1) gelandet.push(bogen);

      const hoehe = Math.min(
        HOEHE_MAX,
        HOEHE * Math.sqrt(Math.max(bogen.weite, WEITE_MIN) / Math.PI),
      ) + bogen.zusatzHoehe;
      const punkte: { x: number; y: number; frei: boolean }[] = [];
      const n = bogen.pfad.length;
      const bis = Math.max(1, Math.ceil((n - 1) * anteil));

      /*
       * Ein Weg im Raum über der Kugel — und wie er auf den Bildschirm kommt.
       *
       * Zwei Anläufe davor waren beide zweidimensional, und beide sah man das:
       *
       *   1. Höhe als **fester Pixelbetrag** radial von der Kugelmitte weg.
       *      Bricht in der Bildmitte zusammen — dort zeigt „nach aussen" in
       *      dieselbe Richtung wie der Bogen, und man sieht Speichen.
       *   2. Höhe auf der **Senkrechten zur Sehne**. Wölbt sich immer, aber das
       *      Vorzeichen hing an der Kameraposition: Bei einer Kamerafahrt kippte
       *      es irgendwann um, und die Bögen sprangen auf die andere Seite.
       *
       * Beide haben eine Wölbung *auf* die Kugel gemalt, statt einen Weg
       * *über* ihr zu zeigen. Der eigentliche Denkfehler war die Annahme,
       * echte 3-D-Bögen gingen nicht, weil `project()` nur Punkte auf der
       * Oberfläche kennt.
       *
       * Sie gehen doch. Die Kugelprojektion ist in guter Näherung linear im
       * Ortsvektor, und daraus folgt für einen um `h` angehobenen Punkt:
       *
       *     Bildschirm((1+h)·v) = Mitte + (1+h) · (Bildschirm(v) − Mitte)
       *
       * Der angehobene Punkt ist also der **von der Kugelmitte weggestreckte**
       * Oberflächenpunkt. Keine Sehne, kein Vorzeichen, keine
       * Fallunterscheidung — und `project()` genügt vollkommen.
       *
       * Damit verhält sich der Bogen wie ein Flugweg: In der Bildmitte sieht
       * man ihn verkürzt, weil man von oben darauf blickt; zum Rand hin öffnet
       * sich die Schlaufe. Deshalb blickt die Kamera schräg auf die Bogenebene
       * (siehe `szeneBestimmen`) — jetzt ist das keine Kosmetik mehr, sondern
       * die Bedingung dafür, dass man die Wölbung überhaupt sieht.
       */
      for (let i = 0; i <= bis && i < n; i++) {
        const [lon, lat] = bogen.pfad[i];
        const s = map.project([lon, lat]);
        const t = i / (n - 1);
        const streckung = 1 + hoehe * Math.sin(Math.PI * t);
        lngLat.lng = lon;
        lngLat.lat = lat;
        punkte.push({
          x: mitte.x + (s.x - mitte.x) * streckung,
          y: mitte.y + (s.y - mitte.y) * streckung,
          // Geprüft wird der **Oberflächen**punkt. Ein hoch genug angehobener
          // Bogen wäre über dem Horizont noch sichtbar; das nachzubilden
          // bräuchte MapLibres Kameramatrix, die nicht offenliegt. Die Folge
          // ist ein etwas zu früh verblassender Bogen — sichtbar nur bei
          // Wegen um die halbe Welt.
          frei: !this.verdeckt(lngLat),
        });
      }

      this.bogenZeichnen(punkte, anteil >= 1);
    }

    this.ereignisZeichnen(map.project([ereignis.lon, ereignis.lat]));
    this.etikettenZeichnen(gelandet, b, h);
    const gelandetStill = this.stille.filter((x) => this.f >= x.fLand);
    this.hudSetzen(gelandet, gelandetStill);
    this.kameraNachfuehren(gelandet);
  }

  /**
   * Ein Bogen, in Läufen gleicher Sichtbarkeit.
   *
   * Verdeckte Abschnitte werden schwach durchscheinend gezeichnet statt
   * weggelassen — man sieht dann, dass der Bogen um die Kugel herumgeht,
   * statt dass er im Nichts abreisst.
   */
  private bogenZeichnen(punkte: { x: number; y: number; frei: boolean }[], fertig: boolean) {
    if (punkte.length < 2) return;
    const ctx = this.ctx;
    ctx.lineWidth = fertig ? 1.5 : 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let i = 0;
    while (i < punkte.length - 1) {
      const frei = punkte[i].frei && punkte[i + 1].frei;
      ctx.beginPath();
      ctx.moveTo(punkte[i].x, punkte[i].y);
      let j = i + 1;
      while (j < punkte.length && (punkte[j - 1].frei && punkte[j].frei) === frei) {
        ctx.lineTo(punkte[j].x, punkte[j].y);
        j++;
      }
      ctx.globalAlpha = frei ? (fertig ? 0.55 : 0.95) : VERDECKT;
      ctx.strokeStyle = this.opts.farbe;
      ctx.stroke();
      i = j - 1;
    }
    ctx.globalAlpha = 1;

    // Kopf und Landepunkt: Der Kreis geht **gemeinsam** mit Etikett und Zähler
    // an. Vorher erschien er schon bei 55 % des Bogens — das Ziel leuchtete,
    // bevor die Meldung dort war.
    const kopf = punkte[punkte.length - 1];
    if (!kopf.frei) return;
    ctx.beginPath();
    ctx.arc(kopf.x, kopf.y, fertig ? 3.4 : 2.2, 0, Math.PI * 2);
    ctx.fillStyle = this.opts.farbe;
    ctx.globalAlpha = fertig ? 1 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  private ereignisZeichnen(p: Point) {
    const ctx = this.ctx;
    const puls = 1 + 0.18 * Math.sin(performance.now() / 420);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7 * puls, 0, Math.PI * 2);
    ctx.strokeStyle = this.opts.farbe;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = this.opts.farbe;
    ctx.globalAlpha = 1;
    ctx.fill();
  }

  /**
   * Etiketten: Name und Erscheinungszeit, dunkle Pille, Führungsstrich.
   *
   * Ohne Namen bleibt der Globus abstrakt; mit ihnen wird zum Beispiel die
   * Agenturrolle von Reuters unmittelbar sichtbar — danach gehen die weiten
   * Bögen los.
   *
   * **Im Gedränge gewinnt die neueste Meldung.** Gezeichnet wird von der
   * jüngsten Landung abwärts; was nicht überschneidungsfrei passt, fällt weg.
   * In Europa sitzen neun Medien auf engstem Raum — ohne diese Regel entsteht
   * dort ein Textbrei. Lesbar ist damit immer genau das, was gerade passiert;
   * alles andere steht in der Liste.
   */
  private etikettenZeichnen(gelandet: Bogen[], b: number, h: number) {
    const ctx = this.ctx;
    const map = this.opts.map;
    const belegt: { x: number; y: number; b: number; h: number }[] = [];
    const lngLat = new LngLat(0, 0);
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.textBaseline = "middle";

    const jung = [...gelandet].sort((a, z) => z.tSeen - a.tSeen).slice(0, ETIKETTEN * 3);
    let gesetzt = 0;

    for (const bogen of jung) {
      if (gesetzt >= ETIKETTEN) break;
      const [lon, lat] = bogen.pfad[bogen.pfad.length - 1];
      lngLat.lng = lon;
      lngLat.lat = lat;
      if (this.verdeckt(lngLat)) continue;

      // Der Endpunkt des Bogens liegt auf der Oberfläche — dort ist der Hub
      // sin(π·1) = 0 und der seitliche Versatz ebenfalls. Das Etikett hängt
      // deshalb am Ort selbst und nicht am Scheitel: Es soll die Redaktion
      // bezeichnen, nicht den Flugweg dorthin.
      const s = map.project([lon, lat]);
      const ax = s.x;
      const ay = s.y;

      const text = `${bogen.arc.name} · ${this.uhrFormat.format(bogen.tSeen)}`;
      const breite = ctx.measureText(text).width + 14;
      const hoeheP = 19;
      const rechts = ax < b - breite - 30;
      const x = rechts ? ax + 13 : ax - 13 - breite;
      const y = ay - 13;

      if (x < 4 || x + breite > b - 4 || y < 4 || y + hoeheP > h - 4) continue;
      const kasten = { x, y: y - hoeheP / 2, b: breite, h: hoeheP };
      if (belegt.some((r) => !(kasten.x + kasten.b < r.x || r.x + r.b < kasten.x ||
                              kasten.y + kasten.h < r.y || r.y + r.h < kasten.y))) continue;
      belegt.push(kasten);
      gesetzt += 1;

      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(rechts ? x : x + breite, y);
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = "rgba(12,14,17,0.86)";
      // `roundRect` gibt es erst seit Safari 16. Fehlt sie, wird die Pille
      // eckig — das ist eine Einbusse an Form, keine an Aussage.
      if (typeof ctx.roundRect === "function") {
        ctx.beginPath();
        ctx.roundRect(kasten.x, kasten.y, kasten.b, kasten.h, 9);
        ctx.fill();
      } else {
        ctx.fillRect(kasten.x, kasten.y, kasten.b, kasten.h);
      }
      ctx.fillStyle = "rgba(240,242,245,0.95)";
      ctx.fillText(text, kasten.x + 7, y);
    }
  }

  // -------------------------------------------------------------- Anzeige

  /**
   * Gezählt wird über **beide** Gruppen.
   *
   * Der Medienzähler nennt die Reichweite des Ereignisses, nicht die Zahl der
   * Striche auf dem Bildschirm. Länder und Sprachen erst recht: Ein türkisches
   * Haus ohne bekannten Sitz ist trotzdem die Türkei und trotzdem Türkisch —
   * und genau diese Zähler sind die Aussage des Werkzeugs.
   *
   * Die Differenz zwischen Zähler und sichtbaren Bögen erklärt die Zeile über
   * den Knöpfen. Ohne sie hielte man sechs Bögen für die ganze Antwort.
   */
  private hudSetzen(gelandet: Bogen[], still: Still[]) {
    const tJetzt = this.t0 + this.spanne * this.f;
    this.uhrEl.textContent = this.uhrFormat.format(tJetzt);
    this.versatzEl.textContent = dauerText(this.spanne * this.f);
    this.leisteEl.style.width = `${(this.f * 100).toFixed(1)}%`;

    const laender = new Set<string>();
    const sprachen = new Set<string>();
    const regionen = new Set<string>();
    for (const arc of [...gelandet.map((g) => g.arc), ...still.map((x) => x.arc)]) {
      if (arc.country) laender.add(arc.country);
      if (arc.language) sprachen.add(arc.language);
      const r = weltregion(arc.country);
      if (r) regionen.add(r);
    }

    const text = still.length > 0 ? this.opts.texte.ohneSitz(still.length) : "";
    if (this.ohneEl.textContent !== text) {
      this.ohneEl.textContent = text;
      // Die Namen im Titel: „aufgezählt" heisst nicht nur „gezählt". Sie füllen
      // aber keine Zeile, sondern warten dort, wo man sie sucht.
      //
      // Gedeckelt, weil die Zahl gross wird: Bei einem gemessenen Ereignis
      // standen 55 von 61 Häusern ohne Sitz da. Ein Titel mit 55 Namen ist
      // kein Hinweis mehr, sondern eine Wand — und in manchen Browsern wird er
      // ohnehin abgeschnitten, dann aber ohne zu sagen, dass etwas fehlt.
      const namen = still.map((x) => x.arc.name);
      this.ohneEl.title = namen.length <= NAMEN_MAX
        ? namen.join(", ")
        : `${namen.slice(0, NAMEN_MAX).join(", ")} … ${this.opts.texte.weitere(namen.length - NAMEN_MAX)}`;
    }

    const werte = [gelandet.length + still.length, laender.size, sprachen.size, regionen.size];
    werte.forEach((w, i) => {
      const el = this.zahlEls[i];
      if (el && el.textContent !== String(w)) el.textContent = String(w);
    });
  }

  /**
   * Die Kamera geht mit.
   *
   * Bei fester Weltansicht sind alle europäischen Bögen ein grüner Fleck. Eng
   * am Ereignis starten und mit der Verbreitung zurückfahren — der Zoom
   * erzählt die Ausbreitung dann selbst mit.
   *
   * Zurückgefahren wird nur, nie wieder heran: Ein Zoom, der zwischen zwei
   * Landungen hin- und herspringt, ist Unruhe ohne Aussage.
   */
  private kameraNachfuehren(gelandet: Bogen[]) {
    const ereignis = this.ereignis;
    if (!ereignis || gelandet.length === 0) return;
    const jetzt = performance.now();
    if (jetzt - this.kameraZuletzt < 1_200) return;

    // Wie weit reicht die Szene vom Blickpunkt aus — Ereignis eingeschlossen.
    let grad = winkel(this.blickV, alsVektor(ereignis.lat, ereignis.lon)) / GRAD;
    for (const g of gelandet) grad = Math.max(grad, winkel(this.blickV, g.ziel) / GRAD);

    const ziel = this.zoomFuer(grad * 1.25 + 2);
    if (ziel > this.zoomZiel - 0.3) return;
    this.zoomZiel = ziel;
    this.kameraZuletzt = jetzt;
    this.kameraFahren(ziel, 1_400);
  }

  /**
   * Wohin die Kamera blickt — und warum nicht auf das Ereignis.
   *
   * Die Bogenhöhe wird **radial nach aussen** aufgetragen, weg von der
   * Bildschirmmitte der Kugel: Das ist auf der Kugel „nach oben von der
   * Oberfläche". Sitzt das Ereignis aber genau in dieser Mitte, zeigt „nach
   * aussen" in dieselbe Richtung wie der Bogen selbst — er hebt sich entlang
   * seiner eigenen Richtung ab, und man sieht Speichen statt Schlaufen.
   *
   * Zwei Griffe dagegen, und beide sind Geometrie, keine Kosmetik:
   *
   * **Erstens** blickt die Kamera auf die Mitte zwischen Ereignis und
   * Schwerpunkt der Redaktionen, nicht auf das Ereignis. Damit sitzt das
   * Ereignis schon von sich aus ausserhalb der Bildmitte.
   *
   * **Zweitens** wird aus der Ebene der Bögen herausgekippt. Alle Bögen liegen
   * in der Ebene durch Ereignis und Schwerpunkt; wer schräg darauf blickt,
   * sieht ihre Wölbung, wer in der Ebene liegt, sieht Striche. Der Kippwinkel
   * wächst mit der Szene (60 % ihres Radius, gedeckelt bei 30°), damit er beim
   * Heranzoomen nie aus dem Bild führt.
   *
   * Einmal je Lauf bestimmt, aus **allen** Bögen — nicht nachgeführt. Eine
   * Kamera, die bei jeder Landung nachschwenkt, ist unruhig und erzählt nichts.
   */
  private szeneBestimmen(ereignis: ReplayEreignis) {
    const e = alsVektor(ereignis.lat, ereignis.lon);
    const summe: Vektor = [0, 0, 0];
    for (const b of this.boegen) {
      summe[0] += b.ziel[0];
      summe[1] += b.ziel[1];
      summe[2] += b.ziel[2];
    }
    const m = normiere(summe) ?? e;
    const s = normiere([e[0] + m[0], e[1] + m[1], e[2] + m[2]]) ?? e;

    let r0 = winkel(s, e);
    for (const b of this.boegen) r0 = Math.max(r0, winkel(s, b.ziel));

    // Normale der Bogenebene. Fallen Ereignis und Schwerpunkt zusammen — alle
    // Redaktionen sitzen am Ort des Geschehens —, gibt es keine Ebene, und
    // irgendeine Senkrechte tut es.
    const p = normiere(kreuz(e, m))
      ?? normiere(kreuz(e, Math.abs(e[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));

    const kippen = Math.max(KIPPUNG_MIN, Math.min(34 * GRAD, r0 * 0.7));
    const c = p
      ? normiere([
        s[0] * Math.cos(kippen) + p[0] * Math.sin(kippen),
        s[1] * Math.cos(kippen) + p[1] * Math.sin(kippen),
        s[2] * Math.cos(kippen) + p[2] * Math.sin(kippen),
      ]) ?? s
      : s;

    this.blickV = c;
    this.blick = alsGrad(c);
  }

  /**
   * Zoomstufe, bei der ein Winkelradius von `grad` ins Bild passt.
   *
   * Die sichtbare Weite halbiert sich je Stufe, also `log2(180 / grad)`. Der
   * Abzug von 0,35 ist der Rand — nach Augenmass gesetzt und die eine Zahl
   * hier, an der man ohne Bedenken drehen kann.
   */
  private zoomFuer(grad: number): number {
    return Math.max(1, Math.min(5.5, Math.log2(180 / Math.max(grad, 2)) - 0.35));
  }

  private kameraFahren(zoom: number, dauer: number) {
    /*
     * Die Länge kommt aus der **laufenden** Kamera, nicht aus `blick`.
     *
     * Die Kugel dreht während des Replays. Würde jede Zoomfahrt auf die
     * ursprüngliche Länge zurückzentrieren, machte sie die Drehung jedes Mal
     * rückgängig — ein Ruck alle paar Sekunden, und die Drehung käme nie vom
     * Fleck. Die Breite bleibt dagegen bei `blick`: Dort steckt die Kippung aus
     * der Bogenebene, und die ist der Grund, warum man die Schlaufen sieht.
     */
    const lng = this.opts.map.getCenter().lng;
    const ziel = { center: [lng, this.blick[1]] as [number, number], zoom };
    if (this.sanft) this.opts.map.easeTo({ ...ziel, duration: dauer });
    else this.opts.map.jumpTo(ziel);
  }
}

/** „+2 h 14 min" — der Abstand zum Ereignisbeginn, in Worten der Uhr. */
function dauerText(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `+${min} min`;
  const std = Math.floor(min / 60);
  const rest = min % 60;
  if (std < 48) return rest ? `+${std} h ${rest} min` : `+${std} h`;
  return `+${Math.floor(std / 24)} d ${std % 24} h`;
}
