import type { CategoryDef, CategoryId, ReplayVorschlag } from "../types";
import { t, tn } from "../i18n";

/**
 * Die drei Ereignisse, deren Replay sich lohnt.
 *
 * Ein sehenswertes Replay war bisher Glückssache: hineinzoomen, ein Ereignis
 * anklicken, hoffen, dass genug Medien verortet sind. Die meisten sind es
 * nicht. Diese Leiste beantwortet die Frage im Voraus, statt sie dem Zufall zu
 * überlassen.
 *
 * **Gezählt wird, was gezeichnet werden kann.** `arc_count` sind die Medien mit
 * Koordinate — dieselbe Menge, die das Replay dann zeichnet. Die Zahl in der
 * Leiste und das Bild danach sagen dasselbe.
 *
 * Sie steht unter den Rubriken, weil sie derselben Frage folgt („was gibt es
 * gerade?") und sich mit ihnen ändert: Wer eine Rubrik wählt, bekommt die
 * grössten Replays *dieser* Rubrik. Gibt es keine, verschwindet die Leiste
 * ganz — eine leere Zeile Platz zu halten hiesse, dauerhaft Raum für eine
 * Ausnahme zu reservieren.
 */
export interface ReplayBarOptions {
  container: HTMLElement;
  categories: CategoryDef[];
  onWaehlen: (v: ReplayVorschlag) => void;
}

export interface ReplayBar {
  setzen(liste: ReplayVorschlag[]): void;
}

export function createReplayBar(opts: ReplayBarOptions): ReplayBar {
  const { container, categories, onWaehlen } = opts;
  const farben = new Map<CategoryId, string>(
    categories.map((c) => [c.id, c.color] as [CategoryId, string]),
  );

  container.className = "replays";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", t("replays.aria"));
  container.hidden = true;

  return {
    setzen(liste: ReplayVorschlag[]) {
      container.innerHTML = "";
      container.hidden = liste.length === 0;
      if (liste.length === 0) return;

      const marke = document.createElement("span");
      marke.className = "replays__marke";
      marke.textContent = t("replays.label");
      container.appendChild(marke);

      for (const v of liste) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "replays__eintrag";
        b.style.setProperty("--chip-color", farben.get(v.category) ?? "#8a8f98");

        // Die Zahl zuerst: Sie ist der Grund, warum dieser Eintrag hier steht,
        // und sie ist über alle drei hinweg vergleichbar. Der Titel erklärt,
        // worum es geht — er darf umbrechen und abgeschnitten werden, die Zahl
        // nicht.
        const zahl = document.createElement("b");
        zahl.textContent = String(v.arc_count);
        const text = document.createElement("span");
        text.className = "replays__titel";
        text.textContent = v.title;

        b.append(zahl, text);
        b.title = `${tn("count.outlet", "count.outlets", v.arc_count)}`
          + `${v.location_name ? ` · ${v.location_name}` : ""} — ${v.title}`;
        b.setAttribute("aria-label", `${t("replay.open")}: ${b.title}`);
        b.addEventListener("click", () => onWaehlen(v));
        container.appendChild(b);
      }
    },
  };
}
