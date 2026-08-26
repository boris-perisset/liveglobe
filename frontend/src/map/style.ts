import type { StyleSpecification } from "maplibre-gl";

/**
 * Die Farbwelt von Globe News, angewandt auf eine OpenStreetMap-Basiskarte.
 *
 * Dieselben Werte wie zuvor auf dem Textur-Globus – Ozean und Land liegen dicht
 * beieinander, die Kanten tragen die Information.
 */
export const PALETTE = {
  ozean: "#0a1420",
  land: "#16222f",
  grenze: "rgba(150,180,215,0.45)",
  // Die Kuestenlinie muss den Replay-Schleier ueberleben (66 % Schwarz
  // darueber). Deshalb heller als die Verwaltungsgrenze — aber haarduenn,
  // damit sie ohne Schleier nicht dominiert.
  kueste: "rgba(198,222,246,0.52)",
  strasse: "#1e2c3b",
  gebaeude: "#1b2836",
  text: "#9fb0c4",
  halo: "#08090b",
  himmel: "#0b1626",
  horizont: "#3f6fa8",
} as const;

const STIL_URL = import.meta.env?.VITE_MAP_STYLE ||
  "https://tiles.openfreemap.org/styles/dark";

/**
 * Notfallstil ohne Kacheln.
 *
 * Greift, wenn der Kachelserver nicht antwortet — dann bleibt eine leere, aber
 * bedienbare Kugel übrig, auf der die Pins weiterhin sitzen. Besser als eine
 * weisse Seite, und im Entwicklungsbetrieb ohne Netz die Standardsituation.
 */
export function notfallStil(): StyleSpecification {
  return {
    version: 8,
    name: "Globe News – ohne Kacheln",
    projection: { type: "globe" },
    sources: {},
    layers: [{
      id: "hintergrund",
      type: "background",
      paint: { "background-color": PALETTE.ozean },
    }],
  };
}

/**
 * Färbt einen geladenen Stil um.
 *
 * Wir greifen die Ebenen nach Typ und Namen ab, statt eine eigene Stildatei zu
 * pflegen: So bleiben wir unabhängig davon, wie OpenFreeMap seinen Stil intern
 * aufbaut, und überstehen auch eine Überarbeitung von deren Seite.
 */
export function einfaerben(stil: StyleSpecification): StyleSpecification {
  const istWasser = (id: string) => /water|ocean|sea|river|lake|bathym/.test(id);

  for (const lay of stil.layers ?? []) {
    const id = lay.id.toLowerCase();
    const paint = ((lay as { paint?: Record<string, unknown> }).paint ??= {});

    switch (lay.type) {
      case "background":
        paint["background-color"] = PALETTE.land;
        break;
      case "fill":
        paint["fill-color"] = istWasser(id)
          ? PALETTE.ozean
          : /building/.test(id)
          ? PALETTE.gebaeude
          : PALETTE.land;
        if (/landcover|landuse|park|wood|forest|grass|sand/.test(id)) {
          paint["fill-opacity"] = 0.3;
        }
        break;
      case "fill-extrusion":
        paint["fill-extrusion-color"] = PALETTE.gebaeude;
        break;
      case "raster":
        // Der dunkle Stil legt bis Zoom 6 ein Natural-Earth-Relief als Bildkachel
        // über das Land. Genau das gerasterte Aussehen wollten wir loswerden.
        paint["raster-opacity"] = 0;
        break;
      case "line":
        paint["line-color"] = /boundary|admin/.test(id)
          ? PALETTE.grenze
          : istWasser(id)
          ? PALETTE.ozean
          : PALETTE.strasse;
        break;
      case "symbol":
        paint["text-color"] = PALETTE.text;
        paint["text-halo-color"] = PALETTE.halo;
        paint["text-halo-width"] = 1.2;
        break;
    }
  }

  // Kugelprojektion und Atmosphäre gehören in den Stil, nicht in einen Aufruf
  // danach – sonst sieht man beim Laden kurz die flache Karte.
  stil.projection = { type: "globe" };
  stil.sky = {
    "sky-color": PALETTE.himmel,
    "horizon-color": PALETTE.horizont,
    "fog-color": "#08090b",
    "sky-horizon-blend": 0.6,
    "horizon-fog-blend": 0.6,
    "fog-ground-blend": 0.2,
  };

  kuestenlinieEinziehen(stil);

  return stil;
}

/**
 * Zieht eine feine helle Linie um Land und Seen.
 *
 * Warum es sie braucht: Ozean (#0a1420) und Land (#16222f) liegen in der
 * Helligkeit dicht beieinander — der Stil setzt darauf, dass „die Kanten die
 * Information tragen". Nur gab es diese Kanten nie: Gefärbt werden Flächen und
 * Verwaltungsgrenzen, die Küste selbst blieb ungezeichnet. Im normalen Betrieb
 * fällt das kaum auf, im Replay legt sich ein Schleier aus 66 % Schwarz über
 * die Karte, und der letzte Rest Unterschied verschwindet.
 *
 * Gezeichnet wird der **Umriss der Wasserflächen**. Das ergibt die Küste und
 * die Seeufer in einem Zug, ohne eine zweite Datenquelle: Die Geometrie liegt
 * ohnehin schon da, sie wurde bisher nur gefüllt und nicht umrandet.
 *
 * Quelle und Ebenenname werden aus dem geladenen Stil **abgelesen**, nicht
 * angenommen — wie im ganzen Rest dieser Datei. Findet sich keine
 * Wasserfläche, passiert nichts: lieber keine Küste als eine Ausnahme im
 * Ladeweg.
 */
function kuestenlinieEinziehen(stil: StyleSpecification) {
  const wasser = (stil.layers ?? []).find((l) => {
    const q = l as { type?: string; source?: string; "source-layer"?: string; id: string };
    return q.type === "fill" && !!q.source && !!q["source-layer"] &&
      /water|ocean|sea/.test(q.id.toLowerCase());
  }) as { source: string; "source-layer": string } | undefined;
  if (!wasser) return;

  // Über die Fläche, aber unter die Beschriftungen: Ein Ortsname, den eine
  // Linie durchschneidet, ist schlechter lesbar als einer ohne Küste daneben.
  const ersteSchrift = (stil.layers ?? []).findIndex((l) => l.type === "symbol");
  const stelle = ersteSchrift === -1 ? (stil.layers ?? []).length : ersteSchrift;

  (stil.layers ?? []).splice(stelle, 0, {
    id: "gn-kuestenlinie",
    type: "line",
    source: wasser.source,
    "source-layer": wasser["source-layer"],
    // Nur Flächen. Flüsse liegen in derselben Ebene als Linien und würden sonst
    // doppelt gezeichnet — einmal als Fluss, einmal als eigener Umriss.
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: {
      "line-color": PALETTE.kueste,
      // Haarlinie auf der Kugel, etwas kräftiger beim Hineinzoomen. Ein fester
      // Wert wäre aus der Ferne unsichtbar oder aus der Nähe ein Balken.
      "line-width": ["interpolate", ["linear"], ["zoom"],
        0, 0.6,
        3, 0.8,
        6, 1.1,
        10, 1.4],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 0.75],
    },
  } as never);
}

/**
 * Holt den Basisstil und gibt ihn fertig eingefärbt zurück.
 *
 * Das Umfärben passiert **vor** der Übergabe an MapLibre. Würden wir erst nach
 * `style.load` eingreifen, blitzten für einen Moment die Originalfarben auf.
 */
let notfallAktiv = false;

/** Ob gerade der Notfallstil läuft – die Oberfläche sagt es dann auch an. */
export function istNotfall(): boolean {
  return notfallAktiv;
}

export async function ladeStil(): Promise<StyleSpecification> {
  try {
    const res = await fetch(STIL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stil = einfaerben((await res.json()) as StyleSpecification);
    notfallAktiv = false;
    return stil;
  } catch (e) {
    console.warn("Basiskarte nicht erreichbar, Notfallstil aktiv:", e);
    notfallAktiv = true;
    return notfallStil();
  }
}
