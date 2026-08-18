<?php
/**
 * Nach snapshot.config.php kopieren und ausfüllen.
 * Diese Datei liegt bewusst NICHT im Repo (siehe .gitignore).
 *
 * Es wird nur der öffentliche anon-Key benötigt – der Snapshot liest ausschliesslich.
 */

declare(strict_types=1);

return [
    'supabase_url' => 'https://<PROJECT_REF>.supabase.co',
    'anon_key'     => '<anon public key>',

    // Absoluter Pfad zum data-Verzeichnis im Web-Root.
    'out_dir'      => __DIR__ . '/data',

    // Zoomstufe für die Cluster-Auflösung im Snapshot (2–4 sind sinnvoll).
    'zoom'         => 3,
];
