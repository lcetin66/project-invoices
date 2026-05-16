<?php
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/settings.php';
session_pruefen();

$page_titel = 'Rechnungseingabe - RechnungsManager';

$ergebnis = null;
$fehler = [];
$gueltige_gruppen = ['day', 'week', 'month', 'year'];
$zeit_gruppe = $_GET['zeitraum'] ?? 'month';
if (!in_array($zeit_gruppe, $gueltige_gruppen, true)) {
    $zeit_gruppe = 'month';
}

function gruppen_label(string $zeit_gruppe, string $datum): string {
    $ts = strtotime($datum);
    if ($zeit_gruppe === 'day') {
        return date('d.m.Y', $ts);
    }
    if ($zeit_gruppe === 'week') {
        return 'KW ' . date('W', $ts) . ' / ' . date('Y', $ts);
    }
    if ($zeit_gruppe === 'year') {
        return date('Y', $ts);
    }
    return date('m.Y', $ts);
}

function rechnungen_gruppieren(array $rechnungen, string $zeit_gruppe): array {
    $gruppen = [];
    foreach ($rechnungen as $rechnung) {
        $key = gruppen_label($zeit_gruppe, $rechnung['hochladezeit']);
        if (!isset($gruppen[$key])) {
            $gruppen[$key] = [];
        }
        $gruppen[$key][] = $rechnung;
    }
    return $gruppen;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_FILES['rechnung_datei'])) {
    $datei = $_FILES['rechnung_datei'];
    $beschreibung = trim($_POST['beschreibung'] ?? '');
    $rechnung_typ = $_POST['rechnung_typ'] ?? 'auto';
    $faelligkeitsdatum = trim($_POST['faelligkeitsdatum'] ?? '');
    if ($faelligkeitsdatum === '') {
        $faelligkeitsdatum = null;
    }
    if (!in_array($rechnung_typ, ['auto', 'eingang', 'ausgang'], true)) {
        $rechnung_typ = 'auto';
    }

    $datei_name_lower = strtolower((string)($datei['name'] ?? ''));
    $gueltige_endungen = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
    $endung = pathinfo($datei_name_lower, PATHINFO_EXTENSION);
    $typ_ok = in_array((string)$datei['type'], ALLOWED_TYPES, true);
    $endung_ok = in_array($endung, $gueltige_endungen, true);

    if ($datei['error'] !== UPLOAD_ERR_OK) {
        $fehler[] = 'Fehler beim Hochladen der Datei.';
    } elseif (!$typ_ok && !$endung_ok) {
        $fehler[] = 'Nur PDF- und Bilddateien sind erlaubt.';
    } elseif ($datei['size'] > MAX_FILE_SIZE) {
        $fehler[] = 'Datei ist zu gro&szlig; (max. 10 MB).';
    } else {
        $api_url = CLASSIFIER_API;
        $gespeicherter_api_key = app_setting_holen('ai_api_key', app_setting_holen('openrouter_api_key', ''));
        $api_provider = app_setting_holen('ai_provider', 'openrouter');
        $ai_model = app_setting_holen('ai_model', 'openai/gpt-4o-mini');
        $ch = curl_init();

        $curl_file = new CURLFile($datei['tmp_name'], $datei['type'], $datei['name']);
        curl_setopt($ch, CURLOPT_URL, $api_url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: multipart/form-data']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, [
            'datei' => $curl_file,
            'api_key' => $gespeicherter_api_key,
            'api_provider' => $api_provider,
            'api_model' => $ai_model,
        ]);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 60);
        curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

        $antwort = curl_exec($ch);
        $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curl_err = curl_error($ch);
        curl_close($ch);

        if ($curl_err) {
            $fehler[] = 'API-Kommunikationsfehler: ' . htmlspecialchars($curl_err);
        } elseif ($http_code === 200 && $antwort) {
            $data = json_decode($antwort, true);
            if ($data && $data['erfolgreich']) {
                $lieferant_api = trim((string)($data['ergebnis']['lieferant'] ?? ''));
                $brutto_api = (float)($data['ergebnis']['brutto_betrag'] ?? 0);
                $is_bild = (
                    str_starts_with(strtolower((string)($datei['type'] ?? '')), 'image/')
                    || in_array(strtolower((string)pathinfo((string)($datei['name'] ?? ''), PATHINFO_EXTENSION)), ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'], true)
                );
                $leer_ergebnis = (($lieferant_api === '' || mb_strtolower($lieferant_api) === 'unbekannt') && $brutto_api <= 0.0);
                if ($leer_ergebnis) {
                    if ($is_bild) {
                        $fehler[] = 'Bildrechnung konnte nicht gelesen werden. Bitte OpenRouter API-Key in Verwaltung hinterlegen oder ein klareres Bild/PDF hochladen.';
                    } else {
                        $fehler[] = 'Rechnungsdaten konnten nicht zuverlässig extrahiert werden. Bitte Dateiqualität prüfen.';
                    }
                } else {
                $erkannter_typ = (string)($data['ergebnis']['rechnung_typ'] ?? 'eingang');
                if (!in_array($erkannter_typ, ['eingang', 'ausgang'], true)) {
                    $erkannter_typ = 'eingang';
                }
                $finaler_typ = $rechnung_typ === 'auto' ? $erkannter_typ : $rechnung_typ;

                $stmt = $pdo->prepare(
                    'INSERT INTO rechnungen (dateiname, dateipfad, dateityp, rechnung_typ, beschreibung, lieferant, kategorie_name, netto_betrag, mwst_satz, mwst_betrag, brutto_betrag, waehrung, qualitaet_score, faelligkeitsdatum)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $stmt->execute([
                    $data['datei_name'],
                    'uploads/' . $data['datei_name'],
                    $datei['type'],
                    $finaler_typ,
                    $beschreibung,
                    $data['ergebnis']['lieferant'],
                    $data['ergebnis']['kategorie'],
                    $data['ergebnis']['netto_betrag'] ?? null,
                    $data['ergebnis']['mwst_satz'] ?? null,
                    $data['ergebnis']['mwst_betrag'] ?? null,
                    $data['ergebnis']['brutto_betrag'] ?? null,
                    $data['ergebnis']['waehrung'] ?? 'EUR',
                    $data['qualitaet_score'] ?? 0,
                    $faelligkeitsdatum,
                ]);

                $ergebnis = $data['ergebnis'];
                $ergebnis['rechnung_typ'] = $finaler_typ;
                $ergebnis['datei_name'] = $data['datei_name'];
                }
            } else {
                $fehler[] = 'Klassifizierung fehlgeschlagen.';
            }
        } else {
            $fehler[] = 'Klassifizierungs-API nicht erreichbar. Python-Server l&auml;uft?';
        }
    }
}

$stmt = $pdo->query('SELECT r.*, k.farbe FROM rechnungen r LEFT JOIN kategorien k ON r.kategorie_id = k.id ORDER BY r.hochladezeit DESC');
$alle_rechnungen = $stmt->fetchAll();

$eingang_rechnungen = [];
$ausgang_rechnungen = [];
foreach ($alle_rechnungen as $rechnung) {
    $typ = $rechnung['rechnung_typ'] ?? 'eingang';
    if ($typ === 'ausgang') {
        $ausgang_rechnungen[] = $rechnung;
    } else {
        $eingang_rechnungen[] = $rechnung;
    }
}

$eingang_gruppen = rechnungen_gruppieren($eingang_rechnungen, $zeit_gruppe);
$ausgang_gruppen = rechnungen_gruppieren($ausgang_rechnungen, $zeit_gruppe);

$kategorien = $pdo->query('SELECT * FROM kategorien WHERE aktiv = 1 ORDER BY name')->fetchAll();

function render_rechnungs_card(array $rechnung, array $kategorien): void {
    $kat_farbe = '';
    foreach ($kategorien as $kat) {
        if ($kat['name'] === $rechnung['kategorie_name']) {
            $kat_farbe = $kat['farbe'];
            break;
        }
    }
    ?>
    <div class="rechnung-card" data-kategorie="<?php echo htmlspecialchars($rechnung['kategorie_name'] ?? ''); ?>">
        <div class="rechnung-card-header">
            <span class="rechnung-badge" style="background:<?php echo $kat_farbe ?: '#95A5A6'; ?>">
                <?php echo htmlspecialchars($rechnung['kategorie_name'] ?: 'Nicht kategorisiert'); ?>
            </span>
            <span class="rechnung-datum"><?php echo date('d.m.Y H:i', strtotime($rechnung['hochladezeit'])); ?></span>
        </div>
        <div class="rechnung-card-body">
            <div class="rechnung-vorschau">
                <?php if (strpos($rechnung['dateityp'], 'pdf') !== false): ?>
                    <object
                        data="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>#page=1&view=FitH"
                        type="application/pdf"
                        class="rechnung-thumb pdf-thumb"
                    >
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E74C3C" stroke-width="1.5">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14,2 14,8 20,8"/>
                        </svg>
                    </object>
                <?php else: ?>
                    <img src="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>" class="rechnung-thumb" alt="Rechnung">
                <?php endif; ?>
            </div>
            <div class="rechnung-info">
                <strong><?php echo htmlspecialchars($rechnung['lieferant'] ?: 'Unbekannter Lieferant'); ?></strong>
                <?php if ($rechnung['brutto_betrag']): ?>
                <span class="rechnung-betrag"><?php echo number_format($rechnung['brutto_betrag'], 2, ',', ' '); ?> <?php echo htmlspecialchars($rechnung['waehrung']); ?></span>
                <?php endif; ?>
                <?php if ($rechnung['beschreibung']): ?>
                <span class="rechnung-desc"><?php echo htmlspecialchars($rechnung['beschreibung']); ?></span>
                <?php endif; ?>
            </div>
        </div>
        <div class="rechnung-card-footer">
            <a href="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>" target="_blank" class="btn btn-sm btn-outline">Ansehen</a>
            <?php if (!$rechnung['kategorie_id']): ?>
            <button class="btn btn-sm btn-kategorie" data-rechnung-id="<?php echo $rechnung['id']; ?>" style="display:none">Kategorie zuweisen</button>
            <?php endif; ?>
        </div>
    </div>
    <?php
}

require_once __DIR__ . '/includes/header.php';
?>

<div class="page-eingabe">
    <section class="upload-section">
        <div class="section-header">
            <h2>Rechnung hochladen</h2>
            <p>Laden Sie Ihre Rechnung als PDF oder Bild hoch. Das System kategorisiert sie automatisch.</p>
        </div>

        <?php if ($fehler): ?>
            <div class="alert alert-error">
                <?php foreach ($fehler as $f): ?>
                    <div><?php echo htmlspecialchars($f); ?></div>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>

        <form method="POST" enctype="multipart/form-data" class="upload-zone" id="dropZone">
            <input type="hidden" name="MAX_FILE_SIZE" value="<?php echo MAX_FILE_SIZE; ?>">
            <div class="upload-zone-inner">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                </svg>
                <div class="upload-text">
                    <strong>Datei hier ablegen oder klicken</strong>
                    <span>PDF oder Bild (max. 10 MB)</span>
                </div>
                <input type="file" name="rechnung_datei" id="fileInput" class="file-input" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" required>
            </div>
            <div class="upload-actions">
                <input type="text" name="beschreibung" id="beschreibung" placeholder="Beschreibung (optional)">
                <input type="date" name="faelligkeitsdatum" id="faelligkeitsdatum" class="filter-select" title="Fälligkeitsdatum">
                <select name="rechnung_typ" id="rechnung_typ" class="filter-select">
                    <option value="auto" selected>Automatisch erkennen</option>
                    <option value="eingang">Eingangsrechnung (erhalten)</option>
                    <option value="ausgang">Ausgangsrechnung (gestellt)</option>
                </select>
                <button type="submit" class="btn btn-primary btn-lg" id="submitBtn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                    </svg>
                    Hochladen &amp; Klassifizieren
                </button>
            </div>
        </form>
    </section>

    <?php if ($ergebnis): ?>
    <section class="ergebnis-section">
        <div class="section-header"><h2>Ergebnis der Klassifizierung</h2></div>
        <div class="ergebnis-card">
            <div class="ergebnis-badge" style="background: <?php echo $kategorien[0]['farbe'] ?? '#6366F1'; ?>;"><?php echo htmlspecialchars($ergebnis['kategorie']); ?></div>
            <div class="ergebnis-grid">
                <div class="ergebnis-item"><span class="ergebnis-label">Lieferant</span><span class="ergebnis-value"><?php echo htmlspecialchars($ergebnis['lieferant']); ?></span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">Nettobetrag</span><span class="ergebnis-value"><?php echo htmlspecialchars($ergebnis['netto_betrag'] ?? '0'); ?> <?php echo htmlspecialchars($ergebnis['waehrung'] ?? 'EUR'); ?></span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">MwSt.</span><span class="ergebnis-value"><?php echo htmlspecialchars($ergebnis['mwst_satz'] ?? ''); ?>%</span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">MwSt.-Betrag</span><span class="ergebnis-value"><?php echo htmlspecialchars($ergebnis['mwst_betrag'] ?? '0'); ?> <?php echo htmlspecialchars($ergebnis['waehrung'] ?? 'EUR'); ?></span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">Bruttobetrag</span><span class="ergebnis-value highlight"><?php echo htmlspecialchars($ergebnis['brutto_betrag'] ?? '0'); ?> <?php echo htmlspecialchars($ergebnis['waehrung'] ?? 'EUR'); ?></span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">Kategorie</span><span class="ergebnis-value"><?php echo htmlspecialchars($ergebnis['kategorie']); ?></span></div>
                <div class="ergebnis-item"><span class="ergebnis-label">Rechnungstyp</span><span class="ergebnis-value"><?php echo htmlspecialchars(($ergebnis['rechnung_typ'] ?? 'eingang') === 'ausgang' ? 'Ausgang' : 'Eingang'); ?></span></div>
            </div>
            <div class="btn-row"><a href="rechnungen.php" class="btn btn-outline">Zu Rechnungen</a></div>
        </div>
    </section>
    <?php endif; ?>
</div>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
