import connectorFile from "../../../data/connectors.json";
import type { OwnershipDef, OwnershipId, Settings, SourceDef, TargetLang } from "../types";
import { translationAvailable } from "../data/translate";

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
    language: "off",
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
      language?: TargetLang;
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
      language: gespeichert.language ?? "off",
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
        language: s.language,
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
}

export function createSettingsPanel(opts: SettingsPanelOptions) {
  const { container, toggle, settings, onChange } = opts;

  container.innerHTML = `
    <header class="settings__head">
      <h2 class="settings__title">Einstellungen</h2>
      <button class="settings__close" type="button" aria-label="Einstellungen schliessen">×</button>
    </header>
    <div class="settings__body"></div>`;

  const body = container.querySelector(".settings__body") as HTMLElement;

  // ---------------------------------------------------------------- Quellen
  const quellen = abschnitt(
    "Quellen",
    "Woher die Meldungen kommen. Abgewählte Ströme verschwinden sofort vom Globus.",
  );
  for (const c of CONNECTORS) {
    quellen.appendChild(schalterZeile(c, settings, onChange));
  }
  body.appendChild(quellen);

  // ---------------------------------------------------------------- Sprache
  const sprache = abschnitt(
    "Sprache der Schlagzeilen",
    translationAvailable()
      ? "Übersetzt auf deinem Gerät, ohne dass Texte an Dritte gehen."
      : "Die Meldungen bleiben in der Originalsprache. Übersetzt wird auf dem " +
        "Gerät selbst — das können bisher nur Chrome und Edge auf dem Computer, " +
        "nicht die Browser auf Telefon und Tablet.",
  );

  const wahl = document.createElement("div");
  wahl.className = "seg";
  wahl.setAttribute("role", "radiogroup");
  wahl.setAttribute("aria-label", "Sprache der Schlagzeilen");

  const optionen: { id: TargetLang; label: string }[] = [
    { id: "off", label: "Original" },
    { id: "de", label: "Deutsch" },
    { id: "en", label: "Englisch" },
  ];
  const knoepfe: HTMLButtonElement[] = [];
  for (const o of optionen) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "seg__item";
    b.textContent = o.label;
    b.setAttribute("role", "radio");
    b.disabled = o.id !== "off" && !translationAvailable();
    b.addEventListener("click", () => {
      settings.language = o.id;
      for (const k of knoepfe) {
        const an = k === b;
        k.classList.toggle("is-active", an);
        k.setAttribute("aria-checked", String(an));
      }
      saveSettings(settings);
      onChange(settings);
    });
    const an = settings.language === o.id;
    b.classList.toggle("is-active", an);
    b.setAttribute("aria-checked", String(an));
    knoepfe.push(b);
    wahl.appendChild(b);
  }
  sprache.appendChild(wahl);
  body.appendChild(sprache);

  // ---------------------------------------------------------------- Trägerschaft
  const traeger = abschnitt(
    "Trägerschaft der Medien",
    "Wer hinter einer Quelle steht. Eingestuft ist bislang nur ein kleiner Teil — «Nicht eingestuft» abzuwählen blendet deshalb sehr viel aus.",
  );
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
  if (c.status === "planned") name.append(marke("geplant"));
  if (c.status === "unavailable") name.append(marke("keine Schnittstelle"));

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
  name.textContent = o.label;
  const note = document.createElement("span");
  note.className = "row__note";
  note.textContent = o.note ?? "";
  text.append(name, note);

  zeile.append(box, text);
  return zeile;
}

function marke(text: string): HTMLElement {
  const el = document.createElement("em");
  el.className = "row__tag";
  el.textContent = text;
  return el;
}
