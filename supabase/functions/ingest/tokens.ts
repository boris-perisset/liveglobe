/**
 * Vergleichsmaterial für die Ereigniszuordnung.
 *
 * Zwei Signale, weil sie verschiedene Schwächen haben:
 *
 *  - **Titelwörter** sind dicht und billig, versagen aber über Sprachgrenzen.
 *    „Waldbrand" und „wildfire" haben nichts gemeinsam.
 *  - **Eigennamen** aus GDELTs `V2.1AllNames` überstehen den Sprachwechsel
 *    meistens: Málaga bleibt Málaga, Reuters bleibt Reuters. Dafür sind sie
 *    dünner gesät und enthalten viel Allerwelts-Geografie.
 *
 * Beides landet normalisiert in der Datenbank, damit sich die Zuordnung später
 * mit geänderten Regeln wiederholen lässt, ohne GDELT erneut abzufragen.
 */

/** Kleinschreibung plus Akzente weg – „Zürichsee" und „Zurichsee" sollen gleich sein. */
function normalisieren(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * Häufige Funktionswörter mit vier und mehr Zeichen. Kürzere fallen ohnehin
 * durch das Längenraster. Bewusst knapp gehalten: Jedes zu viel gestrichene
 * Wort kostet Trennschärfe, und die Zuordnung soll im Zweifel trennen.
 */
const STOPP = new Set([
  // englisch
  "that", "this", "with", "from", "have", "has", "been", "were", "will", "would",
  "could", "should", "after", "over", "into", "about", "more", "than", "their",
  "they", "which", "when", "what", "where", "there", "here", "also", "such",
  "some", "most", "many", "other", "only", "just", "said", "says", "amid",
  "against", "before", "during", "between", "under", "while", "because",
  // nachrichtentypisch – steht in jeder zweiten Schlagzeile und trennt nichts
  "news", "report", "reports", "reported", "update", "updates", "live", "video",
  "photos", "photo", "breaking", "latest", "watch", "read", "opinion", "analysis",
  // deutsch
  "eine", "einen", "einer", "einem", "eines", "nach", "auch", "noch", "aber",
  "wird", "wurde", "werden", "sich", "nicht", "haben", "hatte", "ihre", "ihren",
  "dass", "oder", "mehr", "beim", "vom", "zum", "zur", "uber", "unter", "gegen",
  "durch", "diese", "dieser", "dieses", "sind", "sein", "seine", "schon", "immer",
  // französisch
  "dans", "pour", "avec", "plus", "sont", "cette", "leur", "mais", "tout",
  "comme", "etre", "fait", "apres", "entre", "selon", "contre", "aussi",
  // spanisch / portugiesisch
  "para", "como", "pero", "este", "esta", "esto", "desde", "entre", "sobre",
  "hasta", "cuando", "donde", "mais", "pelo", "pela", "seus", "suas", "nao",
  // italienisch
  "della", "dello", "delle", "degli", "nella", "sono", "anche", "dopo", "essere",
  "come", "questo", "questa", "senza", "ancora",
]);

/**
 * Titel in vergleichbare Wörter zerlegen.
 *
 * Vier Zeichen als Untergrenze: Darunter liegen fast nur Funktionswörter und
 * Abkürzungen, die überall passen. Ziffernfolgen bleiben drin – Jahreszahlen
 * und Opferzahlen sind für die Zuordnung durchaus aussagekräftig.
 */
export function titleTokens(title: string): string[] {
  const roh = normalisieren(title)
    // An allem trennen, was kein Buchstabe und keine Ziffer ist. `\p{L}`
    // schliesst Griechisch, Kyrillisch und CJK mit ein.
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !STOPP.has(w));
  return [...new Set(roh)].slice(0, 24);
}

/**
 * Eigennamen aus `V2.1AllNames` (Spalte 23) lesen.
 * Format: `Name,Zeichenposition;Name,Zeichenposition;…`
 *
 * Einzelwörter unter fünf Zeichen fliegen raus – „Iran" oder „Gaza" tauchen in
 * so vielen unverbundenen Meldungen auf, dass sie als Beleg nichts taugen.
 * Mehrwortnamen bleiben vollständig erhalten; gerade sie tragen die Zuordnung.
 */
export function namesFrom(allNames: string | undefined): string[] {
  if (!allNames) return [];
  const raus = new Set<string>();
  for (const eintrag of allNames.split(";")) {
    const name = normalisieren(eintrag.split(",")[0] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!name) continue;
    const woerter = name.split(" ");
    if (woerter.length === 1 && name.length < 5) continue;
    if (name.length < 4) continue;
    raus.add(name);
  }
  return [...raus].slice(0, 30);
}
