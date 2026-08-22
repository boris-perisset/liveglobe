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

    // Zoomstufe für die Cluster-Auflösung im Snapshot (2–4 sind sinnvoll).
    'zoom'         => 3,
];
