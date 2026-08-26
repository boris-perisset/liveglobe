<?php
/**
 * Nach snapshot.config.php kopieren und ausfüllen.
 * Diese Datei liegt bewusst NICHT im Repo (siehe .gitignore).
 *
 * Es wird nur der oeffentliche Lese-Schluessel benoetigt – der Snapshot liest
 * ausschliesslich. Supabase → Project Settings → API Keys → publishable key
 * (`sb_publishable_…`). Der alte anon-Key (`eyJ…`) tut es auch, laeuft aber
 * Ende 2026 aus.
 *
 * **Auch hier keinen echten Schluessel eintragen.** Diese Vorlage ist
 * versioniert; der Platzhalter bleibt stehen. Es war schon einmal anders, und
 * GitGuardian hat es gemeldet.
 */

declare(strict_types=1);

return [
    'supabase_url' => 'https://jgqnyrirzcgpmtykhrpm.supabase.co',
    'anon_key'     => '<HIER_DEN_PUBLISHABLE_KEY_EINSETZEN>',

    // Absoluter Pfad zum data-Verzeichnis im Web-Root.
    'out_dir'      => __DIR__ . '/data',

    // Zoomstufe für die Cluster-Auflösung im Snapshot.
    //
    // Der Wert gehört an den **Startzoom der Karte** gekoppelt, nicht frei
    // gewählt: Der Snapshot ist die erste Ansicht, und die Karte fragt live
    // mit `Math.round(zoom)` nach. Bei Startzoom 1,4 heisst das 1 — mit einer
    // 3 hier ist die Startansicht viermal feiner gerastert als jede
    // Live-Abfrage derselben Ansicht, und beim ersten Nachladen springt die
    // Karte sichtbar um.
    //
    // Wer den Startzoom in `frontend/src/map/map.ts` ändert, ändert diesen
    // Wert mit.
    'zoom'         => 1,
];
