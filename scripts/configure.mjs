#!/usr/bin/env node
/**
 * Schreibt die lokalen Konfigurationsdateien, damit die Supabase-Schlüssel nur
 * einmal eingegeben werden müssen. Nichts davon verlässt den Rechner.
 *
 * Zwei Wege:
 *
 *   node scripts/configure.mjs
 *       fragt die Werte nacheinander ab — **der bessere Weg.** Was hier
 *       eingetippt wird, landet nicht in der Shell-Historie.
 *
 *   node scripts/configure.mjs <project-ref> <lese-key> [schreib-key]
 *       nimmt sie direkt entgegen. Bequem, aber die Schlüssel stehen danach
 *       dauerhaft in `~/.zsh_history`.
 *
 * Berührt:
 *   frontend/.env.local            Lese-Schlüssel fürs Frontend
 *   hostpoint/snapshot.config.php  Lese-Schlüssel für den Snapshot-Cron
 *   .env.local                     Schreib-Schlüssel für Seed, Deploy, Register
 *
 * ---------------------------------------------------------------------------
 * Zusammenführen statt überschreiben
 * ---------------------------------------------------------------------------
 *
 * Die `.env.local`-Dateien wurden früher komplett neu geschrieben. Wer dort von
 * Hand etwas ergänzt hatte — den Media-Cloud-Schlüssel etwa —, verlor es beim
 * nächsten Lauf **wortlos**. Jetzt werden nur die bekannten Zeilen ersetzt;
 * alles andere bleibt so stehen, wie es dasteht, samt Kommentaren.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.stdout.write("\nLive Globe – Konfiguration\n──────────────────────────\n");

async function ask(frage) {
  const { createInterface } = await import("node:readline");
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(frage, (antwort) => {
      rl.close();
      resolve(antwort.trim());
    });
  });
}

/**
 * Welche Rechte trägt ein Schlüssel?
 *
 * Zwei Formen sind unterwegs: die neuen `sb_publishable_` / `sb_secret_`, die
 * ihre Rolle im Namen tragen, und die alten JWTs, bei denen sie im Nutzteil
 * steht. Beide müssen erkannt werden — sonst rutscht der falsche an die
 * falsche Stelle, und das fällt erst auf, wenn es zu spät ist.
 */
function rolle(schluessel) {
  if (!schluessel) return "?";
  if (schluessel.startsWith("sb_publishable_")) return "anon";
  if (schluessel.startsWith("sb_secret_")) return "service_role";
  try {
    const teil = schluessel.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(teil, "base64").toString()).role ?? "?";
  } catch {
    return "?";
  }
}

/**
 * Bekannte Zeilen ersetzen, unbekannte stehen lassen, fehlende anhängen.
 *
 * `export ` bleibt erhalten, wo es schon stand: Die Wurzel-Datei wird mit
 * `source` gelesen und braucht es, die Frontend-Datei liest Vite und darf es
 * nicht haben.
 */
async function zusammenfuehren(pfad, werte, kopf, praefixNeu = "") {
  let alt = "";
  try {
    alt = await readFile(pfad, "utf8");
  } catch {
    // Gibt es noch nicht – dann wird sie eben angelegt.
  }

  const offen = new Map(Object.entries(werte));
  const zeilen = alt ? alt.replace(/\n+$/, "").split("\n") : [];

  const neu = zeilen.map((zeile) => {
    const treffer = /^(\s*(?:export\s+)?)([A-Z0-9_]+)(\s*)=/.exec(zeile);
    if (!treffer) return zeile;
    const [, praefix, name] = treffer;
    if (!offen.has(name)) return zeile;
    const wert = offen.get(name);
    offen.delete(name);
    return `${praefix}${name}=${wert}`;
  });

  if (neu.length === 0 && kopf) neu.push(kopf);
  for (const [name, wert] of offen) neu.push(`${praefixNeu}${name}=${wert}`);

  await writeFile(pfad, neu.join("\n") + "\n");
}

/** Sieht der Wert nach einem Schlüssel aus statt nach dem, was gefragt war? */
function istSchluessel(wert) {
  return /^(sb_(publishable|secret)_|eyJ)/.test(wert);
}

/**
 * Die Project Ref steht schon da.
 *
 * Sie ändert sich nie — sie gehört zum Projekt, nicht zum Schlüssel. Sie beim
 * Schlüsseltausch erneut abzufragen, heisst drei Eingaben nebeneinander zu
 * stellen, von denen zwei gleich aussehen und eine nicht. Genau dort ist ein
 * Schlüssel in das Ref-Feld gerutscht. Also: aus der vorhandenen Datei lesen
 * und nur fragen, wenn wirklich nichts da ist.
 */
async function bekannteRef() {
  for (const pfad of [join(root, "frontend", ".env.local"), join(root, ".env.local")]) {
    try {
      const inhalt = await readFile(pfad, "utf8");
      const treffer = /https:\/\/([a-z0-9]{15,25})\.supabase\.co/.exec(inhalt);
      if (treffer) return treffer[1];
    } catch {
      // Datei fehlt – dann eben die nächste.
    }
  }
  return "";
}

try {
  const [argRef, argAnon, argService] = process.argv.slice(2);

  let ref = argRef;
  let anon = argAnon;
  let service = argService;

  if (!ref && !argAnon) ref = await bekannteRef();

  if (!ref || !anon) {
    process.stdout.write(
      "Die Schlüssel stehen im Supabase-Dashboard unter Settings → API Keys.\n" +
        "Bevorzugt die neuen: sb_publishable_… zum Lesen, sb_secret_… zum\n" +
        "Schreiben. Die alten eyJ… tun es auch, laufen aber Ende 2026 aus.\n\n",
    );
    if (ref) {
      process.stdout.write(`Projekt: ${ref}  (aus der vorhandenen Konfiguration)\n\n`);
    } else {
      ref = await ask("Project Ref — die Kennung aus der Projekt-URL, keine Schlüssel: ");
    }
    anon = anon || (await ask("Lese-Schlüssel (publishable / anon): "));
    service = service || (await ask("Schreib-Schlüssel (secret / service_role, Enter zum Überspringen): "));
  }

  ref = (ref || "").trim();
  anon = (anon || "").trim();
  service = (service || "").trim();

  if (!ref) throw new Error("Keine Project Ref angegeben.");
  if (!anon) throw new Error("Kein Lese-Schlüssel angegeben.");

  // Ein Schlüssel im Ref-Feld ist kein Grenzfall, sondern eine verrutschte
  // Zeile. Früher stand hier nur ein Hinweis und es wurde trotzdem geschrieben
  // — heraus kam die Adresse `https://sb_publishable_….supabase.co`, unter der
  // es kein Projekt gibt. Das ist genau die Sorte Fehler, die diesem Projekt
  // schon zu oft still durchgegangen ist. Also: abbrechen.
  if (istSchluessel(ref)) {
    throw new Error(
      "Im Feld für die Project Ref steht ein Schlüssel. Gefragt ist die " +
        "Projektkennung aus der URL (etwa abcdefghijklmnop), nicht sb_… oder eyJ…",
    );
  }

  // Der teuerste denkbare Vertipper: ein Schreib-Schlüssel im Frontend. Vite
  // backt ihn ins Bündel, das Bündel liegt öffentlich auf dem Webserver — und
  // ein Schreib-Schlüssel umgeht sämtliche Zeilenrechte.
  if (rolle(anon) === "service_role") {
    throw new Error(
      "Der Lese-Schlüssel hat Schreibrechte. Er käme ins Frontend-Bündel und " +
        "damit für jeden sichtbar. Abgebrochen — bitte den publishable/anon-Schlüssel nehmen.",
    );
  }
  if (service && rolle(service) === "anon") {
    throw new Error(
      "Der Schreib-Schlüssel trägt nur Leserechte. Damit laufen Seed und " +
        "Register durch, ohne etwas zu schreiben. Abgebrochen.",
    );
  }

  // Falls jemand die ganze URL einsetzt statt nur der Ref
  const refMatch = /^https?:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(ref);
  if (refMatch) ref = refMatch[1];

  if (!/^[a-z0-9]{15,25}$/.test(ref)) {
    throw new Error(
      `"${ref}" ist keine Project Ref. Erwartet werden 15–25 Kleinbuchstaben ` +
        "und Ziffern — der Teil vor .supabase.co in der Projekt-URL.",
    );
  }

  const url = `https://${ref}.supabase.co`;
  const geschrieben = [];

  await zusammenfuehren(
    join(root, "frontend", ".env.local"),
    {
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_ANON_KEY: anon,
      VITE_SNAPSHOT_URL: "./data/latest.json",
    },
    "# Von scripts/configure.mjs gepflegt – eigene Zeilen bleiben erhalten.",
  );
  geschrieben.push("frontend/.env.local");

  // Diese Datei wird ganz erzeugt: Sie enthält nichts von Hand Ergänztes, und
  // ihre Form muss zu `snapshot.php` passen.
  await mkdir(join(root, "hostpoint"), { recursive: true });
  await writeFile(
    join(root, "hostpoint", "snapshot.config.php"),
    `<?php
// Automatisch erzeugt von scripts/configure.mjs – nicht committen.

declare(strict_types=1);

return [
    'supabase_url' => '${url}',
    'anon_key'     => '${anon}',
    'out_dir'      => __DIR__ . '/data',
    'zoom'         => 3,
];
`,
  );
  geschrieben.push("hostpoint/snapshot.config.php");

  if (service) {
    await zusammenfuehren(
      join(root, ".env.local"),
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service },
      "# Von scripts/configure.mjs gepflegt – eigene Zeilen bleiben erhalten.",
      "export ",
    );
    geschrieben.push(".env.local");
  }

  process.stdout.write(`\nGeschrieben:\n${geschrieben.map((f) => "  " + f).join("\n")}\n`);
  process.stdout.write(
    service
      ? "\nWeiter mit:\n  cd frontend && npm run build\n  npm run deploy:hostpoint\n\n"
      : "\nOhne Schreib-Schlüssel kein Seed. Nochmal aufrufen, wenn du ihn hast.\n\n",
  );
} catch (fehler) {
  process.stderr.write(`\nFehlgeschlagen: ${fehler.message}\n\n`);
  process.exitCode = 1;
}
