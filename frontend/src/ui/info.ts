/**
 * Das „Über dieses Projekt"-Overlay.
 *
 * Die Arbeit macht das native `<dialog>`: Fokusfalle, Escape-Taste, `inert`
 * für den Hintergrund und die Rückgabe des Fokus an den auslösenden Knopf
 * bringt es mit. Hier bleibt nur, was es nicht kann — Klick auf den Hintergrund
 * und ein sanftes Ein- und Ausblenden.
 */
export function createInfoDialog(dialog: HTMLDialogElement, toggle: HTMLElement) {
  toggle.addEventListener("click", () => {
    if (!dialog.open) dialog.showModal();
  });

  /**
   * Klick auf den Hintergrund schliesst.
   *
   * Ein `<dialog>` füllt seinen Backdrop nicht aus, der Klick darauf landet
   * trotzdem beim Dialog selbst. Unterschieden wird deshalb über die
   * Trefferfläche: Liegt der Klickpunkt ausserhalb des Kastens, war es der
   * Hintergrund. Das ist verlässlicher als ein `event.target`-Vergleich, der
   * bei Klicks auf Kindelemente mit eigenem Layout danebengreift.
   */
  dialog.addEventListener("click", (e) => {
    const k = dialog.getBoundingClientRect();
    const drin = e.clientX >= k.left && e.clientX <= k.right &&
      e.clientY >= k.top && e.clientY <= k.bottom;
    if (!drin) dialog.close();
  });

  // Beim Schliessen erst ausblenden, dann wirklich zumachen. `close()` würde
  // das Element sofort aus dem Layout nehmen und jede Animation abschneiden.
  dialog.addEventListener("cancel", (e) => {
    if (dialog.classList.contains("geht-zu")) return;
    e.preventDefault();
    schliessenMitBlende();
  });

  const schliessKnopf = dialog.querySelector<HTMLButtonElement>(".info__schliessen button");
  schliessKnopf?.addEventListener("click", (e) => {
    e.preventDefault();
    schliessenMitBlende();
  });

  function schliessenMitBlende() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      dialog.close();
      return;
    }
    dialog.classList.add("geht-zu");
    window.setTimeout(() => {
      dialog.classList.remove("geht-zu");
      dialog.close();
    }, 180);
  }

  return { open: () => dialog.showModal(), close: schliessenMitBlende };
}
