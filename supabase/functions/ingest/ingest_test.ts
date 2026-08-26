// Fixture-Tests für die Teile, die ohne Netz und ohne Datenbank prüfbar sind.
//
//   deno test supabase/functions/ingest/
//
// Die Zeilen stammen aus echten GKG-Dateien (siehe scripts/gkg-sample.sh).

import {
  extractQuote,
  extractTitle,
  parseGkgDate,
  parseLocations,
  parseRow,
  pickLocation,
} from "./gkg.ts";
import { categorise } from "./categorise.ts";
import { encodeGeohash } from "./geohash.ts";
import { readFirstEntry, unzipLines } from "./zip.ts";
import { splitPlaceName, toIso2 } from "./countries.ts";

/** Bewusst ohne externe Test-Bibliothek – hält die Function abhängigkeitsfrei. */
function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg ? msg + ": " : ""}erwartet ${b}, erhalten ${a}`);
}

function assert(bedingung: boolean, msg: string): void {
  if (!bedingung) throw new Error(msg);
}

// ---------------------------------------------------------------- Titel
Deno.test("extractTitle liest PAGE_TITLE", () => {
  assertEquals(
    extractTitle("<PAGE_TITLE>Russian missiles hit Izmail port</PAGE_TITLE>"),
    "Russian missiles hit Izmail port",
  );
  assertEquals(extractTitle(""), null);
  assertEquals(extractTitle("<PAGE_TITLE>kurz</PAGE_TITLE>"), null, "zu kurz");
});

Deno.test("extractTitle löst numerische Entitäten auf", () => {
  // So kommen die übersetzten Meldungen wirklich an
  assertEquals(
    extractTitle("<PAGE_TITLE>&#x130;zmir a&#xE7;&#x131;klar&#x131;ndaki ada</PAGE_TITLE>"),
    "İzmir açıklarındaki ada",
  );
  assertEquals(
    extractTitle("<PAGE_TITLE>Preise &amp; L&#246;hne steigen weiter an</PAGE_TITLE>"),
    "Preise & Löhne steigen weiter an",
  );
});

// ---------------------------------------------------------------- Orte
Deno.test("parseLocations liest das V2-Format und zählt Nennungen", () => {
  const v2 =
    "4#Izmail, Odes'ka Oblast, Ukraine#UP#UP17#25024#45.3493#28.8408#-1040491#89;" +
    "4#Izmail, Odes'ka Oblast, Ukraine#UP#UP17#25024#45.3493#28.8408#-1040491#592;" +
    "1#Russia#RS#RS#0#60#100#RS#12";
  const locs = parseLocations(v2, "");
  assertEquals(locs.length, 2);
  assertEquals(locs[0].mentions, 2, "Doppelnennung zählt");
  assertEquals(locs[0].lat, 45.3493);
  assertEquals(locs[0].lon, 28.8408);
  assertEquals(locs[1].type, 1);
});

Deno.test("parseLocations versteht auch das kürzere V1-Format", () => {
  const v1 = "4#Odesa, Odes'ka Oblast, Ukraine#UP#UP17#46.4639#30.7386#-1044367";
  const locs = parseLocations("", v1);
  assertEquals(locs.length, 1);
  assertEquals(locs[0].lat, 46.4639);
  assertEquals(locs[0].lon, 30.7386);
});

Deno.test("parseLocations verwirft Unbrauchbares", () => {
  assertEquals(parseLocations("", ""), []);
  assertEquals(parseLocations("1#Nullinsel#XX#XX#0#0#0#0#1", ""), []);
  assertEquals(parseLocations("kaputt", ""), []);
});

Deno.test("pickLocation bevorzugt Städte vor Ländern", () => {
  const locs = parseLocations(
    "1#Ukraine#UP#UP#0#49#32#UP#1;1#Ukraine#UP#UP#0#49#32#UP#2;1#Ukraine#UP#UP#0#49#32#UP#3;" +
      "4#Izmail, Odes'ka Oblast, Ukraine#UP#UP17#25024#45.3493#28.8408#-1040491#89",
    "",
  );
  const gewaehlt = pickLocation(locs)!;
  assertEquals(gewaehlt.fullName, "Izmail, Odes'ka Oblast, Ukraine",
    "Stadt schlägt Land, auch bei weniger Nennungen");
  assertEquals(pickLocation([]), null);
});

// ---------------------------------------------------------------- Rubriken
Deno.test("categorise trifft nur an Wortgrenzen", () => {
  // Die beiden Fälle, an denen die erste Fassung gescheitert ist
  assert(categorise(["WB_135_TRANSPORT"]).category !== "sport", "TRANSPORT ist kein SPORT");
  assert(
    categorise(["WB_2670_JOBS_SKILLS"]).category !== "conflict_war_peace",
    "SKILLS ist kein KILL",
  );
});

Deno.test("categorise erkennt eindeutige Fälle", () => {
  assertEquals(
    categorise(["ARMEDCONFLICT", "MILITARY", "KILL", "WOUND"]).category,
    "conflict_war_peace",
  );
  assertEquals(
    categorise(["NATURAL_DISASTER_FLOOD", "NATURAL_DISASTER", "EVACUATION"]).category,
    "disaster_accident",
  );
  assertEquals(
    categorise(["ENV_CLIMATECHANGE", "BIODIVERSITY", "WILDLIFE"]).category,
    "environment",
  );
});

// Der Fall, der die Umstellung ausgelöst hat: IPTC führt Konflikt, Krieg und
// Frieden unter *einem* Oberbegriff. Ein Waffenstillstand ist kein anderes
// Thema als der Krieg, über den verhandelt wird — er ist dessen Verlauf.
Deno.test("Friedensgespräche landen unter Konflikt & Frieden", () => {
  assertEquals(
    categorise(["CEASEFIRE", "NEGOTIATIONS", "PEACE"]).category,
    "conflict_war_peace",
  );
});

// Vorher trennten wir Naturkatastrophe und Unfall. IPTC fasst das Ereignis und
// trennt nicht nach Ursache. Der Test bleibt stehen, damit dokumentiert ist,
// dass die Zusammenlegung gewollt ist und nicht versehentlich passiert.
Deno.test("Naturkatastrophe und Unfall teilen sich einen Oberbegriff", () => {
  assertEquals(
    categorise(["MANMADE_DISASTER_IMPLIED", "DISASTER_FIRE"]).category,
    "disaster_accident",
  );
  assertEquals(categorise(["NATURAL_DISASTER_EARTHQUAKE"]).category, "disaster_accident");
});

/*
 * Die neu hinzugekommenen Oberbegriffe — mit **echten** GKG-Themennamen.
 *
 * Die erste Fassung dieser Prüfung nahm erfundene Namen (`ECON_INFLATION`,
 * `TAX_FNCACT`, `MARKET`). Sie bestand, und trotzdem war das Vokabular kaputt:
 * Bewiesen war nur, dass die Mustermaschine funktioniert, nicht dass die Muster
 * auf echte GDELT-Themen passen. An 60 Zeilen aus `_sample/` gemessen landeten
 * damals 49 in „Wirtschaft".
 *
 * Alle Namen unten stammen deshalb aus `_sample/` und sind dort nachweisbar.
 * Das Rückgrat sind die numerierten Weltbank-Codes: Weil an jeder
 * Unterstrichgrenze getroffen wird, greift `EDUCATION` auch in `WB_470_EDUCATION`.
 */
Deno.test("categorise erkennt die neu hinzugekommenen Oberbegriffe", () => {
  assertEquals(
    categorise(["EPU_ECONOMY", "ECON_INFLATION", "WB_471_ECONOMIC_GROWTH"]).category,
    "economy_business",
  );
  assertEquals(categorise(["WB_840_JUSTICE", "TRIAL", "ARREST"]).category, "crime_law");
  assertEquals(
    categorise(["WB_621_HEALTH_NUTRITION_AND_POPULATION", "MEDICAL", "GENERAL_HEALTH"]).category,
    "health",
  );
  assertEquals(
    categorise(["EDUCATION", "WB_470_EDUCATION", "SOC_POINTSOFINTEREST_SCHOOL"]).category,
    "education",
  );
  assertEquals(categorise(["WB_2670_JOBS", "UNEMPLOYMENT", "WB_856_WAGES"]).category, "labour");
  assertEquals(categorise(["RELIGION", "TAX_RELIGION"]).category, "religion");
  assertEquals(
    categorise(["WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES", "SCIENCE", "SOC_INNOVATION"])
      .category,
    "science_technology",
  );
  assertEquals(
    categorise(["WB_695_POVERTY", "WB_134_SOCIAL_DEVELOPMENT", "DISCRIMINATION"]).category,
    "society",
  );
});

/*
 * Der teuerste Einzelfehler dieser Umstellung, als Rückfallprüfung.
 *
 * `TAX_` heisst in GDELT **Taxonomie**, nicht Steuern: `TAX_FNCACT`
 * (Funktionsträger), `TAX_ETHNICITY`, `TAX_WORLDLANGUAGES`. Mit 594 von rund
 * 2000 Vorkommen ist es das häufigste Präfix überhaupt. Ein Muster `TAX*`
 * machte 82 % aller Meldungen zu Wirtschaftsmeldungen.
 */
Deno.test("TAX_ ist Taxonomie und keine Steuermeldung", () => {
  const nurTaxonomie = ["TAX_FNCACT_PRESIDENT", "TAX_ETHNICITY", "TAX_WORLDLANGUAGES", "TAX_FNCACT"];
  assertEquals(categorise(nurTaxonomie).category, "other");
});

// GDELT schreibt SEIGE statt SIEGE. Ohne beide Schreibweisen fiele eine
// Belagerung durch — gefunden erst beim Lesen der echten Themennamen.
Deno.test("categorise kennt GDELTs Schreibweise SEIGE", () => {
  assertEquals(
    categorise(["ARMEDCONFLICT", "KILL", "WOUND", "SEIGE"]).category,
    "conflict_war_peace",
  );
});

Deno.test("categorise fällt bei dünner Lage auf 'other' zurück", () => {
  assertEquals(categorise([]).category, "other");
  assertEquals(categorise(["TAX_FNCACT", "TAX_ETHNICITY"]).category, "other");
});

Deno.test("categorise meldet unzugeordnete Themen zurück", () => {
  const r = categorise(["ARMEDCONFLICT", "TAX_FNCACT_BAECKER"]);
  assertEquals(r.unmatched, ["TAX_FNCACT_BAECKER"]);
});

// ---------------------------------------------------------------- Sonstiges
Deno.test("parseGkgDate wandelt das GKG-Format", () => {
  assertEquals(parseGkgDate("20260818091500"), "2026-08-18T09:15:00Z");
  assertEquals(parseGkgDate("kaputt"), null);
});

Deno.test("extractQuote nimmt nur brauchbar lange Zitate", () => {
  const kurz = "10|5|Sprecher|zu kurz";
  const gut = "10|5|Sprecher|" + "Das ist ein hinreichend langes Zitat aus dem Artikel, ".repeat(2);
  assertEquals(extractQuote(kurz), null);
  assert((extractQuote(gut) ?? "").length >= 60, "langes Zitat wird übernommen");
  assertEquals(extractQuote(""), null);
});

Deno.test("splitPlaceName und toIso2 arbeiten zusammen", () => {
  const p = splitPlaceName("Izmail, Odes'ka Oblast, Ukraine");
  assertEquals(p.name, "Izmail");
  assertEquals(toIso2(p.country), "UA");
  assertEquals(toIso2(splitPlaceName("Houston, Texas, United States").country), "US");
  assertEquals(toIso2("Nirgendwoland"), null);
});

Deno.test("encodeGeohash ist stabil und ortsgenau", () => {
  const zuerich = encodeGeohash(47.3769, 8.5417, 9);
  assertEquals(zuerich.length, 9);
  assertEquals(encodeGeohash(47.3769, 8.5417, 9), zuerich);
  assertEquals(encodeGeohash(47.3789, 8.5417, 9) === zuerich, false);
  assertEquals(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
});

// ---------------------------------------------------------------- Ganze Zeile
Deno.test("parseRow verarbeitet eine vollständige GKG-Zeile", () => {
  const cols = new Array(27).fill("");
  cols[1] = "20260818091500";
  cols[3] = "britainnews.net";
  cols[4] = "http://www.britainnews.net/news/279247436/russia-attacks-izmail-port";
  cols[7] = "ARMEDCONFLICT;MILITARY;WOUND";
  cols[10] = "4#Izmail, Odes'ka Oblast, Ukraine#UP#UP17#25024#45.3493#28.8408#-1040491#89";
  cols[15] = "-5.1948,0,5.19,5.19,25.97,0,144";
  cols[18] = "https://example.org/bild.jpg";
  cols[26] = "<PAGE_TITLE>Russian missiles hit Izmail port in southern Ukraine</PAGE_TITLE>";

  const r = parseRow(cols, false)!;
  assertEquals(r.title, "Russian missiles hit Izmail port in southern Ukraine");
  assertEquals(r.publishedAt, "2026-08-18T09:15:00Z");
  assertEquals(r.location!.fullName, "Izmail, Odes'ka Oblast, Ukraine");
  assertEquals(r.tone, -5.1948);
  assertEquals(r.image, "https://example.org/bild.jpg");
  assertEquals(categorise(r.themes).category, "conflict_war_peace");
});

Deno.test("parseRow verwirft Zeilen ohne Titel, URL oder Ort", () => {
  const leer = new Array(27).fill("");
  assertEquals(parseRow(leer, false), null);
  assertEquals(parseRow(["zu", "kurz"], false), null);
});

// ---------------------------------------------------------------- ZIP
// Der ZIP-Leser ist das riskanteste Stück: Er läuft nur auf Supabase, wo
// Fehlersuche mühsam ist. Deshalb hier ein selbst gebautes Archiv als Probe.

async function baueZip(dateiname: string, inhalt: string): Promise<ArrayBuffer> {
  const name = new TextEncoder().encode(dateiname);
  const roh = new TextEncoder().encode(inhalt);

  const komprimiert = new Uint8Array(
    await new Response(
      new Blob([roh]).stream().pipeThrough(
        new CompressionStream("deflate-raw") as unknown as ReadableWritablePair,
      ) as ReadableStream,
    ).arrayBuffer(),
  );

  const crc = crc32(roh);
  const lokal = new Uint8Array(30 + name.length);
  const lv = new DataView(lokal.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(4, 20, true);
  lv.setUint16(8, 8, true); // deflate
  lv.setUint32(14, crc, true);
  lv.setUint32(18, komprimiert.length, true);
  lv.setUint32(22, roh.length, true);
  lv.setUint16(26, name.length, true);
  lokal.set(name, 30);

  const zentral = new Uint8Array(46 + name.length);
  const zv = new DataView(zentral.buffer);
  zv.setUint32(0, 0x02014b50, true);
  zv.setUint16(10, 8, true);
  zv.setUint32(16, crc, true);
  zv.setUint32(20, komprimiert.length, true);
  zv.setUint32(24, roh.length, true);
  zv.setUint16(28, name.length, true);
  zv.setUint32(42, 0, true); // Offset des lokalen Kopfes
  zentral.set(name, 46);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, zentral.length, true);
  ev.setUint32(16, lokal.length + komprimiert.length, true);

  const out = new Uint8Array(lokal.length + komprimiert.length + zentral.length + eocd.length);
  let o = 0;
  for (const teil of [lokal, komprimiert, zentral, eocd]) {
    out.set(teil, o);
    o += teil.length;
  }
  return out.buffer;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

Deno.test("unzipLines entpackt ein Deflate-Archiv zeilenweise", async () => {
  const inhalt = "erste Zeile\r\nzweite Zeile\n\ndritte Zeile ohne Umbruch am Ende";
  const zip = await baueZip("test.csv", inhalt);
  const zeilen: string[] = [];
  for await (const z of unzipLines(zip)) zeilen.push(z);
  assertEquals(zeilen, ["erste Zeile", "zweite Zeile", "dritte Zeile ohne Umbruch am Ende"]);
});

Deno.test("unzipLines verkraftet lange Inhalte über mehrere Blöcke", async () => {
  const zeile = "Feld\tFeld\tFeld ".repeat(40);
  const inhalt = Array.from({ length: 2000 }, (_, i) => `${i}\t${zeile}`).join("\n");
  const zip = await baueZip("gross.csv", inhalt);
  let n = 0;
  let erste = "";
  for await (const z of unzipLines(zip)) {
    if (n === 0) erste = z;
    n++;
  }
  assertEquals(n, 2000);
  assertEquals(erste.startsWith("0\tFeld"), true);
});

Deno.test("readFirstEntry meldet unlesbare Archive", () => {
  let gefangen = false;
  try {
    readFirstEntry(new Uint8Array(100).buffer);
  } catch {
    gefangen = true;
  }
  assert(gefangen, "kaputtes Archiv muss einen Fehler auslösen");
});

Deno.test("categorise braucht mindestens einen starken Treffer", () => {
  // Der Whisky-Fall: mehrere beiläufige Nebenbegriffe, kein einziger Kernbegriff.
  // Früher reichten drei schwache Treffer für „Naturkatastrophen".
  const beilaeufig = ["CRISISLEX_CRISISLEXREC", "EVACUATION_PLAN", "DISPLACEMENT", "SHELTERS"];
  assertEquals(categorise(beilaeufig).category, "other");

  // Mit einem starken Treffer greift die Rubrik weiterhin
  assertEquals(
    categorise([...beilaeufig, "NATURAL_DISASTER_FLOOD"]).category,
    "disaster_accident",
  );
});
