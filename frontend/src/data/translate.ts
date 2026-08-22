/**
 * Übersetzung der Schlagzeilen.
 *
 * Erster Weg ist der **in Chrome eingebaute Übersetzer** (Translator API, ab
 * Chrome 138): Er läuft auf dem Gerät, kostet nichts, braucht keinen Schlüssel
 * und schickt keine Texte an Dritte. Das passt zum Anspruch, ohne Tracking und
 * ohne laufende Kosten auszukommen.
 *
 * Wo es ihn nicht gibt – Safari, Firefox, ältere Chrome-Versionen – bleibt der
 * Originaltext stehen. Der serverseitige DeepL-Weg ist vorbereitet
 * (`supabase/functions/translate`, Tabelle `translations`) und wird genutzt,
 * sobald ein Schlüssel hinterlegt ist.
 */

export type TargetLang = "off" | "de" | "en";

interface TranslatorLike {
  translate: (text: string) => Promise<string>;
  destroy?: () => void;
}

interface TranslatorStatic {
  availability: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  create: (o: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }) => Promise<TranslatorLike>;
}

interface LanguageDetectorStatic {
  create: () => Promise<{
    detect: (text: string) => Promise<{ detectedLanguage: string; confidence: number }[]>;
  }>;
}

function translatorApi(): TranslatorStatic | null {
  const w = window as unknown as { Translator?: TranslatorStatic };
  return typeof w.Translator?.create === "function" ? w.Translator : null;
}

function detectorApi(): LanguageDetectorStatic | null {
  const w = window as unknown as { LanguageDetector?: LanguageDetectorStatic };
  return typeof w.LanguageDetector?.create === "function" ? w.LanguageDetector : null;
}

/** Steht überhaupt ein Übersetzer zur Verfügung? Steuert die Anzeige im Panel. */
export function translationAvailable(): boolean {
  return translatorApi() !== null;
}

// Ein Übersetzer je Sprachpaar; das Anlegen ist teuer (Modell wird geladen).
const uebersetzer = new Map<string, Promise<TranslatorLike | null>>();
const zwischenspeicher = new Map<string, string>();

let detektorPromise: ReturnType<NonNullable<LanguageDetectorStatic["create"]>> | null = null;

async function erkenneSprache(text: string): Promise<string | null> {
  const api = detectorApi();
  if (!api) return null;
  try {
    detektorPromise ??= api.create();
    const d = await detektorPromise;
    const treffer = await d.detect(text.slice(0, 200));
    const beste = treffer?.[0];
    return beste && beste.confidence > 0.5 ? beste.detectedLanguage : null;
  } catch {
    return null;
  }
}

async function holeUebersetzer(von: string, nach: string): Promise<TranslatorLike | null> {
  const key = `${von}->${nach}`;
  if (!uebersetzer.has(key)) {
    uebersetzer.set(
      key,
      (async () => {
        const api = translatorApi();
        if (!api) return null;
        try {
          const stand = await api.availability({ sourceLanguage: von, targetLanguage: nach });
          if (stand === "unavailable") return null;
          return await api.create({ sourceLanguage: von, targetLanguage: nach });
        } catch {
          return null;
        }
      })(),
    );
  }
  return uebersetzer.get(key)!;
}

/**
 * Übersetzt einen Text, wenn möglich. Gibt bei jedem Hindernis den Originaltext
 * zurück – eine fehlende Übersetzung darf die Anzeige nie blockieren.
 */
export async function translate(
  text: string,
  ziel: TargetLang,
  quellsprache?: string | null,
): Promise<string> {
  if (ziel === "off" || !text.trim()) return text;

  const key = `${ziel}|${text}`;
  const bekannt = zwischenspeicher.get(key);
  if (bekannt) return bekannt;

  const von = quellsprache ?? (await erkenneSprache(text));
  if (!von || von === ziel) return text;

  const t = await holeUebersetzer(von, ziel);
  if (!t) return text;

  try {
    const ergebnis = await t.translate(text);
    const sauber = ergebnis?.trim() || text;
    zwischenspeicher.set(key, sauber);
    return sauber;
  } catch {
    return text;
  }
}

/** Mehrere Texte nacheinander – der Übersetzer mag keine parallelen Aufrufe. */
export async function translateAll(
  texte: string[],
  ziel: TargetLang,
  quellsprache?: string | null,
): Promise<string[]> {
  if (ziel === "off") return texte;
  const out: string[] = [];
  for (const t of texte) out.push(await translate(t, ziel, quellsprache));
  return out;
}
