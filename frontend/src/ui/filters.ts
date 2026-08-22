import type { CategoryDef, CategoryId } from "../types";
import { t, type TextKey } from "../i18n";

export interface FilterBarOptions {
  container: HTMLElement;
  categories: CategoryDef[];
  selected: Set<CategoryId>;
  onChange: (selected: Set<CategoryId>) => void;
}

/** Rubriken-Leiste. Leere Auswahl = alle Rubriken. */
export function createFilterBar(opts: FilterBarOptions) {
  const { container, categories, selected, onChange } = opts;
  container.innerHTML = "";
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", t("filter.aria"));

  const all = document.createElement("button");
  all.type = "button";
  all.className = "chip chip--all";
  all.textContent = t("filter.all");
  all.addEventListener("click", () => {
    selected.clear();
    render();
    onChange(selected);
  });
  container.appendChild(all);

  const buttons = categories
    .filter((c) => c.id !== "other")
    .map((cat) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.id = cat.id;
      b.style.setProperty("--chip-color", cat.color);
      // Rubriknamen aus dem Sprachbestand, nicht aus `category-map.json`:
      // Die Datei beschreibt Zuordnungsregeln, nicht Beschriftungen.
      b.textContent = t(`category.${cat.id}` as TextKey);
      b.addEventListener("click", () => {
        if (selected.has(cat.id)) selected.delete(cat.id);
        else selected.add(cat.id);
        render();
        onChange(selected);
      });
      container.appendChild(b);
      return b;
    });

  function render() {
    all.setAttribute("aria-pressed", String(selected.size === 0));
    all.classList.toggle("is-active", selected.size === 0);
    for (const b of buttons) {
      const on = selected.has(b.dataset.id as CategoryId);
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  }

  render();
  return { render };
}
