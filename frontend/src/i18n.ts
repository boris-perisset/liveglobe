/**
 * Oberflächensprache.
 *
 * **Englisch ist der Grundbestand, Deutsch die Übersetzung.** Das Projekt
 * richtet sich an Leute aus Medienhäusern weit über die Deutschschweiz hinaus;
 * eine deutschsprachige Oberfläche wäre dort eine unnötige Hürde.
 *
 * Kein Framework, kein Ladevorgang: zwei Objekte, ein `t()`. Bei rund
 * hundert Zeichenketten steht der Aufwand einer Bibliothek in keinem
 * Verhältnis, und beide Sprachen im selben Bündel zu haben heisst, dass das
 * Umschalten ohne Nachladen geschieht.
 *
 * Der Grundbestand ist zugleich die Rückfallebene: Fehlt ein deutscher
 * Eintrag, erscheint der englische. Eine fehlende Übersetzung darf nie eine
 * leere Stelle in der Oberfläche hinterlassen.
 */

export type UiLang = "en" | "de";

const en = {
  "app.claim": "News where it happens",
  "app.description":
    "A spinning globe of current news, placed where the events happen.",

  "nav.settings": "Settings",
  "nav.settingsClose": "Close settings",
  "nav.info": "About this project",
  "nav.close": "Close",
  "nav.globe": "Globe with news markers",

  "filter.all": "All",
  "filter.aria": "Filter by topic",

  "status.loading": "Loading reports …",
  "status.noSources": "All sources switched off — nothing to show.",
  "status.empty": "No reports in this time window.",
  "status.summary": "{reports} · {events}",
  "status.demo": "demo data",
  "status.error": "Could not load data.",
  "status.mapFallback": "Base map unreachable — markers show, countries don't.",

  "panel.aria": "Reports at this location",
  "panel.loading": "Loading reports …",
  "panel.empty": "No reports in this time window.",
  "panel.error": "Details unavailable",
  "panel.noEvent": "Not assigned to an event",
  "panel.toArticle": "Read the article →",
  "panel.translated": "translated",
  "panel.unrated": "not rated",
  "panel.unknownSource": "Unknown source",
  "panel.andMore": "and {n} more",

  "count.outlet": "{n} outlet",
  "count.outlets": "{n} outlets",
  "count.report": "{n} report",
  "count.reports": "{n} reports",
  "count.event": "{n} event",
  "count.events": "{n} events",
  "span.withinHour": "within one hour",
  "span.over": "over {text}",

  "time.minAgo": "{n} min ago",
  "time.hoursAgo": "{n} h ago",
  "time.hours": "{n} h",
  "time.days": "{n} d",

  "settings.title": "Settings",
  "settings.sources": "Sources",
  "settings.sourcesHint":
    "Where reports come from. Switching a stream off removes it from the globe at once.",
  "settings.language": "Language",
  "settings.languageHint":
    "Sets the interface language and, if enabled below, the language headlines are translated into.",
  "settings.translate": "Translate headlines",
  "settings.translateHintOk":
    "Translated on your own device — no text is sent to anyone else.",
  "settings.translateHintNo":
    "Headlines stay in their original language. Translation runs on the device itself, which so far only Chrome and Edge on a computer can do — not the browsers on phones and tablets.",
  "settings.ownership": "Who owns the outlet",
  "settings.ownershipHint":
    "Who stands behind a source. Only a small share is classified so far — switching off «Not classified» therefore hides a great deal.",
  "settings.tagPlanned": "planned",
  "settings.tagNoApi": "no interface",

  "time.pick": "Choose a moment",
  "time.pickDate": "Choose a date",
  "time.windowAria": "Time window",
  "time.now": "Now",
  "time.window1": "1 h",
  "time.window6": "6 h",
  "time.window24": "24 h",
  "time.window72": "3 days",

  "bias.-3": "far left",
  "bias.-2": "left",
  "bias.-1": "leans left",
  "bias.0": "centre",
  "bias.1": "leans right",
  "bias.2": "right",
  "bias.3": "far right",

  "ownership.state": "state controlled",
  "ownership.public": "public service",
  "ownership.private": "privately owned",
  "ownership.nonprofit": "non-profit",
  "ownership.unknown": "ownership unknown",

  "category.natural_disasters": "Natural disasters",
  "category.conflicts": "Conflict",
  "category.peace_talks": "Peace talks",
  "category.politics": "Politics",
  "category.diplomacy": "Diplomacy",
  "category.accidents": "Accidents",
  "category.sports": "Sport",
  "category.culture": "Culture",
  "category.art": "Art",
  "category.weather": "Weather",
  "category.nature": "Nature & environment",
  "category.other": "Other",


  // ---------------------------------------------------------------- Overlay
  "info.title": "About this project",
  "info.lead1":
    "Live Globe shows where news comes from — and how far it travels. Rather than being another news aggregator, it makes the movement of attention through the media landscape visible: who reports, who stays silent, and when a story crosses a border or a language.",
  "info.lead2":
    "This is a prompt for thought, not a research instrument. Assigning reports to places, topics and events remains an estimate — which is why every marker leads to the original source, so you can look for yourself. Article contents are not stored, only metadata and links.",

  "info.inspiration.h": "Where the idea comes from",
  "info.inspiration.p1":
    "The starting point is <a href=\"https://radio.garden/\" target=\"_blank\" rel=\"noopener\">radio.garden</a> — a globe with radio stations standing where they broadcast. I cite it regularly in my UX/UI teaching as an example of how much a representation can achieve beyond listing the data. The same stations in a table would be a directory. On the globe they become an experience of nearness and distance: you turn the sphere and hear how far away the world sounds.",
  "info.inspiration.p2":
    "Live Globe carries that idea over to the news. Radio stations become media outlets, the broadcast area becomes the place where something happened. The question behind it stays the same — what does a map show that a list cannot?",

  "info.responsible.h": "Responsible",
  "info.responsible.p":
    '<a href="https://atelier-perisset.ch/" target="_blank" rel="noopener">Boris Périsset</a>' +
    " · concept, design and implementation.",

  "info.thanks.h": "This site would not exist without these projects",
  "info.thanks.intro":
    "Everything here rests on work that others made freely available — often over years and mostly unpaid. Warm thanks to everyone involved.",

  "info.h.data": "Data",
  "info.h.map": "Map",
  "info.h.tools": "Tools",
  "info.h.font": "Typeface",

  "info.d.gdelt": "Reports, places and topics · free for non-commercial use",
  "info.d.osm": "Map data · © OpenStreetMap contributors, ODbL 1.0",
  "info.d.naturalearth": "Country borders · public domain",
  "info.d.iptc": "Topic taxonomy · CC BY 4.0",
  "info.d.mediacloud":
    "Register of media outlets — country, region, language and publishing frequency. An academic undertaking with open access; the API client is Apache 2.0.",
  "info.d.wikidata": "Editorial addresses of media outlets · CC0 1.0",
  "info.d.nominatim":
    "Place search when locating newsrooms · © OpenStreetMap contributors, ODbL 1.0",
  "info.d.geonames": "Place resolution · CC BY 4.0",
  "info.d.maplibre": "Globe and map rendering · BSD-3-Clause",
  "info.d.openfreemap": "Vector tiles, free and without a key · donated by Zsolt Ero",
  "info.d.openmaptiles": "Tile schema and base style · BSD-3-Clause",
  "info.d.postgres": "Storage and geo queries · PostgreSQL licence, GPL-2.0-or-later",
  "info.d.supabase": "Database, API and scheduling · Apache-2.0",
  "info.d.deno": "Runtime of the data fetcher · MIT",
  "info.d.vite": "Build and language of the frontend · MIT, Apache-2.0",
  "info.d.nohemi":
    "Designed by Rajesh Rajput and released as freeware — free to use for private and commercial projects alike. The font files themselves may not be modified; every right beyond use stays with the designer. It carries the entire look of this site, and for that he deserves his own thanks.",

  "info.license.h": "Licence",
  "info.license.p1":
    "The source code is under the <strong>MIT licence</strong>, copyright © 2026 Boris Périsset. Reuse, modification and redistribution are permitted as long as the copyright notice is kept.",
  "info.license.p2":
    "Excluded are the typeface and the third-party data named above — they keep their own terms. Nohemi is freeware and may be taken along, but not altered. Linked news content remains the property of the respective outlet.",
  "info.license.repo": "Source code and full licence on GitHub",
  "info.foot": "No cookies, no tracking, no user accounts.",

  "events.count": "{n} events",
  "events.unknownPlace": "Unknown location",
  "events.placeAndOthers": "{place} and others",
};

/**
 * Deutsch. Schweizer Schreibung: ss statt ß, «» als Anführungszeichen.
 */
const de: Partial<Record<keyof typeof en, string>> = {
  "app.claim": "Nachrichten dort, wo sie passieren",
  "app.description":
    "Ein drehbarer Globus mit aktuellen Nachrichten, verortet dort, wo sie passieren.",

  "nav.settings": "Einstellungen",
  "nav.settingsClose": "Einstellungen schliessen",
  "nav.info": "Über dieses Projekt",
  "nav.close": "Schliessen",
  "nav.globe": "Weltkugel mit Nachrichten-Pins",

  "filter.all": "Alle",
  "filter.aria": "Rubriken filtern",

  "status.loading": "Lade Meldungen …",
  "status.noSources": "Alle Quellen abgewählt — nichts anzuzeigen.",
  "status.empty": "Keine Meldungen in diesem Zeitfenster.",
  "status.summary": "{reports} · {events}",
  "status.demo": "Demodaten",
  "status.error": "Daten konnten nicht geladen werden.",
  "status.mapFallback": "Basiskarte nicht erreichbar — Pins stehen, Länder fehlen.",

  "panel.aria": "Meldungen an diesem Ort",
  "panel.loading": "Lade Meldungen …",
  "panel.empty": "Keine Meldungen in diesem Zeitfenster.",
  "panel.error": "Details nicht ladbar",
  "panel.noEvent": "Ohne Ereigniszuordnung",
  "panel.toArticle": "Zum Artikel →",
  "panel.translated": "übersetzt",
  "panel.unrated": "nicht eingestuft",
  "panel.unknownSource": "Unbekannte Quelle",
  "panel.andMore": "und {n} weitere",

  "count.outlet": "{n} Medium",
  "count.outlets": "{n} Medien",
  "count.report": "{n} Meldung",
  "count.reports": "{n} Meldungen",
  "count.event": "{n} Ereignis",
  "count.events": "{n} Ereignisse",
  "span.withinHour": "innert einer Stunde",
  "span.over": "über {text}",

  "time.minAgo": "vor {n} Min.",
  "time.hoursAgo": "vor {n} Std.",
  "time.hours": "{n} Std.",
  "time.days": "{n} Tage",

  "settings.title": "Einstellungen",
  "settings.sources": "Quellen",
  "settings.sourcesHint":
    "Woher die Meldungen kommen. Abgewählte Ströme verschwinden sofort vom Globus.",
  "settings.language": "Sprache",
  "settings.languageHint":
    "Bestimmt die Sprache der Oberfläche und, wenn unten eingeschaltet, in welche Sprache Schlagzeilen übersetzt werden.",
  "settings.translate": "Schlagzeilen übersetzen",
  "settings.translateHintOk":
    "Übersetzt auf deinem Gerät, ohne dass Texte an Dritte gehen.",
  "settings.translateHintNo":
    "Die Meldungen bleiben in der Originalsprache. Übersetzt wird auf dem Gerät selbst — das können bisher nur Chrome und Edge auf dem Computer, nicht die Browser auf Telefon und Tablet.",
  "settings.ownership": "Trägerschaft der Medien",
  "settings.ownershipHint":
    "Wer hinter einer Quelle steht. Eingestuft ist bislang nur ein kleiner Teil — «Nicht eingestuft» abzuwählen blendet deshalb sehr viel aus.",
  "settings.tagPlanned": "geplant",
  "settings.tagNoApi": "keine Schnittstelle",

  "time.pick": "Zeitpunkt wählen",
  "time.pickDate": "Datum wählen",
  "time.windowAria": "Zeitfenster",
  "time.now": "Jetzt",
  "time.window1": "1 Std.",
  "time.window6": "6 Std.",
  "time.window24": "24 Std.",
  "time.window72": "3 Tage",

  "bias.-3": "weit links",
  "bias.-2": "links",
  "bias.-1": "eher links",
  "bias.0": "Mitte",
  "bias.1": "eher rechts",
  "bias.2": "rechts",
  "bias.3": "weit rechts",

  "ownership.state": "staatlich kontrolliert",
  "ownership.public": "öffentlich-rechtlich",
  "ownership.private": "privatwirtschaftlich",
  "ownership.nonprofit": "gemeinnützig",
  "ownership.unknown": "Trägerschaft unbekannt",

  "category.natural_disasters": "Naturkatastrophen",
  "category.conflicts": "Konflikte",
  "category.peace_talks": "Friedensgespräche",
  "category.politics": "Politik",
  "category.diplomacy": "Diplomatie",
  "category.accidents": "Unfälle",
  "category.sports": "Sport",
  "category.culture": "Kultur",
  "category.art": "Kunst",
  "category.weather": "Wetter",
  "category.nature": "Natur & Umwelt",
  "category.other": "Übriges",


  // ---------------------------------------------------------------- Overlay
  "info.title": "Über dieses Projekt",
  "info.lead1":
    "Live Globe zeigt, wo Nachrichten herkommen — und wie weit sie reisen. Statt eine weitere Nachrichtensammlung zu sein, macht die Seite die Bewegung von Aufmerksamkeit durch die Medienlandschaft sichtbar: wer berichtet, wer schweigt, und wann eine Meldung Länder- und Sprachgrenzen überschreitet.",
  "info.lead2":
    "Das ist ein Denkanstoss, keine Forschungsarbeit. Die Zuordnung von Meldungen zu Orten, Rubriken und Ereignissen bleibt eine Schätzung — jeder Pin führt deshalb zur Originalquelle, damit man selbst nachsehen kann. Artikelinhalte werden nicht gespeichert, nur Metadaten und Links.",

  "info.inspiration.h": "Inspiration",
  "info.inspiration.p1":
    "Der Ausgangspunkt ist <a href=\"https://radio.garden/\" target=\"_blank\" rel=\"noopener\">radio.garden</a> — eine Weltkugel, auf der Radiostationen dort stehen, wo sie senden. Ich zitiere die Seite regelmässig in meinem UX/UI-Unterricht als Beispiel dafür, wie viel eine Darstellung leisten kann, die über das Auflisten der Daten hinausgeht. Dieselben Sender in einer Tabelle wären ein Verzeichnis. Auf dem Globus werden sie zu einer Erfahrung von Nähe und Entfernung: Man dreht die Kugel und hört, wie weit weg die Welt klingt.",
  "info.inspiration.p2":
    "Live Globe überträgt diesen Gedanken auf Nachrichten. Aus Radiostationen werden Medienhäuser, aus dem Sendegebiet der Ort des Geschehens. Die Frage dahinter bleibt dieselbe — was zeigt eine Karte, das eine Liste nicht zeigen kann?",

  "info.responsible.h": "Verantwortlich",
  "info.responsible.p":
    '<a href="https://atelier-perisset.ch/" target="_blank" rel="noopener">Boris Périsset</a>' +
    " · Konzept, Gestaltung und Umsetzung.",

  "info.thanks.h": "Ohne diese Projekte gäbe es die Seite nicht",
  "info.thanks.intro":
    "Alles hier steht auf Arbeit, die andere frei zugänglich gemacht haben — oft über Jahre und meist unbezahlt. Dafür einen herzlichen Dank an alle Beteiligten.",

  "info.h.data": "Daten",
  "info.h.map": "Karte",
  "info.h.tools": "Werkzeuge",
  "info.h.font": "Schrift",

  "info.d.gdelt": "Meldungen, Orte und Themen · frei für nicht-kommerzielle Nutzung",
  "info.d.osm": "Kartendaten · © OpenStreetMap-Mitwirkende, ODbL 1.0",
  "info.d.naturalearth": "Ländergrenzen · Public Domain",
  "info.d.iptc": "Rubriken-Taxonomie · CC BY 4.0",
  "info.d.mediacloud":
    "Register der Medienhäuser — Land, Region, Sprache und Erscheinungshäufigkeit. Ein akademisches Vorhaben mit offenem Zugang; der API-Client steht unter Apache 2.0.",
  "info.d.wikidata": "Redaktionssitze der Medienhäuser · CC0 1.0",
  "info.d.nominatim":
    "Ortssuche beim Verorten von Redaktionen · © OpenStreetMap-Mitwirkende, ODbL 1.0",
  "info.d.geonames": "Ortsauflösung · CC BY 4.0",
  "info.d.maplibre": "Globus und Kartendarstellung · BSD-3-Clause",
  "info.d.openfreemap": "Vektorkacheln, gratis und ohne Schlüssel · gestiftet von Zsolt Ero",
  "info.d.openmaptiles": "Kachelschema und Basisstil · BSD-3-Clause",
  "info.d.postgres": "Datenhaltung und Geo-Abfragen · PostgreSQL-Lizenz, GPL-2.0-or-later",
  "info.d.supabase": "Datenbank, API und Zeitsteuerung · Apache-2.0",
  "info.d.deno": "Laufzeitumgebung des Datenabrufs · MIT",
  "info.d.vite": "Bau und Sprache des Frontends · MIT, Apache-2.0",
  "info.d.nohemi":
    "Gestaltet von Rajesh Rajput und als Freeware herausgegeben — frei nutzbar für private wie kommerzielle Projekte. Die Schriftdateien selbst dürfen nicht verändert werden; alle Rechte ausser dem Nutzungsrecht bleiben beim Gestalter. Sie trägt hier das ganze Erscheinungsbild, und dafür gebührt ihm ein eigener Dank.",

  "info.license.h": "Lizenz",
  "info.license.p1":
    "Der Quellcode steht unter der <strong>MIT-Lizenz</strong>, Copyright © 2026 Boris Périsset. Weiterverwenden, ändern und weitergeben ist erlaubt, solange der Urhebervermerk erhalten bleibt.",
  "info.license.p2":
    "Ausgenommen sind die Schrift und die oben genannten Fremddaten — sie behalten ihre eigenen Bedingungen. Nohemi ist Freeware und darf mitgenommen werden, aber nicht verändert. Verlinkte Nachrichteninhalte bleiben Eigentum des jeweiligen Mediums.",
  "info.license.repo": "Quellcode und vollständige Lizenz auf GitHub",
  "info.foot": "Keine Cookies, kein Tracking, keine Nutzerkonten.",

  "events.count": "{n} Ereignisse",
  "events.unknownPlace": "Unbekannter Ort",
  "events.placeAndOthers": "{place} u. a.",
};

export type TextKey = keyof typeof en;

const SPEICHER = "globenews.uilang";

function erkennen(): UiLang {
  // Nur ein deutschsprachiger Browser bekommt Deutsch. `navigator.languages`
  // ist die geordnete Wunschliste; die erste Angabe zählt.
  const wunsch = navigator.languages?.[0] ?? navigator.language ?? "en";
  return wunsch.toLowerCase().startsWith("de") ? "de" : "en";
}

let aktuell: UiLang = (() => {
  try {
    const g = localStorage.getItem(SPEICHER);
    if (g === "en" || g === "de") return g;
  } catch {
    // Privater Modus – dann eben jedes Mal neu erkennen.
  }
  return erkennen();
})();

export function lang(): UiLang {
  return aktuell;
}

/**
 * Gebietsschema für `toLocaleString`.
 *
 * Für Deutsch bewusst `de-CH` und nicht `de-DE`: Datumstrennung mit Punkt,
 * und die Seite kommt aus der Schweiz. Englisch bekommt `en-GB` — Tag vor
 * Monat, wie im übrigen Europa, sonst läse sich der 8. Dezember als
 * 12. August.
 */
export function locale(): string {
  return aktuell === "de" ? "de-CH" : "en-GB";
}

export function setLang(l: UiLang) {
  aktuell = l;
  try {
    localStorage.setItem(SPEICHER, l);
  } catch {
    /* siehe oben */
  }
  document.documentElement.lang = l;
}

/**
 * Text zu einer Kennung, mit Platzhaltern der Form `{name}`.
 *
 * Fehlt der deutsche Eintrag, kommt der englische — nie eine leere Stelle.
 */
export function t(key: TextKey, werte?: Record<string, string | number>): string {
  const roh = (aktuell === "de" ? de[key] : undefined) ?? en[key] ?? key;
  if (!werte) return roh;
  return roh.replace(/\{(\w+)\}/g, (treffer, name: string) =>
    name in werte ? String(werte[name]) : treffer
  );
}

/** Ein/Mehrzahl in einem Aufruf – die beiden Kennungen unterscheiden sich nur im Suffix. */
export function tn(einzahl: TextKey, mehrzahl: TextKey, n: number): string {
  return t(n === 1 ? einzahl : mehrzahl, { n });
}

/**
 * Alle mit `data-i18n` ausgezeichneten Stellen im Markup nachziehen.
 *
 * Das Markup trägt den englischen Text im Klartext — es bleibt damit ohne
 * Werkzeug lesbar und ist zugleich die Rückfallebene, falls das Skript nicht
 * läuft. Übersetzt wird erst danach.
 *
 * `data-i18n-html` gibt es für die wenigen Sätze mit eingebettetem Verweis;
 * dort steht Markup in der Zeichenkette. Diese Texte stammen ausschliesslich
 * von uns, nie von aussen.
 */
export function uebersetzeMarkup(wurzel: ParentNode = document) {
  for (const el of wurzel.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n as TextKey);
  }
  for (const el of wurzel.querySelectorAll<HTMLElement>("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml as TextKey);
  }
  for (const el of wurzel.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    // Form: "aria-label:nav.settings" – mehrere durch Komma getrennt
    for (const paar of el.dataset.i18nAttr!.split(",")) {
      const [attr, key] = paar.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key as TextKey));
    }
  }
  const titel = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (titel) titel.content = t("app.description");
}

setLang(aktuell);
