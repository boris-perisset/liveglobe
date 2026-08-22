<?php
/**
 * Globe News – Snapshot-Cron für Hostpoint
 *
 * Holt alle paar Minuten die Cluster der letzten 24 Stunden EINMAL aus Supabase
 * und legt sie als statische JSON-Datei im Web-Root ab. Damit lädt jeder Besucher
 * vom eigenen Server statt von Supabase – das hält den 5-GB-Egress des Free Tiers
 * praktisch unangetastet und macht die Startansicht spürbar schneller.
 *
 * Cronjob im Hostpoint Control Panel:
 *   Intervall:  ​*​/5 * * * *
 *   Befehl:     /usr/local/bin/php /home/<user>/www/globenews/snapshot.php
 *
 * Konfiguration erfolgt über die Datei snapshot.config.php daneben
 * (aus snapshot.config.example.php kopieren) – so landen keine Keys im Repo.
 */

declare(strict_types=1);

// Nur über die Kommandozeile, also über den Cron. Die .htaccess sperrt diese
// Datei zwar auch, aber darauf ist kein Verlass: Versteckte Dateien fallen beim
// Hochladen gern unter den Tisch, und eine Serverkonfiguration kann sich ändern.
// Ohne diese Sperre könnte jeder Aufruf von aussen eine Supabase-Abfrage
// auslösen – das Gegenteil dessen, wofür der Snapshot da ist.
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    header('Content-Type: text/plain; charset=utf-8');
    exit("Dieses Skript läuft ausschliesslich über den Cron.\n");
}

$configFile = __DIR__ . '/snapshot.config.php';
if (!is_file($configFile)) {
    fwrite(STDERR, "snapshot.config.php fehlt – aus snapshot.config.example.php erstellen.\n");
    exit(1);
}

/** @var array{supabase_url:string,anon_key:string,out_dir:string,zoom:int} $config */
$config = require $configFile;

$outDir = rtrim($config['out_dir'], '/');
if (!is_dir($outDir) && !mkdir($outDir, 0755, true) && !is_dir($outDir)) {
    fwrite(STDERR, "Zielverzeichnis {$outDir} nicht anlegbar.\n");
    exit(1);
}

$now  = new DateTimeImmutable('now', new DateTimeZone('UTC'));
$from = $now->sub(new DateInterval('PT24H'));

// Ereignis-Bubbles, wie die Karte sie auch live holt.
//
// Zwischenzeitlich standen hier `events_clustered` (Bubbles auf Mittelwerten
// zwischen echten Orten — falsch) und `places_clustered` (Orte statt
// Ereignisse). `event_bubbles` verdichtet Ereignisse zuerst je Ort und setzt
// die Bubble auf den staerksten echten Ort der Zelle.
$payload = json_encode([
    'p_from'       => $from->format('Y-m-d\TH:i:s\Z'),
    'p_to'         => $now->format('Y-m-d\TH:i:s\Z'),
    'p_categories' => null,
    'p_zoom'       => (int) ($config['zoom'] ?? 3),
], JSON_THROW_ON_ERROR);

$ch = curl_init(rtrim($config['supabase_url'], '/') . '/rest/v1/rpc/event_bubbles');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 60,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'apikey: ' . $config['anon_key'],
        'Authorization: Bearer ' . $config['anon_key'],
        'Accept-Profile: public',
    ],
]);

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$err    = curl_error($ch);
curl_close($ch);

if ($body === false || $status !== 200) {
    fwrite(STDERR, "Supabase-Fehler ({$status}): " . ($err ?: substr((string) $body, 0, 300)) . "\n");
    exit(1); // Alten Snapshot stehen lassen – lieber leicht veraltet als leer.
}

$roh = json_decode($body, true, 512, JSON_THROW_ON_ERROR);
if (!is_array($roh)) {
    fwrite(STDERR, "Unerwartete Antwort von Supabase.\n");
    exit(1);
}

// In die Form bringen, die das Frontend erwartet. Die Umbenennung hier statt
// im Browser: Der Snapshot ist eine Datei, die jeder Besuch laedt — sie soll
// direkt verwendbar sein und kein Umrechnen erzwingen.
$clusters = array_map(static function (array $e): array {
    return [
        // Nur setzen, was auch belegt ist: `null` wuerde im Browser als
        // gesetzter Wert durchgehen und einen Klick ins Leere laufen lassen.
        'event_id'      => $e['event_id'] ?? null,
        'article_id'    => $e['article_id'] ?? null,
        'lat'           => $e['lat'],
        'lon'           => $e['lon'],
        'n'             => $e['n'],
        'orte'          => $e['orte'],
        'ereignisse'    => $e['ereignisse'],
        'outlets'       => $e['outlets'] ?? null,
        'country'       => $e['country'],
        'location_name' => $e['location_name'],
        'top_id'        => $e['top_id'],
        'top_title'     => $e['top_title'],
        'top_category'  => $e['top_category'],
    ];
}, $roh);

// `zoom` gehoert mit in die Datei: Das Frontend muss wissen, mit welcher
// Rasterweite hier gruppiert wurde, sonst kann es nicht entscheiden, ab wann
// der Snapshot zu grob ist und live gerechnet werden muss.
$snapshot = json_encode([
    'generated_at' => $now->format('c'),
    'from'         => $from->format('c'),
    'to'           => $now->format('c'),
    'zoom'         => (int) ($config['zoom'] ?? 3),
    'clusters'     => $clusters,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

// Atomar schreiben, damit nie eine halbe Datei ausgeliefert wird.
$target = $outDir . '/latest.json';
$tmp    = $target . '.tmp';
file_put_contents($tmp, $snapshot);
rename($tmp, $target);

// Vorkomprimierte Variante für mod_deflate/gzip_static.
$gz = $outDir . '/latest.json.gz';
file_put_contents($gz . '.tmp', gzencode($snapshot, 6));
rename($gz . '.tmp', $gz);

// Tagesarchiv: einmal pro Stunde eine Kopie, damit der Date-Slider auch ohne
// Supabase-Abfrage in die jüngste Vergangenheit blicken kann.
$hourly = $outDir . '/' . $now->format('Y-m-d_H') . '.json';
if (!is_file($hourly)) {
    file_put_contents($hourly, $snapshot);
    // Archiv auf 8 Tage begrenzen.
    foreach (glob($outDir . '/20*.json') ?: [] as $file) {
        if (filemtime($file) < time() - 8 * 86400) {
            @unlink($file);
        }
    }
}

printf(
    "OK – %d Cluster, %d Bytes, %s\n",
    count($clusters),
    strlen($snapshot),
    $now->format('c')
);
