/**
 * Rubrik-Zuordnung anhand der GKG-Themencodes.
 *
 * Zwei Entwurfsentscheide, beide aus Fehlern gelernt:
 *
 * 1. Treffer nur an Wortgrenzen. GDELT-Themen sind mit Unterstrich getrennte
 *    Wortketten. Blosse Teilstring-Suche findet SPORT in TRANSPORT und KILL in
 *    SKILLS — und macht aus einem Raketenangriff eine Sportmeldung.
 *    Ein Stern am Ende erlaubt Wortanfänge: DIPLOMA* trifft DIPLOMATIC.
 *
 * 2. Punkte statt „erster Treffer gewinnt". Ein Artikel trägt oft dreissig
 *    Themencodes; ein einzelner Zufallstreffer darf ihn nicht bestimmen.
 */

import map from "./category-map.json" with { type: "json" };

export interface CategoryDef {
  id: string;
  label: string;
  color: string;
  strong: string[];
  weak: string[];
  /** Gleicht aus, dass GDELT manche Rubriken viel häufiger vergibt als andere. */
  boost?: number;
}

const CONFIG = map as { minScore: number; categories: CategoryDef[] };
export const CATEGORIES = CONFIG.categories;
const MIN_SCORE = CONFIG.minScore ?? 0.9;

const WEIGHT_STRONG = 1;
const WEIGHT_WEAK = 0.3;

/** `KILL` → /(^|_)KILL(_|$)/ ,  `DIPLOMA*` → /(^|_)DIPLOMA[A-Z0-9]*(_|$)/ */
function toPattern(needle: string): RegExp {
  const offen = needle.endsWith("*");
  const kern = (offen ? needle.slice(0, -1) : needle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|_)${kern}${offen ? "[A-Z0-9]*" : ""}(_|$)`);
}

interface Compiled {
  id: string;
  strong: RegExp[];
  weak: RegExp[];
  boost: number;
}

const COMPILED: Compiled[] = CATEGORIES
  .filter((c) => c.id !== "other")
  .map((c) => ({
    id: c.id,
    strong: (c.strong ?? []).map(toPattern),
    weak: (c.weak ?? []).map(toPattern),
    boost: c.boost ?? 1,
  }));

export interface CategoryResult {
  category: string;
  score: number;
  /** Themen, die auf keine Rubrik passten – Grundlage zum Nachjustieren */
  unmatched: string[];
}

export function categorise(themes: string[]): CategoryResult {
  const scores = new Map<string, number>();
  const hatStarken = new Set<string>();
  const matched = new Set<string>();

  for (const theme of themes) {
    for (const cat of COMPILED) {
      let hit = 0;
      if (cat.strong.some((re) => re.test(theme))) {
        hit = WEIGHT_STRONG;
        hatStarken.add(cat.id);
      } else if (cat.weak.some((re) => re.test(theme))) {
        hit = WEIGHT_WEAK;
      }
      if (hit > 0) {
        scores.set(cat.id, (scores.get(cat.id) ?? 0) + hit);
        matched.add(theme);
      }
    }
  }

  let best = "other";
  let bestScore = 0;
  // Reihenfolge in der Datei entscheidet bei Gleichstand
  for (const cat of COMPILED) {
    // Ohne einen einzigen starken Treffer keine Rubrik. Sonst reichen drei
    // beiläufige Nebenbegriffe, um eine Whisky-Auszeichnung zur
    // Naturkatastrophe zu erklären.
    if (!hatStarken.has(cat.id)) continue;
    const s = (scores.get(cat.id) ?? 0) * cat.boost;
    if (s > bestScore) {
      bestScore = s;
      best = cat.id;
    }
  }
  if (bestScore < MIN_SCORE) best = "other";

  return {
    category: best,
    score: Math.round(bestScore * 100) / 100,
    unmatched: themes.filter((t) => !matched.has(t)),
  };
}
