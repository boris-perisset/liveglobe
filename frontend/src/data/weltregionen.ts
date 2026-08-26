/**
 * Land → Weltregion.
 *
 * Gebraucht für den vierten Zähler des Replays: „hat die Meldung die
 * Weltregion gewechselt?" Ein Sprung von Frankreich nach Belgien ist keine
 * Verbreitung, ein Sprung von Frankreich nach Japan ist eine.
 *
 * **Grobheit ist hier Absicht.** Die Tabelle nimmt die fünf Makroregionen der
 * UN-Systematik M49, nicht deren 17 Unterregionen. Zwei Gründe: Erstens ist
 * das die Auflösung, die „Weltregion" umgangssprachlich meint. Zweitens sind
 * fünf Zuordnungen vollständig prüfbar, siebzehn wären es in dieser Form
 * nicht — und eine Tabelle, die an zwanzig Stellen still danebenliegt, ist
 * schlechter als eine grobe, die stimmt.
 *
 * Die Unterregionen sind der naheliegende Ausbau; die Struktur hier ändert
 * sich dafür nicht, nur die Gruppen werden mehr.
 *
 * Grenzfälle folgen M49 und nicht dem Gefühl: **Russland** zählt zu Europa
 * (Osteuropa), **Türkei** und **Zypern** zu Asien (Westasien), **Grönland** zu
 * Amerika. Wer das anders sieht, ändert eine Zeile — er soll nur wissen, dass
 * er von der Systematik abweicht.
 */

const GRUPPEN: Record<string, string> = {
  afrika:
    "DZ AO BJ BW BF BI CV CM CF TD KM CD CG CI DJ EG GQ ER SZ ET GA GM GH GN " +
    "GW KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD " +
    "TZ TG TN UG ZM ZW EH YT RE SH IO",
  amerika:
    "AG AR AW BS BB BZ BM BO BQ BR CA KY CL CO CR CU CW DM DO EC SV FK GF GL " +
    "GD GP GT GY HT HN JM MQ MX MS NI PA PY PE PR BL KN LC MF PM VC SX SR TT " +
    "TC US UY VE VG VI",
  asien:
    "AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG " +
    "LA LB MO MY MV MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE " +
    "UZ VN YE",
  europa:
    "AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE " +
    "XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH " +
    "UA GB VA AX",
  ozeanien:
    "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF",
};

/**
 * Aufgelöst beim Laden des Moduls, einmal. Die Schreibweise oben ist für
 * Menschen gedacht — nachschlagen soll eine Map.
 */
const NACH_LAND = new Map<string, string>();
for (const [region, laender] of Object.entries(GRUPPEN)) {
  for (const code of laender.split(/\s+/)) {
    if (code) NACH_LAND.set(code, region);
  }
}

/**
 * Weltregion eines Landes, oder `null`.
 *
 * `null` ist eine Antwort und keine Lücke: Ein Medium ohne Land wird gezählt,
 * aber es erhöht den Regionenzähler nicht. Ihm eine Region zuzuweisen, damit
 * die Zahl schöner aussieht, wäre eine Erfindung.
 */
export function weltregion(land: string | null | undefined): string | null {
  if (!land) return null;
  return NACH_LAND.get(land.toUpperCase()) ?? null;
}

/** Wie viele Weltregionen in dieser Ländermenge vorkommen. */
export function regionenZaehlen(laender: Iterable<string | null | undefined>): number {
  const gesehen = new Set<string>();
  for (const l of laender) {
    const r = weltregion(l);
    if (r) gesehen.add(r);
  }
  return gesehen.size;
}
