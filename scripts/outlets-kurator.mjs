#!/usr/bin/env node
/**
 * Outlets von Hand verorten.
 *
 *   node scripts/outlets-kurator.mjs
 *   → http://localhost:5174
 *
 * Zeigt die Outlets, deren Koordinate nicht aus einem echten Redaktionssitz
 * stammt — also die mit Kantons- oder Landesmittelpunkt. Stadt eintippen,
 * Treffer anklicken, gespeichert. Danach steht `ort_herkunft: "handarbeit"`
 * daneben, damit später niemand rätselt, woher der Punkt kam.
 *
 * **Bewusst lokal und nicht in der Live-Seite.** Dort wäre es Schreibzugriff:
 * Anmeldung, Rollen, Zeilenrechte. Das Register liegt noch nicht einmal in der
 * Datenbank — der Engpass ist die Datei, nicht die Oberfläche. Sobald das
 * Register in Supabase steht, kann derselbe Dialog in einen Admin-Bereich
 * wandern.
 *
 * Sortiert nach Meldungen pro Woche: Wer viel publiziert, wird zuerst gefragt.
 * Bei zwanzigtausend Outlets ist die Reihenfolge das Einzige, was zählt — die
 * ersten zweihundert decken den grössten Teil dessen ab, was je einen Bogen
 * bekommt.
 *
 * Geokodierung über Nominatim (OpenStreetMap). Deren Nutzungsregeln erlauben
 * eine Abfrage je Sekunde mit sprechender Kennung; beides hält der Server ein.
 */

import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WURZEL = path.resolve(import.meta.dirname, "..");
const DATEI = path.join(WURZEL, "data", "outlets.json");
const PORT = 5174;

/**
 * Zwei Betriebsarten.
 *
 *   ohne Schalter  — arbeitet auf data/outlets.json
 *   --db           — arbeitet auf der Datenbank
 *
 * Der Unterschied ist nicht bloss die Ablage, sondern die **Reihenfolge**.
 * Die Datei sortiert nach Media Clouds `stories_per_week`, also danach, was
 * Media Cloud einsammelt. Die Datenbank sortiert nach dem, was bei *uns*
 * ankommt — und nur das entscheidet, ob je ein Bogen gezeichnet wird.
 *
 * Die Zahlen dazu: 64 Outlets tragen 21 % unserer Meldungen, 293 tragen 40 %.
 * Die untersten 3'632 zusammen 21 %. Ein Klick ganz oben ist hundertmal so
 * viel wert wie einer ganz unten — vorausgesetzt, man sortiert richtig.
 */
const DB = process.argv.includes("--db");
const MIN = Number(process.argv[process.argv.indexOf("--min") + 1]) || 5;
const KENNUNG = "GlobeNews/0.1 (https://liveglobe.site; Outlet-Kuration)";

async function ausEnv(...namen) {
  const t = {};
  const pfad = path.join(WURZEL, ".env.local");
  if (existsSync(pfad)) {
    for (const zeile of (await readFile(pfad, "utf8")).split("\n")) {
      const r = zeile.trim().replace(/^export\s+/, "");
      const i = r.indexOf("=");
      if (i > 0) t[r.slice(0, i)] = r.slice(i + 1).replace(/^["']|["']$/g, "").trim();
    }
  }
  return namen.map((n) => process.env[n] ?? t[n] ?? null);
}

const [SB_URL, SB_KEY] = DB ? await ausEnv("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY") : [null, null];

if (DB && (!SB_URL || !SB_KEY)) {
  console.error("\nSUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt in .env.local.\n");
  process.exit(1);
}

async function rpc(fn, koerper) {
  const res = await fetch(`${SB_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(koerper),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

if (!DB && !existsSync(DATEI)) {
  console.error(`\n${DATEI} fehlt.\nErst: node scripts/outlets-build.mjs\n`);
  process.exit(1);
}

let outlets = DB ? [] : JSON.parse(await readFile(DATEI, "utf8"));

/**
 * Was noch Handarbeit braucht.
 *
 * Nicht nur der fehlende Ort: Auch Land und Region sind Lücken, und sie fallen
 * beim Geokodieren ohnehin mit ab. Wer einmal die Stadt bestimmt, hat alle
 * drei erledigt.
 *
 * `geprueft` nimmt einen Eintrag dauerhaft heraus — für die Fälle, wo sich
 * nichts ermitteln lässt. Ohne diesen Ausweg stünden dieselben zehn
 * Zweifelsfälle bei jedem Aufruf wieder oben.
 */
const GUT = new Set(["wikidata_sitz", "handarbeit"]);
const BRAUCHBAR = new Set([...GUT, "region_iso3166_2"]);

/**
 * Was noch Handarbeit braucht — und was ausdrücklich nicht.
 *
 * Erste Fassung zählte jede Regionsmitte als Lücke. Ergebnis: 11'977 Einträge,
 * rund dreissig Stunden Klickarbeit. Das war falsch gedacht. Ein
 * ISO-3166-2-Mittelpunkt ist für einen Kanton oder ein Bundesland ungefähr
 * stadtgenau, und stadtgenau ist erklärtermassen genug. Zürich gegen Bern
 * gegen Lugano wird damit unterscheidbar — mehr will die Karte nicht.
 *
 * Wirklich schwach ist nur der Landesmittelpunkt: Er stapelt sämtliche Medien
 * eines Landes auf einen Punkt. Das ist die Arbeitsliste.
 */
function luecken(o, streng = false) {
  const l = [];
  const genug = streng ? GUT : BRAUCHBAR;
  if (!genug.has(o.ort_herkunft)) l.push("Ort");
  if (!o.land) l.push("Land");
  if (!o.region_iso && streng) l.push("Region");
  return l;
}
const offen = (o, streng = false) => !o.geprueft && luecken(o, streng).length > 0;

/**
 * Reihenfolge: reihum durch die Länder, innerhalb eines Landes nach Aufkommen.
 *
 * Reine Sortierung nach Meldungen pro Woche führt dazu, dass man dreihundert
 * koreanische Outlets abarbeitet, bevor das erste deutsche kommt — die grossen
 * Medienmärkte verdrängen alle anderen. Das Reihum-Verfahren ist dasselbe, mit
 * dem schon der Ingest seine Meldungen auswählt: erst das wichtigste Outlet
 * jedes Landes, dann das zweitwichtigste jedes Landes, und so fort.
 *
 * Nach hundert Einträgen hat man damit hundert Länder angefasst statt zwei.
 */
function reihum(liste) {
  const nachLand = new Map();
  for (const o of liste) {
    const k = o.land ?? "??";
    (nachLand.get(k) ?? nachLand.set(k, []).get(k)).push(o);
  }
  for (const gruppe of nachLand.values()) {
    gruppe.sort((a, b) => (b.pro_woche ?? 0) - (a.pro_woche ?? 0));
  }
  // Länder mit den aktivsten Spitzenmedien zuerst durch die Runde schicken.
  const laender = [...nachLand.values()].sort(
    (a, b) => (b[0].pro_woche ?? 0) - (a[0].pro_woche ?? 0),
  );
  // Bis zur längsten Ländergruppe zählen, nicht bis zu einer geratenen Zahl.
  // Mit fester Obergrenze fielen bei grossen Medienmärkten Einträge lautlos
  // hinten heraus — in einem Test 498 von 8100.
  const laengste = Math.max(...laender.map((g) => g.length));
  const out = [];
  for (let i = 0; i < laengste; i++) {
    for (const g of laender) if (g[i]) out.push(g[i]);
  }
  return out;
}

/**
 * Gleichnamige Städte auseinanderhalten.
 *
 * Frankfurt am Main und Frankfurt (Oder) liegen beide in Deutschland; eine
 * Einschränkung aufs Land hilft dort nicht. Springfield gibt es in den USA
 * dutzendfach. Und Nominatim sortiert nach Bekanntheit — meistens richtig,
 * manchmal still falsch, und „still falsch" ist die schlechteste Sorte Fehler.
 *
 * Die Auflösung steckt in Daten, die schon da sind: `pub_state` von Media Cloud
 * ist ein ISO-3166-2-Code und bei rund drei Vierteln der Outlets belegt. Ein
 * Treffer, dessen Region damit übereinstimmt, ist fast sicher der richtige.
 *
 * Deshalb bewertet der Server jeden Treffer, statt die Auswahl dem Zufall der
 * Sortierung zu überlassen:
 *
 *   2 — Region stimmt überein          → wird nach oben sortiert
 *   1 — Land stimmt, Region unbekannt  → plausibel
 *   0 — nichts bekannt                 → keine Aussage
 *  -1 — Land widerspricht              → wird ausdrücklich angezeigt
 */
function bewerten(treffer, land, region) {
  if (region && treffer.region && treffer.region.toUpperCase() === region.toUpperCase()) return 2;
  if (land && treffer.land && treffer.land.toUpperCase() !== land.toUpperCase()) return -1;
  if (land && treffer.land) return 1;
  return 0;
}

let letzteAbfrage = 0;
async function geokodieren(suche, land, region) {
  const wartezeit = 1100 - (Date.now() - letzteAbfrage);
  if (wartezeit > 0) await new Promise((r) => setTimeout(r, wartezeit));
  letzteAbfrage = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", suche);
  url.searchParams.set("format", "jsonv2");
  // Etwas grosszügiger als nötig: Erst nach dem Bewerten wird gekürzt, sonst
  // fiele der passende Treffer womöglich schon vor der Prüfung heraus.
  url.searchParams.set("limit", "10");
  url.searchParams.set("addressdetails", "1");
  if (land) url.searchParams.set("countrycodes", land.toLowerCase());

  const res = await fetch(url, { headers: { "User-Agent": KENNUNG } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const treffer = await res.json();
  return treffer.map((t) => {
    const a = t.address ?? {};
    return {
      name: t.display_name,
      lat: Number(t.lat),
      lon: Number(t.lon),
      typ: t.addresstype ?? t.type,
      // Nominatim gibt die Verwaltungsgliederung gleich mit — genau die
      // Angaben, die im Register fehlen. Der ISO-3166-2-Code steht je nach
      // Land auf unterschiedlicher Ebene, deshalb der Reihe nach probieren.
      land: (a.country_code ?? "").toUpperCase() || null,
      region: a["ISO3166-2-lvl4"] ?? a["ISO3166-2-lvl3"] ?? a["ISO3166-2-lvl6"] ?? null,
      region_name: a.state ?? a.region ?? a.county ?? null,
      stadt: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
    };
  })
    .map((x) => ({ ...x, gueltigkeit: bewerten(x, land, region) }))
    // Passende zuerst, Widersprüche zuletzt — aber nichts wird verschwiegen.
    // Wer ein Outlet bewusst einer anderen Region zuordnen will, soll das
    // können; er soll es nur nicht versehentlich tun.
    .sort((a, b) => b.gueltigkeit - a.gueltigkeit)
    .slice(0, 6);
}

async function speichern() {
  await writeFile(DATEI, JSON.stringify(outlets, null, 2));
}

// ------------------------------------------------------------------ Seite

const SEITE = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>Outlets verorten</title><style>
:root{--bg:#08090b;--fg:#f4f5f7;--fg2:#a2a7b0;--fg3:#6a6f79;
--line:rgba(255,255,255,.09);--flaeche:#0e0f12;--akzent:#4F9E72;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:400 14px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;
display:grid;grid-template-columns:340px 1fr;height:100vh;letter-spacing:-.01em}
.liste{border-right:1px solid var(--line);overflow-y:auto}
.kopf{padding:16px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:1}
.kopf h1{margin:0 0 3px;font-size:15px;font-weight:600;letter-spacing:-.02em}
.kopf p{margin:0;font-size:12px;color:var(--fg3)}
.eintrag{padding:11px 18px;border-bottom:1px solid var(--line);cursor:pointer}
.eintrag:hover{background:rgba(255,255,255,.03)}
.eintrag.ist-aktiv{background:rgba(79,158,114,.13);box-shadow:inset 2px 0 0 var(--akzent)}
.eintrag__n{font-weight:500}
.eintrag__m{font-size:12px;color:var(--fg3);margin-top:2px}
.arbeit{padding:34px 38px;overflow-y:auto}
.leer{color:var(--fg3);margin-top:40vh;text-align:center}
h2{margin:0 0 4px;font-size:22px;font-weight:600;letter-spacing:-.03em}
.meta{color:var(--fg2);font-size:13px;margin-bottom:26px}
.meta a{color:var(--fg2)}
label{display:block;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--fg3);margin-bottom:7px}
input{width:100%;max-width:460px;padding:11px 13px;border-radius:9px;
border:1px solid var(--line);background:var(--flaeche);color:var(--fg);font:inherit}
input:focus{outline:2px solid var(--akzent);outline-offset:1px;border-color:transparent}
.treffer{margin-top:14px;max-width:560px}
.treffer button{all:unset;display:block;width:100%;padding:11px 13px;border-radius:9px;
cursor:pointer;border:1px solid var(--line);margin-bottom:7px;background:var(--flaeche)}
.treffer button:hover{border-color:var(--akzent)}
.treffer small{display:block;color:var(--fg3);margin-top:2px;font-size:12px}
.hinweis{margin-top:22px;color:var(--fg3);font-size:12.5px;max-width:460px;line-height:1.55}
kbd{background:rgba(255,255,255,.1);border-radius:4px;padding:1px 5px;font-size:11px;font-family:inherit}
.fertig{color:var(--akzent)}
.schalter{display:flex;align-items:center;gap:7px;margin-top:9px;font-size:12px;
color:var(--fg3);text-transform:none;letter-spacing:0;cursor:pointer}
.schalter input{width:auto;margin:0}
.bilanz{margin-top:8px;font-size:11.5px;color:var(--fg3);line-height:1.7}
.bilanz b{color:var(--fg2);font-weight:500;font-variant-numeric:tabular-nums}
.marke{display:inline-block;margin-left:5px;padding:1px 6px;border-radius:4px;
font-size:10px;letter-spacing:.03em;background:rgba(220,168,78,.15);color:#DCA84E}
.passt{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:4px;
font-size:10.5px;background:rgba(79,158,114,.18);color:var(--akzent)}
.warnt{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:4px;
font-size:10.5px;background:rgba(196,81,78,.18);color:#E08C89}
.treffer button.ist-fraglich{opacity:.62}
.treffer button.ist-fraglich:hover{opacity:1;border-color:#C4514E}
.fuellt{display:block;color:var(--akzent);margin-top:3px;font-size:11.5px}
.aktionen{margin-top:20px}
.aktionen button{all:unset;cursor:pointer;padding:8px 14px;border-radius:8px;
border:1px solid var(--line);color:var(--fg2);font-size:13px}
.aktionen button:hover{color:var(--fg);border-color:var(--fg3)}
</style></head><body>
<div class="liste"><div class="kopf"><h1>Outlets verorten</h1><p id="stand"></p>
<label class="schalter"><input type="checkbox" id="streng"> auch Regionsmitten zeigen</label>
</div><div id="eintraege"></div></div>
<div class="arbeit" id="arbeit"><p class="leer">Links ein Outlet wählen.</p></div>
<script>
let daten=[],aktiv=null,suchTimer;
const $=(s)=>document.querySelector(s);

let gesamt=0,zahlen={};
async function laden(){
  try{
    const streng=$('#streng').checked?'1':'0';
    const a=await (await fetch('/api/outlets?streng='+streng,{cache:'no-store'})).json();
    if(!Array.isArray(a.liste)) throw new Error('Unerwartete Antwort: '+JSON.stringify(a).slice(0,200));
    daten=a.liste;gesamt=a.gesamt;zahlen=a.zahlen;
    zeichnen();
    waehlen(daten.length?0:-1);
  }catch(e){
    // Eine leere Liste ohne Begründung ist das Schlimmste, was hier passieren
    // kann — man sucht dann im Datenbestand statt im Fehler.
    $('#eintraege').innerHTML='<div class="eintrag"><div class="eintrag__n">Laden fehlgeschlagen</div>'+
      '<div class="eintrag__m">'+esc(e.message)+'</div></div>';
    $('#arbeit').innerHTML='<p class="leer">Neu laden mit Cmd+Shift+R.</p>';
  }
}
function zeichnen(){
  $('#stand').innerHTML = (gesamt ? '<b>'+gesamt+'</b> offen'+(gesamt>daten.length?' · '+daten.length+' geladen':'') : 'nichts mehr offen')+
    '<span class="bilanz">'+
    '<b>'+(zahlen.sitz||0)+'</b> echter Sitz<br>'+
    '<b>'+(zahlen.region||0)+'</b> Regionsmitte — reicht<br>'+
    '<b>'+(zahlen.land||0)+'</b> Landesmitte — Arbeitsliste</span>';
  $('#eintraege').innerHTML = daten.map((o,i)=>
    '<div class="eintrag'+(i===aktiv?' ist-aktiv':'')+'" data-i="'+i+'">'+
    '<div class="eintrag__n">'+esc(o.name||o.domain)+
    (o.luecken||[]).map(l=>'<span class="marke">'+l+'</span>').join('')+'</div>'+
    '<div class="eintrag__m">'+esc(o.domain)+' · '+(o.land||'Land?')+
    (o.menge!=null?' · '+o.menge+' Meldungen':o.pro_woche?' · '+o.pro_woche+'/Woche':'')+
    '</div></div>').join('');
  document.querySelectorAll('.eintrag').forEach(el=>
    el.onclick=()=>waehlen(+el.dataset.i));
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

function waehlen(i){
  aktiv=i;zeichnen();
  const o=i>=0?daten[i]:null;
  if(!o){$('#arbeit').innerHTML='<p class="leer fertig">Nichts mehr offen.</p>';return}
  $('#arbeit').innerHTML=
    '<h2>'+esc(o.name||o.domain)+'</h2>'+
    '<p class="meta"><a href="'+esc(o.homepage||'#')+'" target="_blank" rel="noopener">'+esc(o.domain)+'</a>'+
    ' · '+(o.land||'Land unbekannt')+(o.region_iso?' · '+esc(o.region_iso):'')+
    (o.sprache?' · '+esc(o.sprache):'')+
    ' · Punkt bisher: '+(o.ort_herkunft==='region_iso3166_2'?'Regionsmitte':o.ort_herkunft==='land'?'Landesmitte':o.ort_herkunft==='wikidata_sitz'?'Redaktionssitz':'keiner')+'</p>'+
    '<p class="meta">Es fehlt: <strong>'+(o.luecken||[]).join(', ')+'</strong></p>'+
    '<label for="stadt">Stadt des Redaktionssitzes</label>'+
    '<input id="stadt" autocomplete="off" placeholder="z. B. Zürich">'+
    '<div class="treffer" id="treffer"></div>'+
    '<div class="aktionen"><button id="skip">Überspringen — nicht ermittelbar</button></div>'+
    '<p class="hinweis"><kbd>Enter</kbd> übernimmt den obersten Treffer — bei '+
    'gleichnamigen Städten steht der, dessen Region zum Outlet passt, oben. '+
    'Gefüllt wird nur, was fehlt — ein Redaktionssitz aus Wikidata bleibt stehen. '+
    'Gespeichert wird sofort in data/outlets.json.</p>';
  $('#skip').onclick=()=>sichern(null);
  const feld=$('#stadt');feld.focus();
  feld.oninput=()=>{clearTimeout(suchTimer);suchTimer=setTimeout(()=>suchen(feld.value,o),350)};
  feld.onkeydown=(e)=>{
    if(e.key==='Enter'){e.preventDefault();const b=document.querySelector('.treffer button');if(b)b.click()}
    if(e.key==='ArrowDown'&&!feld.value){e.preventDefault();waehlen(Math.min(aktiv+1,daten.length-1))}
  };
}
async function suchen(q,o){
  if(q.trim().length<2){$('#treffer').innerHTML='';return}
  const r=await fetch('/api/geocode?q='+encodeURIComponent(q)+
    '&land='+(o.land||'')+'&region='+encodeURIComponent(o.region_iso||''));
  const t=await r.json();
  const fehlt=o.luecken||[];   // o ist der Parameter, nicht neu deklarieren
  $('#treffer').innerHTML=t.map((x,i)=>{
    const f=[];
    if(fehlt.includes('Ort')) f.push('Ort');
    if(fehlt.includes('Land')&&x.land) f.push('Land '+x.land);
    if(fehlt.includes('Region')&&x.region) f.push('Region '+x.region);
    const marke = x.gueltigkeit===2 ? '<span class="passt">passt zu '+esc(o.region_iso)+'</span>'
                : x.gueltigkeit===-1 ? '<span class="warnt">Land weicht ab: '+esc(x.land)+' statt '+esc(o.land)+'</span>'
                : '';
    return '<button data-i="'+i+'" class="'+(x.gueltigkeit===-1?'ist-fraglich':'')+'">'+
      esc(x.name.split(',')[0])+marke+
      '<small>'+esc(x.name)+'</small>'+
      (f.length?'<span class="fuellt">füllt: '+esc(f.join(' · '))+'</span>':'')+'</button>';
  }).join('')||'<p class="hinweis">Nichts gefunden.</p>';
  document.querySelectorAll('.treffer button').forEach(b=>
    b.onclick=()=>sichern(t[+b.dataset.i]));
}
async function sichern(treffer){
  const o=daten[aktiv];
  const rumpf = treffer
    ? {domain:o.domain,lat:treffer.lat,lon:treffer.lon,land:treffer.land,
       region:treffer.region,stadt:treffer.stadt}
    : {domain:o.domain,ueberspringen:true};
  await fetch('/api/outlet',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(rumpf)});
  daten.splice(aktiv,1);
  if(aktiv>=daten.length)aktiv=daten.length-1;
  zeichnen();waehlen(aktiv);
}
$('#streng').onchange=laden;
laden();
</script></body></html>`;

// ------------------------------------------------------------------ Server

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Ein Werkzeug, das sich im Betrieb ändert, darf nichts zwischenspeichern
  // lassen. Ohne diesen Kopf liefert der Browser nach einer Änderung die alte
  // Seite gegen die neue Schnittstelle aus — und zeigt eine leere Liste, ohne
  // dass irgendwo ein Fehler sichtbar wird.
  const OHNE_CACHE = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  };
  const json = (o, code = 200) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...OHNE_CACHE });
    res.end(JSON.stringify(o));
  };

  try {
    if (url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...OHNE_CACHE });
      return res.end(SEITE);
    }

    if (url.pathname === "/api/outlets") {
      if (DB) {
        // Aus der Datenbank kommt die Liste bereits richtig sortiert — nach
        // unseren Meldungszahlen. Reihum durch die Länder wäre hier falsch:
        // Es geht nicht um Abdeckung, sondern um Wirkung je Klick.
        const roh = await rpc("outlets_offen", {
          p_min_meldungen: MIN, p_nur_ereignisse: false, p_limit: 800,
        });
        return json({
          liste: roh.map((r) => ({
            domain: r.domain,
            name: r.name,
            land: r.country,
            region_iso: r.region_iso,
            sprache: r.language,
            homepage: r.homepage,
            ort_herkunft: r.geo_quelle,
            menge: Number(r.meldungen),
            luecken: [
              ...(GUT.has(r.geo_quelle) ? [] : ["Ort"]),
              ...(r.country ? [] : ["Land"]),
            ],
          })),
          gesamt: roh.length,
          zahlen: { db: true, min: MIN },
        });
      }

      const streng = url.searchParams.get("streng") === "1";
      const liste = reihum(outlets.filter((o) => offen(o, streng)))
        // Welche Angaben fehlen, entscheidet der Server. Dieselbe Regel im
        // Browser nochmal zu schreiben hiesse, sie zweimal pflegen zu müssen.
        .map((o) => ({ ...o, luecken: luecken(o, streng) }));
      return json({
        liste: liste.slice(0, 600),
        gesamt: liste.length,
        zahlen: {
          sitz: outlets.filter((o) => GUT.has(o.ort_herkunft)).length,
          region: outlets.filter((o) => o.ort_herkunft === "region_iso3166_2").length,
          land: outlets.filter((o) => o.ort_herkunft === "land").length,
          keiner: outlets.filter((o) => !o.ort_herkunft).length,
        },
      });
    }

    if (url.pathname === "/api/geocode") {
      const q = url.searchParams.get("q") ?? "";
      const land = url.searchParams.get("land") ?? "";
      const region = url.searchParams.get("region") ?? "";
      return json(await geokodieren(q, land, region));
    }

    if (url.pathname === "/api/outlet" && req.method === "POST") {
      let roh = "";
      for await (const teil of req) roh += teil;
      const eingang = JSON.parse(roh);

      if (DB) {
        const [ergebnis] = await rpc("outlet_verorten", {
          p_domain: eingang.domain,
          p_lat: eingang.ueberspringen ? null : eingang.lat,
          p_lon: eingang.ueberspringen ? null : eingang.lon,
          p_stadt: eingang.stadt ?? null,
          p_land: eingang.land ?? null,
          p_region: eingang.region ?? null,
        });
        console.log(`  ${eingang.domain.padEnd(30)} ${ergebnis ?? "?"}`);
        return json({ ok: true });
      }

      const o = outlets.find((x) => x.domain === eingang.domain);
      if (!o) return json({ fehler: "unbekannt" }, 404);

      if (eingang.ueberspringen) {
        o.geprueft = true;
        await speichern();
        console.log(`  ${o.domain.padEnd(30)} übersprungen`);
        return json({ ok: true, rest: outlets.filter(offen).length });
      }

      const getan = [];

      // Die Koordinate nur, wenn die bisherige schwächer ist. Ein Sitz aus
      // Wikidata ist genauer als eine Stadtsuche und darf nicht verlorengehen,
      // bloss weil hier jemand das Land nachträgt.
      const ortSchwach = o.ort_herkunft !== "wikidata_sitz" && o.ort_herkunft !== "handarbeit";
      if (ortSchwach && eingang.lat != null) {
        o.lat = eingang.lat;
        o.lon = eingang.lon;
        o.ort_herkunft = "handarbeit";
        getan.push("Ort");
      }
      // Land und Region nur füllen, nie überschreiben.
      if (!o.land && eingang.land) { o.land = eingang.land; getan.push("Land"); }
      if (!o.region_iso && eingang.region) { o.region_iso = eingang.region; getan.push("Region"); }
      if (!o.stadt && eingang.stadt) o.stadt = eingang.stadt;

      o.geprueft = true;
      await speichern();
      const rest = outlets.filter(offen).length;
      console.log(`  ${o.domain.padEnd(28)} ${(getan.join(", ") || "nichts").padEnd(22)} noch ${rest}`);
      return json({ ok: true, rest });
    }

    res.writeHead(404).end("nicht gefunden");
  } catch (e) {
    console.error(e);
    json({ fehler: String(e.message ?? e) }, 500);
  }
});

server.listen(PORT, () => {
  if (DB) {
    console.log(`\n  Datenbank-Betrieb — sortiert nach unseren Meldungszahlen.`);
    console.log(`  Mindestens ${MIN} Meldungen. Ändern mit --min N.\n`);
    console.log(`  → http://localhost:${PORT}\n`);
    return;
  }
  const z = (f) => outlets.filter(f).length;
  console.log(`\n  ${outlets.length} Outlets`);
  console.log(`    ${String(z((o) => GUT.has(o.ort_herkunft))).padStart(6)}  echter Sitz`);
  console.log(`    ${String(z((o) => o.ort_herkunft === "region_iso3166_2")).padStart(6)}  Regionsmitte — reicht`);
  console.log(`    ${String(z((o) => o.ort_herkunft === "land")).padStart(6)}  Landesmitte — Arbeitsliste`);
  console.log(`    ${String(z((o) => !o.ort_herkunft)).padStart(6)}  ohne Punkt`);
  console.log(`\n  Offen: ${outlets.filter((o) => offen(o)).length}`);
  console.log(`\n  → http://localhost:${PORT}\n`);
  console.log("  Beenden mit Ctrl+C. Gespeichert wird nach jedem Treffer.\n");
});
