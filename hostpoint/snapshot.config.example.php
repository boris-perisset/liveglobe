<?php
/**
 * Nach snapshot.config.php kopieren und ausfüllen.
 * Diese Datei liegt bewusst NICHT im Repo (siehe .gitignore).
 *
 * Es wird nur der öffentliche anon-Key benötigt – der Snapshot liest ausschliesslich.
 */

declare(strict_types=1);

return [
    'supabase_url' => 'https://jgqnyrirzcgpmtykhrpm.supabase.co',
    'anon_key'     => 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpncW55cmlyemNncG10eWtocnBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMDcwNTYsImV4cCI6MjEwMjU4MzA1Nn0.8Hw32rVRl9Y_0DIlQgmu-EcY_sawVxsOpsrnAAfw0wg',

    // Absoluter Pfad zum data-Verzeichnis im Web-Root.
    'out_dir'      => __DIR__ . '/data',

    // Zoomstufe für die Cluster-Auflösung im Snapshot (2–4 sind sinnvoll).
    'zoom'         => 3,
];
