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
  "nav.beta": "Beta — how the data is gathered, and what that costs",

  "filter.all": "All",
  "filter.aria": "Filter by topic",

  // Was ein Klick auf eine Bubble tut. Steht als Titel und als Vorlesetext an
  // der Bubble selbst — der Ring zeigt es, diese Zeile sagt es.
  "map.group": "{n} events – zoom in",
  "map.single": "open reports",

  // Die Leiste unter den Rubriken: die Ereignisse mit der weitesten belegbaren
  // Verbreitung. Gezählt werden Medien mit Koordinate — also Bögen.
  "replays.label": "Widest spread",
  "replays.aria": "Events worth replaying",

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

  // Replay — die Verbreitung eines Ereignisses als Ablauf. Siehe
  // EREIGNISMODELL.md §4: Ein Fächer sagt „zwölf Medien", das Replay sagt, ob
  // die zwölf in zwanzig Minuten kamen oder über zwei Tage.
  "replay.open": "Replay",
  "replay.aria": "Replay: how this event spread",
  "replay.play": "Play",
  "replay.pause": "Pause",
  "replay.again": "Play again",
  "replay.close": "Close replay",
  "replay.outlets": "outlets",
  "replay.countries": "countries",
  "replay.languages": "languages",
  "replay.regions": "world regions",
  "replay.loading": "Loading arcs …",
  "replay.none": "No outlet of this event has a location yet.",
  "replay.noSeat": "{n} more counted — newsroom unknown, so not drawn",
  "replay.geoLand": "{n} sit on a country centre, not on a newsroom.",
  "replay.geoRegion": "{n} sit on a region centre.",

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
  "ownership.state.note": "Government sets leadership or editorial line",
  "ownership.public.note": "Licence-fee funded, editorially independent",
  "ownership.private.note": "Publisher or group in private hands",
  "ownership.nonprofit.note": "Foundation, cooperative, donation-funded",
  "ownership.unknown.note": "Not yet checked — applies to the vast majority",

  // Quellen. `data/connectors.json` beschreibt Struktur (Kennung, Zustand),
  // nicht Sprache — die Beschriftungen gehören hierher.
  "connector.gdelt-en": "GDELT · English",
  "connector.gdelt-en.note":
    "Raw data every 15 minutes, around 850 articles per run. Locations taken straight from the article text.",
  "connector.gdelt-tr": "GDELT · 64 further languages",
  "connector.gdelt-tr.note":
    "Machine-translated stream, around 3,100 articles per run. Carries most of the coverage outside the English-speaking world.",
  "connector.rss": "Own press register",
  "connector.rss.note":
    "Curated feeds per country, for regions where GDELT is thin. In progress.",

  "category.conflict_war_peace": "Conflict, war & peace",
  "category.disaster_accident": "Disaster & accident",
  "category.weather": "Weather",
  "category.environment": "Environment",
  "category.crime_law": "Crime, law & justice",
  "category.health": "Health",
  "category.science_technology": "Science & technology",
  "category.education": "Education",
  "category.economy_business": "Economy & business",
  "category.labour": "Labour",
  "category.politics": "Politics",
  "category.society": "Society",
  "category.religion": "Religion",
  "category.arts_culture": "Arts, culture & media",
  "category.sport": "Sport",
  "category.lifestyle_leisure": "Lifestyle & leisure",
  "category.human_interest": "Human interest",
  "category.other": "Unassigned",


  // ---------------------------------------------------------------- Overlay
  "info.title": "About this project",
  "info.lead1":
    "Live Globe shows where news is made — and how far it travels. It makes the movement of attention visible: who reports, who stays silent, and when a story crosses a border or a language.",
  "info.lead2":
    "This is a thinking tool, for me as much as for anyone who uses it. Placing a report on a location, a topic and an event stays an approximation. Every marker leads to the original source, so you can look for yourself. Article texts are never stored here — only linked.",

  "info.beta.h": "Beta — how the data is gathered, and what that costs",
  "info.beta.intro":
    "Live Globe is a prototype. The way it collects news takes deliberate shortcuts, and those shortcuts leave marks on the globe. Better to name them than to let them pass as findings.",
  "info.beta.method1":
    "<strong>It is a sample, not a complete picture.</strong> Every 15 minutes we read what GDELT has seen across 65 languages — but we keep only a handful of stories per country per round. Without that limit the United States and Britain would fill half the globe and the rest would stay dark. The price is that a lot of real reporting never appears here.",
  "info.beta.method2":
    "<strong>We forget quickly.</strong> Article details are deleted after eight days. What stays is much smaller: which newsroom reported which event, and when. That is enough to replay how a story travelled, months later, without keeping anyone\u2019s text.",
  "info.beta.method3":
    "<strong>The grouping is done by software.</strong> Whether two reports describe the same event is decided from place, time, wording and names. That is an estimate, not a judgement.",
  "info.beta.folgeH": "What follows from it",
  "info.beta.folge1":
    "<strong>A quiet country may be quiet for two very different reasons</strong> — little is reported there, or we have not found its newsrooms yet. You cannot tell the two apart by looking, and neither can we.",
  "info.beta.folge2":
    "Some newsroom markers sit in the middle of a country instead of at an address, because that is all we know about them.",
  "info.beta.folge3":
    "Some sources are not newsrooms at all, but sites that republish other people\u2019s articles. We are sorting them out one by one.",
  "info.beta.folge4":
    "One large event sometimes appears as several small ones, because the software did not notice they belong together.",
  "info.beta.folge5":
    "A few entries are simply wrong — a wrong name, a wrong country.",
  "info.beta.schluss":
    "We would rather show you the gaps than pretend they are not there.",

  "info.inspiration.h": "Where the idea comes from",
  "info.inspiration.p1":
    "A globe makes a remarkable interface, and <a href=\"https://radio.garden\" target=\"_blank\" rel=\"noopener\">radio.garden</a> uses it beautifully: radio stations appear at the place they broadcast from. I use it regularly in my UX/UI teaching as an example of how much the right representation can do beyond simply listing data. A globe makes nearness and distance tangible — you turn it and meet the time zone, the language, the rhythm of another country. All twenty-four hours are happening right now.",
  "info.inspiration.p2":
    "Live Globe carries that idea over to the news. Putting an event on the map makes it immediate. The question behind it stays the same: what does a map show that a list cannot? What does the picture carry that is more than the sum of its parts?",

  "info.responsible.h": "Responsible",
  "info.responsible.p":
    '<a href="https://www.atelier-perisset.ch" target="_blank" rel="noopener">Boris Périsset</a>' +
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
  "nav.beta": "Beta — wie die Daten entstehen, und was das kostet",

  "filter.all": "Alle",
  "filter.aria": "Rubriken filtern",

  "map.group": "{n} Ereignisse – näher heran",
  "map.single": "Meldungen öffnen",

  "replays.label": "Weiteste Verbreitung",
  "replays.aria": "Ereignisse, deren Replay sich lohnt",

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

  "replay.open": "Replay",
  "replay.aria": "Replay: wie sich dieses Ereignis verbreitet hat",
  "replay.play": "Abspielen",
  "replay.pause": "Pause",
  "replay.again": "Nochmal",
  "replay.close": "Replay schliessen",
  "replay.outlets": "Medien",
  "replay.countries": "Länder",
  "replay.languages": "Sprachen",
  "replay.regions": "Weltregionen",
  "replay.loading": "Lade Bögen …",
  "replay.none": "Für dieses Ereignis ist noch kein Medium verortet.",
  "replay.noSeat": "{n} weitere mitgezählt — Sitz unbekannt, deshalb nicht gezeichnet",
  "replay.geoLand": "{n} sitzen auf einer Landesmitte, nicht auf einer Redaktion.",
  "replay.geoRegion": "{n} sitzen auf einer Regionsmitte.",

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
  "ownership.state.note": "Regierung bestimmt Leitung oder Linie",
  "ownership.public.note": "Gebührenfinanziert, redaktionell unabhängig",
  "ownership.private.note": "Verlag oder Konzern in Privatbesitz",
  "ownership.nonprofit.note": "Stiftung, Genossenschaft, Spendenfinanzierung",
  "ownership.unknown.note": "Noch nicht geprüft – betrifft die grosse Mehrheit",

  "connector.gdelt-en": "GDELT · englischsprachig",
  "connector.gdelt-en.note":
    "Rohdaten alle 15 Minuten, rund 850 Artikel je Lauf. Ortsangaben direkt aus dem Artikeltext.",
  "connector.gdelt-tr": "GDELT · 64 weitere Sprachen",
  "connector.gdelt-tr.note":
    "Maschinell übersetzter Strom, rund 3'100 Artikel je Lauf. Trägt den grössten Teil der Abdeckung ausserhalb des englischen Sprachraums.",
  "connector.rss": "Eigenes Presseregister",
  "connector.rss.note":
    "Kuratierte Feeds pro Land, für Regionen mit dünner GDELT-Abdeckung. In Arbeit.",

  "category.conflict_war_peace": "Konflikt & Frieden",
  "category.disaster_accident": "Katastrophen & Unfälle",
  "category.weather": "Wetter",
  "category.environment": "Umwelt",
  "category.crime_law": "Kriminalität & Justiz",
  "category.health": "Gesundheit",
  "category.science_technology": "Wissenschaft & Technik",
  "category.education": "Bildung",
  "category.economy_business": "Wirtschaft",
  "category.labour": "Arbeit",
  "category.politics": "Politik",
  "category.society": "Gesellschaft",
  "category.religion": "Religion",
  "category.arts_culture": "Kultur & Medien",
  "category.sport": "Sport",
  "category.lifestyle_leisure": "Lifestyle & Freizeit",
  "category.human_interest": "Menschliches",
  "category.other": "Übriges",


  // ---------------------------------------------------------------- Overlay
  "info.title": "Über dieses Projekt",
  "info.lead1":
    "Live Globe zeigt, wo Nachrichten entstehen – und wohin sie reisen. Die Bewegung von Aufmerksamkeit in der Medienlandschaft wird sichtbar: wer berichtet, wer schweigt, und wann ein Ereignis eine Landes- oder Sprachgrenze überschreitet.",
  "info.lead2":
    "Das ist ein Denkanstoss – für mich selbst und für alle, die ihn nutzen. Die Zuordnung von Meldungen zu Orten, Themen und Ereignissen bleibt eine Annäherung. Jede Markierung führt zur Originalquelle, damit du selbst nachschauen kannst. Die Inhalte der Artikel werden nicht gespeichert, sondern nur verlinkt.",

  "info.beta.h": "Beta — wie die Daten entstehen, und was das kostet",
  "info.beta.intro":
    "Live Globe ist ein Prototyp. Die Art, wie hier Nachrichten gesammelt werden, nimmt bewusst Abkürzungen – und die hinterlassen Spuren auf der Kugel. Besser, sie zu benennen, als sie als Befund durchgehen zu lassen.",
  "info.beta.method1":
    "<strong>Es ist eine Stichprobe, kein vollständiges Bild.</strong> Alle 15 Minuten lesen wir, was GDELT in 65 Sprachen gesehen hat – behalten aber nur eine Handvoll Meldungen pro Land und Durchgang. Ohne diese Grenze füllten die USA und Grossbritannien die halbe Kugel, und der Rest bliebe dunkel. Der Preis: Viel echte Berichterstattung taucht hier nie auf.",
  "info.beta.method2":
    "<strong>Wir vergessen schnell.</strong> Acht Tage nach dem Erscheinen verschwinden die Artikelangaben. Was bleibt, ist viel kleiner: welche Redaktion wann über welches Ereignis berichtet hat. Das genügt, um Monate später nachzuspielen, wie eine Nachricht um die Welt gewandert ist – ohne den Text von irgendjemandem aufzubewahren.",
  "info.beta.method3":
    "<strong>Die Bündelung macht eine Software.</strong> Ob zwei Meldungen dasselbe Ereignis beschreiben, entscheidet sie aus Ort, Zeit, Wortwahl und Namen. Das ist eine Schätzung, kein Urteil.",
  "info.beta.folgeH": "Was daraus folgt",
  "info.beta.folge1":
    "<strong>Ein stummes Land kann aus zwei sehr verschiedenen Gründen stumm sein</strong> – weil dort wenig berichtet wird, oder weil wir seine Redaktionen noch nicht gefunden haben. Von aussen sieht man den Unterschied nicht. Wir übrigens auch nicht.",
  "info.beta.folge2":
    "Manche Redaktionen sitzen in der Mitte ihres Landes statt an einer Adresse, weil wir mehr nicht über sie wissen.",
  "info.beta.folge3":
    "Manche Quellen sind gar keine Redaktionen, sondern Seiten, die fremde Artikel weiterverbreiten. Wir sortieren sie nach und nach aus.",
  "info.beta.folge4":
    "Ein grosses Ereignis erscheint manchmal als mehrere kleine, weil die Software nicht gemerkt hat, dass sie zusammengehören.",
  "info.beta.folge5":
    "Ein paar Einträge sind schlicht falsch – ein falscher Name, ein falsches Land.",
  "info.beta.schluss":
    "Uns ist lieber, die Lücken zu zeigen, als so zu tun, als gäbe es sie nicht.",

  "info.inspiration.h": "Woher die Idee kommt",
  "info.inspiration.p1":
    "Die Weltkugel als Oberfläche ist ein äusserst eindrückliches Objekt, und <a href=\"https://radio.garden\" target=\"_blank\" rel=\"noopener\">radio.garden</a> nutzt sie wunderbar: Dort erscheinen Radiosender an dem Ort, von dem aus sie senden. Ich verwende radio.garden regelmässig in meinem UX/UI-Unterricht als Beispiel dafür, wie viel die richtige Darstellung über die blosse Auflistung von Daten hinaus leisten kann. Mit dem Globus werden Nähe und Distanz erfahrbar: Man dreht die Kugel und lernt die Zeitzone, die Sprache, den Rhythmus eines anderen Landes kennen. 24 Stunden sind jetzt.",
  "info.inspiration.p2":
    "Live Globe überträgt diese Idee auf die Nachrichten. Die geografische Verortung macht Ereignisse unmittelbar. Die Frage dahinter bleibt dieselbe: Was zeigt eine Karte, was eine Liste nicht zeigen kann? Was vermittelt die visuelle Darstellung, das mehr ist als die Summe ihrer Teile?",

  "info.responsible.h": "Verantwortlich",
  "info.responsible.p":
    '<a href="https://www.atelier-perisset.ch" target="_blank" rel="noopener">Boris Périsset</a>' +
    " · Konzept, Design und Umsetzung.",

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
