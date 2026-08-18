// Fixture-Tests für die Teile, die ohne Netz und ohne Datenbank prüfbar sind.
//   deno test supabase/functions/ingest/

import { normaliseFeature, parseArticleLinks, parseSeendate } from "./gdelt.ts";
import { encodeGeohash } from "./geohash.ts";
import { splitPlaceName, toIso2 } from "./countries.ts";

/** Bewusst ohne externe Test-Bibliothek – hält die Function abhängigkeitsfrei. */
function assertEquals(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg ? msg + ": " : ""}erwartet ${b}, erhalten ${a}`);
  }
}

Deno.test("parseArticleLinks holt Titel und URL, ignoriert GDELT-eigene Links", () => {
  const html = `
    <b>Nairobi, Kenya</b><br>
    <a href="https://nation.africa/kenya/news/floods-displace-thousands" target="_blank">Floods displace thousands in Nairobi</a><br>
    <a href="https://www.gdeltproject.org/about.html">GDELT</a><br>
    <a href="https://bbc.com/news/world-africa-1234">Kenya braces for more rain &amp; storms</a>`;

  const links = parseArticleLinks(html);
  assertEquals(links.length, 2);
  assertEquals(links[0].url, "https://nation.africa/kenya/news/floods-displace-thousands");
  assertEquals(links[1].title, "Kenya braces for more rain & storms");
});

Deno.test("parseArticleLinks verkraftet leere Eingaben", () => {
  assertEquals(parseArticleLinks(null), []);
  assertEquals(parseArticleLinks(""), []);
  assertEquals(parseArticleLinks("<p>kein Link</p>"), []);
});

Deno.test("normaliseFeature liest GeoJSON-Punkte", () => {
  const f = {
    type: "Feature",
    geometry: { type: "Point", coordinates: [36.8219, -1.2921] },
    properties: {
      name: "Nairobi, Nairobi Area, Kenya",
      count: 17,
      shareimage: "https://example.org/bild.jpg",
      html: '<a href="https://nation.africa/a/b-c-d-e">Ein hinreichend langer Titel</a>',
    },
  };
  const p = normaliseFeature(f)!;
  assertEquals(p.lat, -1.2921);
  assertEquals(p.lon, 36.8219);
  assertEquals(p.count, 17);
  assertEquals(p.articles.length, 1);
});

Deno.test("normaliseFeature verwirft Nullinsel und kaputte Geometrien", () => {
  assertEquals(
    normaliseFeature({ geometry: { coordinates: [0, 0] }, properties: { name: "X" } }),
    null,
  );
  assertEquals(normaliseFeature({ properties: { name: "X" } }), null);
  assertEquals(
    normaliseFeature({ geometry: { coordinates: [10, 20] }, properties: {} }),
    null,
  );
});

Deno.test("splitPlaceName zerlegt GDELT-Ortsangaben", () => {
  assertEquals(splitPlaceName("Nairobi, Nairobi Area, Kenya"), {
    name: "Nairobi",
    admin1: "Nairobi Area",
    country: "Kenya",
  });
  assertEquals(splitPlaceName("Bern, Switzerland"), {
    name: "Bern",
    admin1: null,
    country: "Switzerland",
  });
  assertEquals(splitPlaceName("Kenya"), { name: "Kenya", admin1: null, country: "Kenya" });
});

Deno.test("toIso2 löst Standardnamen und GDELT-Eigenheiten auf", () => {
  assertEquals(toIso2("Switzerland"), "CH");
  assertEquals(toIso2("United States"), "US");
  assertEquals(toIso2("Russia"), "RU");
  assertEquals(toIso2("South Korea"), "KR");
  assertEquals(toIso2("Ivory Coast"), "CI");
  assertEquals(toIso2("Democratic Republic of the Congo"), "CD");
  assertEquals(toIso2("Türkiye"), "TR");
  assertEquals(toIso2("Nirgendwoland"), null);
  assertEquals(toIso2(null), null);
});

Deno.test("encodeGeohash ist stabil und ortsgenau", () => {
  const zurich = encodeGeohash(47.3769, 8.5417, 9);
  assertEquals(zurich.length, 9);
  assertEquals(encodeGeohash(47.3769, 8.5417, 9), zurich);
  // 200 m entfernt => anderer Hash
  assertEquals(encodeGeohash(47.3789, 8.5417, 9) === zurich, false);
  // Bekannter Referenzwert
  assertEquals(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
});

Deno.test("parseSeendate wandelt das GDELT-Format", () => {
  assertEquals(parseSeendate("20260818T124500Z"), "2026-08-18T12:45:00Z");
  assertEquals(parseSeendate("kaputt"), null);
});
