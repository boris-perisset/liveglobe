import type { CategoryDef, CategoryId } from "../types";

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
  container.setAttribute("aria-label", "Rubriken filtern");

  const all = document.createElement("button");
  all.type = "button";
  all.className = "chip chip--all";
  all.textContent = "Alle";
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
      b.textContent = cat.label;
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
