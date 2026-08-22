import connectorFile from "../../../data/connectors.json";
import type { OwnershipDef, OwnershipId, Settings, SourceDef, UiLang } from "../types";
import { translationAvailable } from "../data/translate";
import { lang, setLang, t, type TextKey } from "../i18n";

const DATEN = connectorFile as {
  connectors: SourceDef[];
  ownership: OwnershipDef[];
};

export const CONNECTORS = DATEN.connectors;
export const OWNERSHIP = DATEN.ownership;

const SPEICHER = "globenews.settings.v1";

export function defaultSettings(): Settings {
  return {
    connectors: new Set(
      CONNECTORS.filter((c) => c.status === "active" && c.defaultOn).map((c) => c.id),
    ),
    // Voreinstellung bewusst „alle": Der weitaus grösste Teil der Quellen ist
    // noch nicht eingestuft, ein enger Standardfilter würde den Globus leeren.
    ownership: new Set(OWNERSHIP.map((o) => o.id)),
    // Die Sprache hat `i18n` bereits aus dem Browser bestimmt.
    uiLang: lang(),
    // Übersetzen ist ausgeschaltet, bis jemand es will: Die Originalschlagzeile
    // ist die belegbare Angabe, die Übertragung eine Ableitung.
    translateHeadlines: false,
  };
}

export function loadSettings(): Settings {
  const standard = defaultSettings();
  try {
    const roh = localStorage.getItem(SPEICHER);
    if (!roh) return standard;
    const gespeichert = JSON.parse(roh) as {
      connectors?: string[];
      ownership?: OwnershipId[];
      /** Alt: ein Wert mit drei Zuständen. Wird unten übersetzt. */
      language?: "off" | "de" | "en";
      uiLang?: UiLang;
      translateHeadlines?: boolean;
    };
    return {
      connectors: new Set(
        (gespeichert.connectors ?? [...standard.connectors]).filter((id) =>
          CONNECTORS.some((c) => c.id === id && c.status === "active")
        ),
      ),
      ownership: new Set(
        (gespeichert.ownership ?? [...standard.ownership]).filter((id): id is OwnershipId =>
          OWNERSHIP.some((o) => o.id === id)
        ),
      ),
      // Umzug vom alten Dreizustand: „off" hiess nicht übersetzen und sagte
      // nichts über die Oberfläche — dann gilt die Browsersprache. „de"/„en"
      // hiess übersetzen, und dieselbe Sprache trägt jetzt auch die Oberfläche.
      uiLang: gespeichert.uiLang
        ?? (gespeichert.language === "de" || gespeichert.language === "en"
          ? gespeichert.language
          : standard.uiLang),
      translateHeadlines: gespeichert.translateHeadlines
        ?? (gespeichert.language ? gespeichert.language !== "off" : false),
    };
  } catch {
    return standard;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(
      SPEICHER,
      JSON.stringify({
        connectors: [...s.connectors],
        ownership: [...s.ownership],
        uiLang: s.uiLang,
        translateHeadlines: s.translateHeadlines,
      }),
    );
  } catch {
    // Privater Modus o. ä. – dann gelten die Einstellungen eben nur für diese Sitzung.
  }
}

export interface SettingsPanelOptions {
  container: HTMLElement;
  toggle: HTMLElement;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** Wird gerufen, wenn die Oberflächensprache wechselt – die Seite baut neu auf. */
  onLangChange?: () => void;
}

export function createSettingsPanel(opts: SettingsPanelOptions) {
  const { container, toggle, settings, onChange, onLangChange } = opts;

  container.innerHTML = `
    <header class="settings__head">
      <h2 class="settings__title"></h2>
      <button class="settings__close" type="button">×</button>
    </header>
    <div class="settings__body"></div>`;
  container.querySelector(".settings__title")!.textContent = t("settings.title");
  container.querySelector(".settings__close")!
    .setAttribute("aria-label", t("nav.settingsClose"));

  const body = container.querySelector(".settings__body") as HTMLElement;

  // ---------------------------------------------------------------- Quellen
  const quellen = abschnitt(t("settings.sources"), t("settings.sourcesHint"));
  for (const c of CONNECTORS) {
    quellen.appendChild(schalterZeile(c, settings, onChange));
  }
  body.appendChild(quellen);

  // ---------------------------------------------------------------- Sprache
  //
  // Eine Wahl für beides: Oberfläche und Zielsprache der Übersetzung. Der
  // frühere Dreizustand („Original / Deutsch / Englisch") ging nicht mehr,
  // sobald dieselbe Wahl die Oberfläche trägt — „Original" ist keine Sprache,
  // in der man ein Menü beschriften kann. Ob überhaupt übersetzt wird, sagt
  // deshalb ein eigener Schalter darunter.
  const sprache = abschnitt(t("settings.language"), t("settings.languageHint"));

  const wahl = document.createElement("div");
  wahl.className = "seg";
  wahl.setAttribute("role", "radiogroup");
  wahl.setAttribute("aria-label", t("settings.language"));

  const sprachen: { id: UiLang; label: string }[] = [
    { id: "en", label: "English" },
    { id: "de", label: "Deutsch" },
  ];
  for (const o of sprachen) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg__item";
    // Sprachnamen stehen in ihrer eigenen Sprache – so findet sich auch
    // jemand zurecht, der die gerade eingestellte nicht liest.
    b.textContent = o.label;
    b.lang = o.id;
    b.setAttribute("role", "radio");
    const an = settings.uiLang === o.id;
    b.classList.toggle("is-active", an);
    b.setAttribute("aria-checked", String(an));
    b.addEventListener("click", () => {
      if (settings.uiLang === o.id) return;
      settings.uiLang = o.id;
      setLang(o.id);
      saveSettings(settings);
      onLangChange?.();
    });
    wahl.appendChild(b);
  }
  sprache.appendChild(wahl);

  const uebersetzen = zeileMitSchalter(
    t("settings.translate"),
    translationAvailable() ? t("settings.translateHintOk") : t("settings.translateHintNo"),
    settings.translateHeadlines && translationAvailable(),
    !translationAvailable(),
    (an) => {
      settings.translateHeadlines = an;
      saveSettings(settings);
      onChange(settings);
    },
  );
  sprache.appendChild(uebersetzen);
  body.appendChild(sprache);

  // ---------------------------------------------------------------- Trägerschaft
  const traeger = abschnitt(t("settings.ownership"), t("settings.ownershipHint"));
  for (const o of OWNERSHIP) {
    traeger.appendChild(ownershipZeile(o, settings, onChange));
  }
  body.appendChild(traeger);

  // ---------------------------------------------------------------- Steuerung
  const oeffnen = () => {
    container.classList.add("is-open");
    container.removeAttribute("inert");
    toggle.setAttribute("aria-expanded", "true");
  };
  const schliessen = () => {
    container.classList.remove("is-open");
    container.setAttribute("inert", "");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    if (container.classList.contains("is-open")) schliessen();
    else oeffnen();
  });
  container.querySelector(".settings__close")!.addEventListener("click", schliessen);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && container.classList.contains("is-open")) schliessen();
  });

  schliessen();
  return { oeffnen, schliessen };
}

// ------------------------------------------------------------------ Bausteine
function abschnitt(titel: string, hinweis: string): HTMLElement {
  const el = document.createElement("section");
  el.className = "settings__section";
  const h = document.createElement("h3");
  h.className = "settings__label";
  h.textContent = titel;
  const p = document.createElement("p");
  p.className = "settings__hint";
  p.textContent = hinweis;
  el.append(h, p);
  return el;
}

function schalterZeile(
  c: SourceDef,
  settings: Settings,
  onChange: (s: Settings) => void,
): HTMLElement {
  const zeile = document.createElement("div");
  zeile.className = "row";
  zeile.dataset.status = c.status;

  const text = document.createElement("div");
  text.className = "row__text";

  const name = document.createElement("span");
  name.className = "row__name";
  name.textContent = c.name;
  if (c.status === "planned") name.append(marke(t("settings.tagPlanned")));
  if (c.status === "unavailable") name.append(marke(t("settings.tagNoApi")));

  const note = document.createElement("span");
  note.className = "row__note";
  note.textContent = c.note ?? "";

  text.append(name, note);

  const schalter = document.createElement("button");
  schalter.type = "button";
  schalter.className = "switch";
  schalter.disabled = c.status !== "active";
  const setze = () => {
    const an = settings.connectors.has(c.id);
    schalter.classList.toggle("is-on", an);
    schalter.setAttribute("aria-checked", String(an));
  };
  schalter.setAttribute("role", "switch");
  schalter.setAttribute("aria-label", c.name);
  schalter.innerHTML = '<span class="switch__knob"></span>';
  schalter.addEventListener("click", () => {
    if (settings.connectors.has(c.id)) settings.connectors.delete(c.id);
    else settings.connectors.add(c.id);
    setze();
    saveSettings(settings);
    onChange(settings);
  });
  setze();

  zeile.append(text, schalter);
  return zeile;
}

function ownershipZeile(
  o: OwnershipDef,
  settings: Settings,
  onChange: (s: Settings) => void,
): HTMLElement {
  const zeile = document.createElement("label");
  zeile.className = "row row--check";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "check";
  box.checked = settings.ownership.has(o.id);
  box.addEventListener("change", () => {
    if (box.checked) settings.ownership.add(o.id);
    else settings.ownership.delete(o.id);
    saveSettings(settings);
    onChange(settings);
  });

  const text = document.createElement("div");
  text.className = "row__text";
  const name = document.createElement("span");
  name.className = "row__name";
  // Die Beschriftung kommt aus dem Sprachbestand, nicht aus `connectors.json`:
  // Die Datei beschreibt Struktur (Kennung, Zustand), nicht Sprache.
  name.textContent = t(`ownership.${o.id}` as TextKey);
  const note = document.createElement("span");
  note.className = "row__note";
  note.textContent = o.note ?? "";
  text.append(name, note);

  zeile.append(box, text);
  return zeile;
}

/** Eine Zeile mit Beschriftung, Erklärung und Schalter – wie bei den Quellen. */
function zeileMitSchalter(
  titel: string,
  hinweis: string,
  an: boolean,
  gesperrt: boolean,
  onToggle: (an: boolean) => void,
): HTMLElement {
  const zeile = document.createElement("div");
  zeile.className = "row";

  const text = document.createElement("div");
  text.className = "row__text";
  const name = document.createElement("span");
  name.className = "row__name";
  name.textContent = titel;
  const note = document.createElement("span");
  note.className = "row__note";
  note.textContent = hinweis;
  text.append(name, note);

  const schalter = document.createElement("button");
  schalter.type = "button";
  schalter.className = "switch";
  schalter.disabled = gesperrt;
  schalter.setAttribute("role", "switch");
  schalter.setAttribute("aria-label", titel);
  schalter.innerHTML = '<span class="switch__knob"></span>';
  let zustand = an && !gesperrt;
  const setze = () => {
    schalter.classList.toggle("is-on", zustand);
    schalter.setAttribute("aria-checked", String(zustand));
  };
  schalter.addEventListener("click", () => {
    zustand = !zustand;
    setze();
    onToggle(zustand);
  });
  setze();

  zeile.append(text, schalter);
  return zeile;
}

function marke(text: string): HTMLElement {
  const el = document.createElement("em");
  el.className = "row__tag";
  el.textContent = text;
  return el;
}
