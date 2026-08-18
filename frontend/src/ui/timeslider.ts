export interface TimeSliderOptions {
  container: HTMLElement;
  /** Wie weit zurück der Slider reicht (Detaildaten liegen 8 Tage vor) */
  maxHoursBack: number;
  onChange: (until: Date, windowHours: number) => void;
}

/**
 * Zeitsteuerung: ein Stundenschieber über die letzten Tage plus Datumsfeld für
 * grössere Sprünge. Position 0 = jetzt.
 */
export function createTimeSlider(opts: TimeSliderOptions) {
  const { container, maxHoursBack, onChange } = opts;
  container.innerHTML = "";

  const label = document.createElement("div");
  label.className = "timebar__label";

  const row = document.createElement("div");
  row.className = "timebar__row";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(-maxHoursBack);
  slider.max = "0";
  slider.step = "1";
  slider.value = "0";
  slider.className = "timebar__slider";
  slider.setAttribute("aria-label", "Zeitpunkt wählen");

  const date = document.createElement("input");
  date.type = "date";
  date.className = "timebar__date";
  date.setAttribute("aria-label", "Datum wählen");
  date.max = toDateInput(new Date());
  date.min = toDateInput(new Date(Date.now() - maxHoursBack * 3600_000));
  date.value = toDateInput(new Date());

  const windowSelect = document.createElement("select");
  windowSelect.className = "timebar__window";
  windowSelect.setAttribute("aria-label", "Zeitfenster");
  for (const [h, text] of [[1, "1 Std."], [6, "6 Std."], [24, "24 Std."], [72, "3 Tage"]] as const) {
    const o = document.createElement("option");
    o.value = String(h);
    o.textContent = text;
    if (h === 24) o.selected = true;
    windowSelect.appendChild(o);
  }

  const nowBtn = document.createElement("button");
  nowBtn.type = "button";
  nowBtn.className = "timebar__now";
  nowBtn.textContent = "Jetzt";

  row.append(slider, windowSelect, date, nowBtn);
  container.append(label, row);

  let until = new Date();
  let windowHours = 24;

  function currentUntil(): Date {
    const offset = Number(slider.value);
    const base = date.valueAsDate ? new Date(date.valueAsDate) : new Date();
    const isToday = toDateInput(base) === toDateInput(new Date());
    if (isToday) return new Date(Date.now() + offset * 3600_000);
    base.setUTCHours(23, 59, 0, 0);
    return new Date(base.getTime() + offset * 3600_000);
  }

  function update(emit = true) {
    until = currentUntil();
    windowHours = Number(windowSelect.value);
    const from = new Date(until.getTime() - windowHours * 3600_000);
    label.textContent = `${fmt(from)} – ${fmt(until)}`;
    label.classList.toggle("is-live", Math.abs(until.getTime() - Date.now()) < 20 * 60_000);
    if (emit) onChange(until, windowHours);
  }

  slider.addEventListener("input", () => update());
  windowSelect.addEventListener("change", () => update());
  date.addEventListener("change", () => {
    slider.value = "0";
    update();
  });
  nowBtn.addEventListener("click", () => {
    slider.value = "0";
    date.value = toDateInput(new Date());
    update();
  });

  update(false);
  return {
    get until() {
      return until;
    },
    get windowHours() {
      return windowHours;
    },
    refresh: () => update(false),
  };
}

function fmt(d: Date): string {
  return d.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}
