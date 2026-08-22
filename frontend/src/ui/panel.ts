import type { Article, CategoryDef, CategoryId, EventGroup, TargetLang } from "../types";
import { translate } from "../data/translate";
import { locale, t, tn, type TextKey } from "../i18n";
import { gruppiereNachEreignis } from "../data/api";

export class TeaserPanel {
  private el: HTMLElement;
  private titleEl: HTMLElement;
  private subEl: HTMLElement;
  private listEl: HTMLElement;
  private labels: Map<CategoryId, CategoryDef>;
  /** Ortsname des angeklickten Pins — Rückfall, solange es keine Ereignisse gibt. */
  private ort = "";

  constructor(
    container: HTMLElement,
    categories: CategoryDef[],
    /** Wird beim Schliessen gerufen — die Karte hebt dann ihre Hervorhebung auf. */
    private onClose?: () => void,
  ) {
    this.labels = new Map(categories.map((c) => [c.id, c]));
    container.innerHTML = `
      <header class="panel__head">
        <div class="panel__head-text">
          <h2 class="panel__title"></h2>
          <p class="panel__sub"></p>
        </div>
        <button class="panel__close" type="button" aria-label="Schliessen">×</button>
      </header>
      <div class="panel__list"></div>`;
    this.el = container;
    this.titleEl = container.querySelector(".panel__title")!;
    this.subEl = container.querySelector(".panel__sub")!;
    this.listEl = container.querySelector(".panel__list")!;
    container.querySelector(".panel__close")!.addEventListener("click", () => this.close());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
  }

  /** Öffnet mit dem Ortsnamen als vorläufiger Überschrift; `render` ersetzt sie. */
  open(ort: string) {
    this.ort = ort;
    this.titleEl.textContent = ort;
    this.subEl.textContent = "";
    this.listEl.innerHTML = `<p class="panel__hint">${escapeHtml(t("panel.loading"))}</p>`;
    this.el.classList.add("is-open");
    this.el.removeAttribute("inert");
  }

  close() {
    const warOffen = this.el.classList.contains("is-open");
    this.el.classList.remove("is-open");
    this.el.setAttribute("inert", "");
    // Nur melden, wenn wirklich etwas geschlossen wurde: Die Escape-Taste
    // feuert sonst bei jedem Tastendruck auf der Seite.
    if (warOffen) this.onClose?.();
  }

  showError(message: string) {
    this.listEl.innerHTML = `<p class="panel__hint panel__hint--error"></p>`;
    this.listEl.querySelector("p")!.textContent = message;
  }

  render(articles: Article[], sprache: TargetLang = "off") {
    if (articles.length === 0) {
      this.titleEl.textContent = this.ort;
      this.subEl.textContent = "";
      this.listEl.innerHTML = `<p class="panel__hint">${escapeHtml(t("panel.empty"))}</p>`;
      return;
    }

    const gruppen = gruppiereNachEreignis(articles);
    // Die tatsächliche Zahl, nicht die geladene: `gesamt` wird in der Datenbank
    // vor der Obergrenze gezählt. Fehlt sie (Demodaten, alte Funktion), bleibt
    // nur das Geladene — dann ist die Zahl wenigstens nicht erfunden.
    const gesamt = articles[0]?.gesamt ?? articles.length;
    this.kopfSetzen(gruppen, gesamt, articles);

    this.listEl.innerHTML = "";
    const karten: { a: Article; el: HTMLElement }[] = [];

    // Überschriften nur, wenn es etwas zu unterscheiden gibt. Bei einem einzigen
    // Ereignis steht sein Name schon oben; ihn zu wiederholen wäre Lärm.
    const mitKopf = gruppen.length > 1;
    // Überschriften stehen in der Originalsprache des ersten Artikels. Ohne
    // sie mitzuübersetzen stünde eine finnische Zeile über deutschen Karten.
    const ueberschriften: { el: HTMLElement; text: string }[] = [];
    if (!mitKopf && gruppen[0]?.title) {
      ueberschriften.push({ el: this.titleEl, text: gruppen[0].title });
    }

    for (const g of gruppen) {
      if (mitKopf) {
        const kopf = this.gruppenKopf(g);
        const t = kopf.querySelector<HTMLElement>(".gruppe__titel");
        if (t && g.title) ueberschriften.push({ el: t, text: g.title });
        this.listEl.appendChild(kopf);
      }
      for (const a of g.articles) {
        const el = this.card(a);
        this.listEl.appendChild(el);
        karten.push({ a, el });
      }
    }

    // Übersetzung läuft nach dem Zeichnen: Die Originalfassung steht sofort da,
    // die Übertragung erscheint, sobald sie fertig ist. Nie umgekehrt warten.
    if (sprache !== "off") void this.uebersetze(karten, sprache, ueberschriften);
  }

  /**
   * Der Kopf beantwortet zwei verschiedene Fragen, je nachdem was da ist.
   *
   * Ein Ereignis: Sein Name ist die Überschrift, der Ort rutscht in die
   * Nebenzeile. Das ist der eigentliche Zweck des Umbaus — der Ort ist eine
   * Eigenschaft des Geschehens, nicht sein Name.
   *
   * Mehrere: Der Ort führt wieder, weil es die einzige gemeinsame Klammer ist,
   * und jede Gruppe bekommt darunter ihre eigene Überschrift.
   */
  private kopfSetzen(gruppen: EventGroup[], anzahl: number, articles: Article[]) {
    const eines = gruppen.length === 1 ? gruppen[0] : null;

    if (eines?.title) {
      this.titleEl.textContent = eines.title;
      this.subEl.textContent = [
        eines.locationName ?? this.ort,
        medienText(eines.outletCount),
        zeitraum(eines.firstPublishedAt, eines.lastPublishedAt),
      ].filter(Boolean).join(" · ");
      return;
    }

    if (gruppen.length > 1) {
      this.titleEl.textContent = t("events.count", { n: gruppen.length });
      this.subEl.textContent = `${orteText(articles)} · ${meldungenText(anzahl)}`;
      return;
    }

    // Kein Ereignis zugeordnet — die Darstellung von vorher.
    this.titleEl.textContent = orteText(articles);
    this.subEl.textContent = meldungenText(anzahl);
  }

  private gruppenKopf(g: EventGroup): HTMLElement {
    const el = document.createElement("div");
    el.className = "gruppe";
    const angaben = [
      g.locationName,
      medienText(g.outletCount),
      zeitraum(g.firstPublishedAt, g.lastPublishedAt),
    ].filter(Boolean).join(" · ");

    el.innerHTML = `<h3 class="gruppe__titel"></h3><p class="gruppe__meta"></p>`;
    el.querySelector(".gruppe__titel")!.textContent = g.title ?? t("panel.noEvent");
    el.querySelector(".gruppe__meta")!.textContent = angaben;
    return el;
  }

  private async uebersetze(
    karten: { a: Article; el: HTMLElement }[],
    ziel: TargetLang,
    ueberschriften: { el: HTMLElement; text: string }[] = [],
  ) {
    // Zuerst die Überschriften: Sie stehen oben und fallen als Erstes auf.
    for (const { el, text } of ueberschriften) {
      const neu = await translate(text, ziel);
      if (neu !== text) el.textContent = neu;
    }
    for (const { a, el } of karten) {
      const titelEl = el.querySelector(".card__title");
      if (titelEl) {
        const neu = await translate(a.title, ziel);
        if (neu !== a.title) {
          titelEl.textContent = neu;
          el.classList.add("is-translated");
          const marke = document.createElement("span");
          marke.className = "card__translated";
          marke.textContent = t("panel.translated");
          titelEl.after(marke);
        }
      }
      if (a.teaser) {
        const teaserEl = el.querySelector(".card__teaser");
        if (teaserEl) teaserEl.textContent = await translate(a.teaser, ziel);
      }
    }
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

    const sourceName = a.source_name || a.source_domain || t("panel.unknownSource");

    // Nur nennen, was wir wirklich wissen. Zwei Platzhalter nebeneinander
    // („nicht eingestuft · Trägerschaft unbekannt") sagen nichts und stören.
    const angaben: string[] = [];
    if (a.source_bias !== null && a.source_bias !== undefined) {
      angaben.push(t(`bias.${a.source_bias}` as TextKey));
    }
    if (a.source_ownership && a.source_ownership !== "unknown") {
      angaben.push(t(`ownership.${a.source_ownership}` as TextKey));
    }
    if (angaben.length === 0) angaben.push(t("panel.unrated"));

    el.innerHTML = `
      ${img}
      <div class="card__body">
        <span class="card__cat">${escapeHtml(cat?.label ?? "Übriges")}</span>
        <h3 class="card__title"></h3>
        ${a.teaser ? '<p class="card__teaser"></p>' : ""}
        <p class="card__meta">
          <span class="bias bias--${a.source_bias ?? "na"}" aria-hidden="true"></span>
          <span class="card__source"></span>
          ${angaben.map((t) => `<span class="card__sep">·</span><span>${escapeHtml(t)}</span>`).join("")}
        </p>
        <p class="card__time"><time datetime="${escapeAttr(a.published_at)}">${
      formatTime(a.published_at)
    }</time> · ${escapeHtml(a.location_name)}</p>
        <a class="card__link" href="${escapeAttr(a.url)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(t("panel.toArticle"))}
        </a>
      </div>`;

    el.querySelector(".card__title")!.textContent = a.title;
    const teaserEl = el.querySelector(".card__teaser");
    if (teaserEl) teaserEl.textContent = a.teaser ?? "";
    el.querySelector(".card__source")!.textContent = sourceName;
    return el;
  }
}

/**
 * Wie der Ort im Kopf genannt wird.
 *
 * Der Pin ist eine Rasterzelle, kein Ort — sein Name stammt vom prominentesten
 * Artikel darin. Bei einem Klick nahe Riga standen darunter Ereignisse aus
 * Tallinn und Vilnius, während der Kopf „Riga" behauptete. Deshalb wird hier
 * gezählt, was wirklich da ist: der häufigste Ortsname führt, und liegt mehr
 * als einer vor, sagt „u. a." offen, dass die Zelle mehrere Orte umfasst.
 */
function orteText(articles: Article[]): string {
  const zaehler = new Map<string, number>();
  for (const a of articles) {
    if (!a.location_name) continue;
    zaehler.set(a.location_name, (zaehler.get(a.location_name) ?? 0) + 1);
  }
  if (zaehler.size === 0) return "";
  const sortiert = [...zaehler].sort((x, y) => y[1] - x[1]);
  return zaehler.size === 1
    ? sortiert[0][0]
    : t("events.placeAndOthers", { place: sortiert[0][0] });
}

function medienText(n: number): string {
  if (!n) return "";
  return tn("count.outlet", "count.outlets", n);
}

function meldungenText(n: number): string {
  return tn("count.report", "count.reports", n);
}

/**
 * Wie lange das Ereignis schon läuft.
 *
 * Bei einem Werkzeug über Verbreitung ist die Spanne die Aussage, nicht der
 * Zeitpunkt: „über 9 Std." sagt, dass die Meldung gewandert ist.
 */
function zeitraum(von: string | null, bis: string | null): string {
  if (!von) return "";
  const start = new Date(von).getTime();
  const ende = bis ? new Date(bis).getTime() : start;
  const min = Math.round((ende - start) / 60000);
  if (min < 45) return t("span.withinHour");
  if (min < 60 * 24) return t("span.over", { text: t("time.hours", { n: Math.round(min / 60) }) });
  return t("span.over", { text: t("time.days", { n: Math.round(min / (60 * 24)) }) });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 60) return t("time.minAgo", { n: Math.max(1, mins) });
  if (mins < 60 * 24) return t("time.hoursAgo", { n: Math.round(mins / 60) });
  return d.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit" });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
