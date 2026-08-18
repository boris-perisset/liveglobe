import type { Article, CategoryDef, CategoryId } from "../types";

const BIAS_LABEL: Record<string, string> = {
  "-3": "weit links",
  "-2": "links",
  "-1": "eher links",
  "0": "Mitte",
  "1": "eher rechts",
  "2": "rechts",
  "3": "weit rechts",
};

const OWNERSHIP_LABEL: Record<string, string> = {
  public: "öffentlich-rechtlich",
  private: "privat",
  state: "staatlich kontrolliert",
  unknown: "Trägerschaft unbekannt",
};

export class TeaserPanel {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private listEl: HTMLElement;
  private labels: Map<CategoryId, CategoryDef>;

  constructor(container: HTMLElement, categories: CategoryDef[]) {
    this.labels = new Map(categories.map((c) => [c.id, c]));
    container.innerHTML = `
      <header class="panel__head">
        <h2 class="panel__title"></h2>
        <button class="panel__close" type="button" aria-label="Schliessen">×</button>
      </header>
      <div class="panel__list"></div>`;
    this.el = container;
    this.titleEl = container.querySelector(".panel__title")!;
    this.listEl = container.querySelector(".panel__list")!;
    container.querySelector(".panel__close")!.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
  }

  open(title: string) {
    this.titleEl.textContent = title;
    this.listEl.innerHTML = `<p class="panel__hint">Lade Meldungen …</p>`;
    this.el.classList.add("is-open");
    this.el.removeAttribute("inert");
  }

  close() {
    this.el.classList.remove("is-open");
    this.el.setAttribute("inert", "");
  }

  showError(message: string) {
    this.listEl.innerHTML = `<p class="panel__hint panel__hint--error"></p>`;
    this.listEl.querySelector("p")!.textContent = message;
  }

  render(articles: Article[]) {
    if (articles.length === 0) {
      this.listEl.innerHTML = `<p class="panel__hint">Keine Meldungen in diesem Zeitfenster.</p>`;
      return;
    }
    this.listEl.innerHTML = "";
    for (const a of articles) this.listEl.appendChild(this.card(a));
  }

  private card(a: Article): HTMLElement {
    const cat = this.labels.get(a.category);
    const el = document.createElement("article");
    el.className = "card";
    el.style.setProperty("--card-color", cat?.color ?? "#8a8f98");

    const img = a.image_url
      ? `<img class="card__img" src="${escapeAttr(a.image_url)}" alt="" loading="lazy"
              referrerpolicy="no-referrer"
              onerror="this.remove()">`
      : "";

    const bias =
      a.source_bias === null || a.source_bias === undefined
        ? "nicht eingestuft"
        : BIAS_LABEL[String(a.source_bias)] ?? "unbekannt";

    const sourceName = a.source_name || a.source_domain || "Unbekannte Quelle";
    const ownership = OWNERSHIP_LABEL[a.source_ownership ?? "unknown"];

    el.innerHTML = `
      ${img}
      <div class="card__body">
        <span class="card__cat">${escapeHtml(cat?.label ?? "Übriges")}</span>
        <h3 class="card__title"></h3>
        <p class="card__teaser"></p>
        <p class="card__meta">
          <span class="bias bias--${a.source_bias ?? "na"}" aria-hidden="true"></span>
          <span class="card__source"></span>
          <span class="card__sep">·</span>
          <span>${escapeHtml(bias)}</span>
          <span class="card__sep">·</span>
          <span>${escapeHtml(ownership)}</span>
        </p>
        <p class="card__time"><time datetime="${escapeAttr(a.published_at)}">${
      formatTime(a.published_at)
    }</time> · ${escapeHtml(a.location_name)}</p>
        <a class="card__link" href="${escapeAttr(a.url)}" target="_blank" rel="noopener noreferrer">
          Zum Artikel →
        </a>
      </div>`;

    el.querySelector(".card__title")!.textContent = a.title;
    el.querySelector(".card__teaser")!.textContent = a.teaser ?? "";
    el.querySelector(".card__source")!.textContent = sourceName;
    return el;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return `vor ${Math.max(1, mins)} Min.`;
  if (mins < 60 * 24) return `vor ${Math.round(mins / 60)} Std.`;
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
