<?php
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/settings.php';
session_pruefen();

$page_titel = 'Verwaltung - RechnungsManager';

// Neue Kategorie erstellen
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['aktion'])) {
    if ($_POST['aktion'] === 'kat_erstellen') {
        $name = trim($_POST['kat_name']);
        $beschreibung = trim($_POST['kat_beschreibung']);
        $farbe = $_POST['kat_farbe'];
        if ($name) {
            $stmt = $pdo->prepare('INSERT INTO kategorien (name, beschreibung, farbe) VALUES (?, ?, ?)');
            $stmt->execute([$name, $beschreibung, $farbe]);
            $erfolg = 'Kategorie wurde erstellt.';
        }
    } elseif ($_POST['aktion'] === 'kat_deaktivieren') {
        $stmt = $pdo->prepare('UPDATE kategorien SET aktiv = 0 WHERE id = ?');
        $stmt->execute([$_POST['kat_id']]);
        $erfolg = 'Kategorie wurde deaktiviert.';
    } elseif ($_POST['aktion'] === 'rek_kategorie') {
        $stmt = $pdo->prepare('UPDATE rechnungen SET kategorie_id = ?, kategorie_name = ? WHERE id = ?');
        $stmt->execute([$_POST['kat_id'], $_POST['kat_name'], $_POST['rek_id']]);
        $erfolg = 'Kategorie wurde aktualisiert.';
    } elseif ($_POST['aktion'] === 'rek_loeschen') {
        $stmt = $pdo->prepare('SELECT dateipfad FROM rechnungen WHERE id = ?');
        $stmt->execute([$_POST['rek_id']]);
        $rechnung = $stmt->fetch();
        if ($rechnung) {
            $datei_pfad = UPLOAD_DIR . basename($rechnung['dateipfad']);
            if (file_exists($datei_pfad)) unlink($datei_pfad);
        }
        $stmt = $pdo->prepare('DELETE FROM rechnungen WHERE id = ?');
        $stmt->execute([$_POST['rek_id']]);
        $erfolg = 'Rechnung wurde geloscht.';
    } elseif ($_POST['aktion'] === 'api_key_speichern') {
        $api_key = trim($_POST['openrouter_api_key'] ?? '');
        app_setting_speichern('openrouter_api_key', $api_key);
        $erfolg = 'API-Key wurde gespeichert.';
    } elseif ($_POST['aktion'] === 'budget_speichern') {
        $kategorie_id = (int)($_POST['budget_kategorie_id'] ?? 0);
        $monatsbudget = (float)($_POST['monatsbudget'] ?? 0);
        if ($kategorie_id > 0) {
            $stmt = $pdo->prepare("
                INSERT INTO kategorie_budgets (kategorie_id, monatsbudget)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE monatsbudget = VALUES(monatsbudget)
            ");
            $stmt->execute([$kategorie_id, $monatsbudget]);
            $erfolg = 'Monatsbudget wurde gespeichert.';
        }
    }
}

$gespeicherter_api_key = app_setting_holen('openrouter_api_key', '');
$maskierter_api_key = $gespeicherter_api_key !== ''
    ? substr($gespeicherter_api_key, 0, 10) . str_repeat('*', max(strlen($gespeicherter_api_key) - 14, 4)) . substr($gespeicherter_api_key, -4)
    : 'Nicht gesetzt';

$kategorien = $pdo->query('SELECT * FROM kategorien ORDER BY name')->fetchAll();
$rechnungen = $pdo->query('SELECT r.*, k.farbe as kat_farbe FROM rechnungen r LEFT JOIN kategorien k ON r.kategorie_id = k.id ORDER BY r.hochladezeit DESC')->fetchAll();
$budget_rows = $pdo->query("
    SELECT kb.kategorie_id, kb.monatsbudget, k.name AS kategorie_name
    FROM kategorie_budgets kb
    JOIN kategorien k ON k.id = kb.kategorie_id
")->fetchAll();
$budgets = [];
foreach ($budget_rows as $b) {
    $budgets[(int)$b['kategorie_id']] = (float)$b['monatsbudget'];
}

// Statistik: En cok harcama yapilan donem (ay bazli)
$top_zeitraum = $pdo->query("
    SELECT DATE_FORMAT(hochladezeit, '%Y-%m') AS zeitraum,
           SUM(COALESCE(brutto_betrag, 0)) AS toplam
    FROM rechnungen
    GROUP BY DATE_FORMAT(hochladezeit, '%Y-%m')
    ORDER BY toplam DESC
    LIMIT 1
")->fetch();

// Statistik: En cok harcama yapilan kategori
$top_kategorie = $pdo->query("
    SELECT COALESCE(kategorie_name, 'Nicht kategorisiert') AS kategorie,
           SUM(COALESCE(brutto_betrag, 0)) AS toplam
    FROM rechnungen
    GROUP BY COALESCE(kategorie_name, 'Nicht kategorisiert')
    ORDER BY toplam DESC
    LIMIT 1
")->fetch();

// Statistik: En cok fatura gelen tedarikci
$top_lieferant = $pdo->query("
    SELECT COALESCE(NULLIF(TRIM(lieferant), ''), 'Unbekannt') AS lieferant,
           COUNT(*) AS anzahl
    FROM rechnungen
    GROUP BY COALESCE(NULLIF(TRIM(lieferant), ''), 'Unbekannt')
    ORDER BY anzahl DESC
    LIMIT 1
")->fetch();

$gesamt_anzahl = (int)$pdo->query("SELECT COUNT(*) FROM rechnungen")->fetchColumn();
$gesamt_summe = (float)$pdo->query("SELECT COALESCE(SUM(brutto_betrag), 0) FROM rechnungen")->fetchColumn();
$avg_betrag = (float)$pdo->query("SELECT COALESCE(AVG(brutto_betrag), 0) FROM rechnungen")->fetchColumn();

$eingang_summe = (float)$pdo->query("SELECT COALESCE(SUM(brutto_betrag), 0) FROM rechnungen WHERE rechnung_typ = 'eingang'")->fetchColumn();
$ausgang_summe = (float)$pdo->query("SELECT COALESCE(SUM(brutto_betrag), 0) FROM rechnungen WHERE rechnung_typ = 'ausgang'")->fetchColumn();
$eingang_count = (int)$pdo->query("SELECT COUNT(*) FROM rechnungen WHERE rechnung_typ = 'eingang'")->fetchColumn();
$ausgang_count = (int)$pdo->query("SELECT COUNT(*) FROM rechnungen WHERE rechnung_typ = 'ausgang'")->fetchColumn();
$netto_cashflow = $ausgang_summe - $eingang_summe;

$trend_30 = $pdo->query("
    SELECT
      SUM(CASE WHEN hochladezeit >= (NOW() - INTERVAL 30 DAY) THEN COALESCE(brutto_betrag,0) ELSE 0 END) AS aktuelle_30,
      SUM(CASE WHEN hochladezeit >= (NOW() - INTERVAL 60 DAY)
                AND hochladezeit < (NOW() - INTERVAL 30 DAY) THEN COALESCE(brutto_betrag,0) ELSE 0 END) AS vorherige_30
    FROM rechnungen
")->fetch();
$aktuelle_30 = (float)($trend_30['aktuelle_30'] ?? 0);
$vorherige_30 = (float)($trend_30['vorherige_30'] ?? 0);
$trend_delta = $vorherige_30 > 0 ? (($aktuelle_30 - $vorherige_30) / $vorherige_30) * 100 : 0;

$offene_ueberfaellig = (int)$pdo->query("
    SELECT COUNT(*) FROM rechnungen
    WHERE rechnung_typ = 'eingang'
      AND faelligkeitsdatum IS NOT NULL
      AND faelligkeitsdatum < CURDATE()
")->fetchColumn();
$naechste_7_tage = (int)$pdo->query("
    SELECT COUNT(*) FROM rechnungen
    WHERE rechnung_typ = 'eingang'
      AND faelligkeitsdatum IS NOT NULL
      AND faelligkeitsdatum BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
")->fetchColumn();
$niedrige_ocr = (int)$pdo->query("
    SELECT COUNT(*) FROM rechnungen
    WHERE COALESCE(qualitaet_score, 0) < 50
")->fetchColumn();

$budget_alerts = $pdo->query("
    SELECT k.id, k.name, k.farbe, kb.monatsbudget,
           COALESCE(SUM(r.brutto_betrag), 0) AS ausgegeben
    FROM kategorie_budgets kb
    JOIN kategorien k ON k.id = kb.kategorie_id
    LEFT JOIN rechnungen r ON r.kategorie_id = k.id
      AND DATE_FORMAT(r.hochladezeit, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')
      AND r.rechnung_typ = 'eingang'
    GROUP BY k.id, k.name, k.farbe, kb.monatsbudget
    ORDER BY (COALESCE(SUM(r.brutto_betrag), 0) / NULLIF(kb.monatsbudget,0)) DESC
")->fetchAll();

$insight_payload = [
    'gesamt_anzahl' => $gesamt_anzahl,
    'gesamt_summe_eur' => round($gesamt_summe, 2),
    'avg_rechnung_eur' => round($avg_betrag, 2),
    'eingang_summe_eur' => round($eingang_summe, 2),
    'ausgang_summe_eur' => round($ausgang_summe, 2),
    'netto_cashflow_eur' => round($netto_cashflow, 2),
    'top_zeitraum' => $top_zeitraum['zeitraum'] ?? null,
    'top_kategorie' => $top_kategorie['kategorie'] ?? null,
    'top_lieferant' => $top_lieferant['lieferant'] ?? null,
    'trend_30_tage_prozent' => round($trend_delta, 2),
];

$ki_insights = [];
$ki_quelle = 'fallback';
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, INSIGHTS_API);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode([
    'stats' => $insight_payload,
    'api_key' => $gespeicherter_api_key,
]));
curl_setopt($ch, CURLOPT_TIMEOUT, 10);
$ki_response = curl_exec($ch);
$ki_err = curl_error($ch);
curl_close($ch);

if (!$ki_err && $ki_response) {
    $ki_data = json_decode($ki_response, true);
    if (!empty($ki_data['insights']) && is_array($ki_data['insights'])) {
        $ki_insights = array_slice($ki_data['insights'], 0, 4);
        $ki_quelle = $ki_data['quelle'] ?? 'ki';
    }
}
if (empty($ki_insights)) {
    $ki_insights = [
        'Priorisieren Sie die Top-Kategorie mit monatlichem Budgetlimit und Alarm ab 90%.',
        'Verhandeln Sie beim häufigsten Lieferanten Mengenrabatt oder Sammelrechnung.',
        'Analysieren Sie den stärksten Ausgabenmonat und markieren Sie vermeidbare Kostenblöcke.',
        'Pflegen Sie Ausgangsrechnungen vollständig, um Netto-Cashflow zuverlässig zu steuern.'
    ];
}

require_once __DIR__ . '/includes/header.php';
?>

<div class="page-admin">
    <div class="admin-layout">
        <!-- Links: Kategorien -->
        <aside class="admin-sidebar">
            <div class="admin-card">
                <h3>Kategorien verwalten</h3>

                <?php if (isset($erfolg)): ?>
                    <div class="alert alert-success"><?php echo htmlspecialchars($erfolg); ?></div>
                <?php endif; ?>

                <form method="POST" class="kat-form">
                    <input type="hidden" name="aktion" value="kat_erstellen">
                    <div class="form-group">
                        <label for="kat_name">Kategoriename</label>
                        <input type="text" id="kat_name" name="kat_name" required placeholder="Neue Kategorie">
                    </div>
                    <div class="form-group">
                        <label for="kat_beschreibung">Beschreibung</label>
                        <input type="text" id="kat_beschreibung" name="kat_beschreibung" placeholder="Beschreibung">
                    </div>
                    <div class="form-group">
                        <label for="kat_farbe">Farbe</label>
                        <input type="color" id="kat_farbe" name="kat_farbe" value="#6366F1" class="color-picker">
                    </div>
                    <button type="submit" class="btn btn-primary btn-full">+ Neue Kategorie</button>
                </form>

                <hr style="margin: 16px 0; border: 0; border-top: 1px solid var(--border);">
                <h3 style="margin-top:0">Monatsbudget pro Kategorie</h3>
                <form method="POST" class="kat-form">
                    <input type="hidden" name="aktion" value="budget_speichern">
                    <div class="form-group">
                        <label for="budget_kategorie_id">Kategorie</label>
                        <select id="budget_kategorie_id" name="budget_kategorie_id" required>
                            <?php foreach ($kategorien as $kat): ?>
                                <option value="<?php echo (int)$kat['id']; ?>">
                                    <?php echo htmlspecialchars($kat['name']); ?>
                                    <?php if (isset($budgets[(int)$kat['id']])): ?>
                                        (<?php echo number_format($budgets[(int)$kat['id']], 2, ',', ' '); ?> EUR)
                                    <?php endif; ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="monatsbudget">Monatsbudget (EUR)</label>
                        <input type="number" id="monatsbudget" name="monatsbudget" min="0" step="0.01" placeholder="z.B. 1500">
                    </div>
                    <button type="submit" class="btn btn-outline btn-full">Budget speichern</button>
                </form>

                <hr style="margin: 16px 0; border: 0; border-top: 1px solid var(--border);">
                <h3 style="margin-top:0">KI API-Schlüssel</h3>
                <div class="api-key-hint">Aktuell: <?php echo htmlspecialchars($maskierter_api_key); ?></div>
                <form method="POST" class="kat-form">
                    <input type="hidden" name="aktion" value="api_key_speichern">
                    <div class="form-group">
                        <label for="openrouter_api_key">OpenRouter API-Key</label>
                        <input type="password" id="openrouter_api_key" name="openrouter_api_key" placeholder="sk-or-v1-..." autocomplete="off">
                    </div>
                    <button type="submit" class="btn btn-outline btn-full">API-Key speichern</button>
                </form>

                <div class="kat-liste">
                    <?php foreach ($kategorien as $kat): ?>
                        <div class="kat-item">
                            <span class="kat-farbe" style="background:<?php echo htmlspecialchars($kat['farbe']); ?>;"></span>
                            <span class="kat-name"><?php echo htmlspecialchars($kat['name']); ?></span>
                            <?php if ($kat['id'] > 8): ?>
                            <form method="POST" style="display:inline;" onsubmit="return confirm('Deaktivieren?')">
                                <input type="hidden" name="aktion" value="kat_deaktivieren">
                                <input type="hidden" name="kat_id" value="<?php echo $kat['id']; ?>">
                                <button type="submit" class="btn-icon" title="Deaktivieren">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
                                    </svg>
                                </button>
                            </form>
                            <?php endif; ?>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </aside>

        <!-- Rechts: Rechnungen -->
        <section class="admin-main">
            <div class="stats-grid">
                <div class="stats-card">
                    <div class="stats-label">Höchste Ausgabenphase</div>
                    <div class="stats-value">
                        <?php echo $top_zeitraum ? htmlspecialchars(date('m.Y', strtotime($top_zeitraum['zeitraum'] . '-01'))) : '-'; ?>
                    </div>
                    <div class="stats-sub">
                        <?php echo $top_zeitraum ? number_format((float)$top_zeitraum['toplam'], 2, ',', ' ') . ' EUR' : 'Noch keine Daten'; ?>
                    </div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Top-Kategorie nach Betrag</div>
                    <div class="stats-value">
                        <?php echo $top_kategorie ? htmlspecialchars($top_kategorie['kategorie']) : '-'; ?>
                    </div>
                    <div class="stats-sub">
                        <?php echo $top_kategorie ? number_format((float)$top_kategorie['toplam'], 2, ',', ' ') . ' EUR' : 'Noch keine Daten'; ?>
                    </div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Häufigster Lieferant</div>
                    <div class="stats-value">
                        <?php echo $top_lieferant ? htmlspecialchars($top_lieferant['lieferant']) : '-'; ?>
                    </div>
                    <div class="stats-sub">
                        <?php echo $top_lieferant ? (int)$top_lieferant['anzahl'] . ' Rechnungen' : 'Noch keine Daten'; ?>
                    </div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Gesamtüberblick</div>
                    <div class="stats-value"><?php echo $gesamt_anzahl; ?> Rechnungen</div>
                    <div class="stats-sub"><?php echo number_format($gesamt_summe, 2, ',', ' '); ?> EUR gesamt</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Ø Rechnungsbetrag</div>
                    <div class="stats-value"><?php echo number_format($avg_betrag, 2, ',', ' '); ?> EUR</div>
                    <div class="stats-sub">Durchschnitt pro Rechnung</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Eingang vs Ausgang</div>
                    <div class="stats-value"><?php echo $eingang_count; ?> / <?php echo $ausgang_count; ?></div>
                    <div class="stats-sub">Eingang / Ausgang (Anzahl)</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Netto-Cashflow</div>
                    <div class="stats-value <?php echo $netto_cashflow >= 0 ? 'up' : 'down'; ?>">
                        <?php echo number_format($netto_cashflow, 2, ',', ' '); ?> EUR
                    </div>
                    <div class="stats-sub">Ausgang - Eingang</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">30-Tage Trend</div>
                    <div class="stats-value <?php echo $trend_delta <= 0 ? 'up' : 'down'; ?>">
                        <?php echo ($trend_delta >= 0 ? '+' : '') . number_format($trend_delta, 2, ',', ' '); ?>%
                    </div>
                    <div class="stats-sub">gegenüber vorherigen 30 Tagen</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Überfällige Rechnungen</div>
                    <div class="stats-value down"><?php echo $offene_ueberfaellig; ?></div>
                    <div class="stats-sub">Eingangsrechnungen mit überschrittener Fälligkeit</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Fällig in 7 Tagen</div>
                    <div class="stats-value"><?php echo $naechste_7_tage; ?></div>
                    <div class="stats-sub">Frühwarnung für Liquiditätsplanung</div>
                </div>
                <div class="stats-card">
                    <div class="stats-label">Niedrige OCR-Qualität</div>
                    <div class="stats-value"><?php echo $niedrige_ocr; ?></div>
                    <div class="stats-sub">Rechnungen unter Qualitätsscore 50</div>
                </div>
            </div>

            <div class="admin-card ai-card">
                <h3>Budget-Warnungen (aktueller Monat)</h3>
                <?php if (empty($budget_alerts)): ?>
                    <div class="stats-sub">Noch keine Budgets gesetzt.</div>
                <?php else: ?>
                    <ul class="ai-list">
                        <?php foreach ($budget_alerts as $ba): ?>
                            <?php
                            $budget = (float)$ba['monatsbudget'];
                            $spent = (float)$ba['ausgegeben'];
                            $rate = $budget > 0 ? ($spent / $budget) * 100 : 0;
                            if ($budget <= 0 || $rate < 80) { continue; }
                            ?>
                            <li>
                                <?php echo htmlspecialchars($ba['name']); ?>:
                                <?php echo number_format($spent, 2, ',', ' '); ?> / <?php echo number_format($budget, 2, ',', ' '); ?> EUR
                                (<?php echo number_format($rate, 1, ',', ' '); ?>%)
                            </li>
                        <?php endforeach; ?>
                    </ul>
                <?php endif; ?>
            </div>

            <div class="admin-card ai-card">
                <h3>KI Handlungsempfehlungen</h3>
                <div class="ai-meta">Quelle: <?php echo htmlspecialchars(strtoupper($ki_quelle)); ?></div>
                <ul class="ai-list">
                    <?php foreach ($ki_insights as $insight): ?>
                        <li><?php echo htmlspecialchars($insight); ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>

        </section>
    </div>
</div>

<style>
.admin-layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 24px;
}
.admin-sidebar { display: flex; flex-direction: column; gap: 16px; }
.admin-card { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.admin-card h3 { margin: 0 0 16px; font-size: 1.1rem; color: var(--text); }
.stats-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
}
.stats-card {
    background: linear-gradient(140deg, #ffffff 0%, #f6f7ff 100%);
    border: 1px solid #e9ecff;
    border-radius: 14px;
    padding: 14px 16px;
    box-shadow: 0 3px 14px rgba(79, 70, 229, 0.08);
}
.stats-label { font-size: .78rem; color: var(--text-light); text-transform: uppercase; letter-spacing: .4px; }
.stats-value { margin-top: 4px; font-size: 1.05rem; font-weight: 700; color: var(--text); }
.stats-sub { margin-top: 2px; font-size: .85rem; color: #475569; }
.stats-value.up { color: #0f766e; }
.stats-value.down { color: #b91c1c; }
.ai-card { margin-bottom: 16px; border: 1px solid #e7e9ff; }
.ai-meta { font-size: .78rem; color: var(--text-light); margin-bottom: 10px; letter-spacing: .3px; }
.ai-list { margin: 0; padding-left: 18px; color: #334155; display: grid; gap: 8px; }
.api-key-hint { font-size: .82rem; color: var(--text-light); margin-bottom: 10px; }
.kat-form { margin-bottom: 20px; }
.color-picker { width: 100%; height: 40px; border: 2px solid var(--border); border-radius: 8px; cursor: pointer; }
.kat-liste { display: flex; flex-direction: column; gap: 8px; }
.kat-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px; background: var(--bg); }
.kat-farbe { width: 16px; height: 16px; border-radius: 4px; flex-shrink: 0; }
.kat-name { flex: 1; font-size: .9rem; }

@media (max-width: 900px) {
    .admin-layout { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: 1fr; }
}
</style>

<script>
</script>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
