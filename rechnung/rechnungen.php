<?php
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/settings.php';
session_pruefen();

$page_titel = 'Rechnungen - RechnungsManager';

$gueltige_gruppen = ['week', 'month', 'quarter', 'year'];
$zeit_gruppe = $_GET['zeitraum'] ?? 'month';
if (!in_array($zeit_gruppe, $gueltige_gruppen, true)) {
    $zeit_gruppe = 'month';
}
$typ_filter = $_GET['typ'] ?? 'eingang';
if (!in_array($typ_filter, ['eingang', 'ausgang'], true)) {
    $typ_filter = 'eingang';
}
$kat_filter = trim((string)($_GET['kategorie'] ?? ''));
$edit_id = isset($_GET['edit']) ? (int)$_GET['edit'] : 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['save_id'])) {
    $save_id = (int)$_POST['save_id'];
    if ($save_id > 0) {
        $kategorie_id = (int)($_POST['kategorie_id'] ?? 0);
        $kategorie_name = 'Nicht kategorisiert';
        if ($kategorie_id > 0) {
            $stmt = $pdo->prepare('SELECT name FROM kategorien WHERE id = ?');
            $stmt->execute([$kategorie_id]);
            $found = $stmt->fetchColumn();
            if ($found) {
                $kategorie_name = (string)$found;
            }
        }
        $stmt = $pdo->prepare(
            'UPDATE rechnungen
             SET lieferant = ?, kategorie_id = ?, kategorie_name = ?, rechnung_typ = ?, faelligkeitsdatum = ?,
                 netto_betrag = ?, mwst_satz = ?, mwst_betrag = ?, brutto_betrag = ?, waehrung = ?, beschreibung = ?
             WHERE id = ?'
        );
        $stmt->execute([
            trim((string)($_POST['lieferant'] ?? '')),
            $kategorie_id > 0 ? $kategorie_id : null,
            $kategorie_name,
            in_array(($_POST['rechnung_typ'] ?? ''), ['eingang', 'ausgang'], true) ? $_POST['rechnung_typ'] : 'eingang',
            trim((string)($_POST['faelligkeitsdatum'] ?? '')) ?: null,
            (float)($_POST['netto_betrag'] ?? 0),
            (float)($_POST['mwst_satz'] ?? 0),
            (float)($_POST['mwst_betrag'] ?? 0),
            (float)($_POST['brutto_betrag'] ?? 0),
            strtoupper(trim((string)($_POST['waehrung'] ?? 'EUR'))) ?: 'EUR',
            trim((string)($_POST['beschreibung'] ?? '')),
            $save_id
        ]);
    }
    $query = http_build_query([
        'zeitraum' => $zeit_gruppe,
        'typ' => $typ_filter,
        'kategorie' => $kat_filter,
        'edit' => $save_id,
    ]);
    header('Location: rechnungen.php?' . $query);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['loeschen_id'])) {
    $loeschen_id = (int)$_POST['loeschen_id'];
    if ($loeschen_id > 0) {
        $stmt = $pdo->prepare('SELECT dateiname FROM rechnungen WHERE id = ?');
        $stmt->execute([$loeschen_id]);
        $dateiname = $stmt->fetchColumn();
        if ($dateiname) {
            $stmt = $pdo->prepare('DELETE FROM rechnungen WHERE id = ?');
            $stmt->execute([$loeschen_id]);
            $pfad = __DIR__ . '/uploads/' . $dateiname;
            if (is_file($pfad)) {
                @unlink($pfad);
            }
        }
    }
    $query = http_build_query([
        'zeitraum' => $zeit_gruppe,
        'typ' => $typ_filter,
        'kategorie' => $kat_filter,
    ]);
    header('Location: rechnungen.php?' . $query);
    exit;
}

function gruppen_label_rechnung(string $zeit_gruppe, string $datum): string {
    $ts = strtotime($datum);
    if ($zeit_gruppe === 'week') {
        return 'KW ' . date('W', $ts) . ' / ' . date('Y', $ts);
    }
    if ($zeit_gruppe === 'quarter') {
        $month = (int)date('n', $ts);
        $quarter = (int)ceil($month / 3);
        return 'Q' . $quarter . ' / ' . date('Y', $ts);
    }
    if ($zeit_gruppe === 'year') {
        return date('Y', $ts);
    }
    return date('m.Y', $ts);
}

function rechnungen_gruppieren_rechnung(array $rechnungen, string $zeit_gruppe): array {
    $gruppen = [];
    foreach ($rechnungen as $rechnung) {
        $key = gruppen_label_rechnung($zeit_gruppe, $rechnung['hochladezeit']);
        if (!isset($gruppen[$key])) {
            $gruppen[$key] = [];
        }
        $gruppen[$key][] = $rechnung;
    }
    return $gruppen;
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

$kategorien = $pdo->query('SELECT * FROM kategorien WHERE aktiv = 1 ORDER BY name')->fetchAll();

if ($kat_filter !== '') {
    $eingang_rechnungen = array_values(array_filter($eingang_rechnungen, static function ($r) use ($kat_filter) {
        return (string)($r['kategorie_name'] ?? '') === $kat_filter;
    }));
    $ausgang_rechnungen = array_values(array_filter($ausgang_rechnungen, static function ($r) use ($kat_filter) {
        return (string)($r['kategorie_name'] ?? '') === $kat_filter;
    }));
}

$aktive_rechnungen = $typ_filter === 'ausgang' ? $ausgang_rechnungen : $eingang_rechnungen;
$aktive_gruppen = rechnungen_gruppieren_rechnung($aktive_rechnungen, $zeit_gruppe);
$edit_rechnung = null;
if ($edit_id > 0) {
    $stmt = $pdo->prepare('SELECT * FROM rechnungen WHERE id = ?');
    $stmt->execute([$edit_id]);
    $edit_rechnung = $stmt->fetch();
}

function render_rechnungs_card_rechnung(array $rechnung, array $kategorien, string $zeit_gruppe, string $typ_filter, string $kat_filter): void {
    $kat_farbe = '';
    foreach ($kategorien as $kat) {
        if ($kat['name'] === $rechnung['kategorie_name']) {
            $kat_farbe = $kat['farbe'];
            break;
        }
    }
    ?>
    <div class="rechnung-row" data-kategorie="<?php echo htmlspecialchars($rechnung['kategorie_name'] ?? ''); ?>">
        <button
            type="button"
            class="thumb-btn"
            data-file="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>"
            data-type="<?php echo htmlspecialchars($rechnung['dateityp'] ?? ''); ?>"
            title="Vorschau öffnen"
        >
            <?php if (strpos($rechnung['dateityp'], 'pdf') !== false): ?>
                <span class="thumb-pdf">PDF</span>
            <?php else: ?>
                <img src="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>" class="rechnung-thumb" alt="Rechnung">
            <?php endif; ?>
        </button>
        <div class="row-main">
            <span class="rechnung-badge" style="background:<?php echo $kat_farbe ?: '#95A5A6'; ?>">
                <?php echo htmlspecialchars($rechnung['kategorie_name'] ?: 'Nicht kategorisiert'); ?>
            </span>
            <strong><?php echo htmlspecialchars($rechnung['lieferant'] ?: 'Unbekannt'); ?></strong>
            <span class="rechnung-betrag"><?php echo number_format((float)($rechnung['brutto_betrag'] ?? 0), 2, ',', ' '); ?> <?php echo htmlspecialchars($rechnung['waehrung'] ?? 'EUR'); ?></span>
            <span class="row-meta">Netto: <?php echo number_format((float)($rechnung['netto_betrag'] ?? 0), 2, ',', ' '); ?></span>
            <span class="row-meta">MwSt: <?php echo htmlspecialchars((string)($rechnung['mwst_satz'] ?? '0')); ?>%</span>
            <span class="row-meta"><?php echo date('d.m.Y H:i', strtotime($rechnung['hochladezeit'])); ?></span>
            <?php if (!empty($rechnung['beschreibung'])): ?>
                <span class="row-meta"><?php echo htmlspecialchars($rechnung['beschreibung']); ?></span>
            <?php endif; ?>
        </div>
        <div class="row-actions">
            <a href="uploads/<?php echo htmlspecialchars($rechnung['dateiname']); ?>" target="_blank" class="action-square action-view" title="Ansehen" aria-label="Ansehen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
            </a>
            <a href="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => $typ_filter, 'kategorie' => $kat_filter, 'edit' => (int)$rechnung['id']]); ?>#edit-panel" class="action-square action-edit" title="Bearbeiten" aria-label="Bearbeiten">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9"/>
                    <path d="M16.5 3.5a2.1 2.1 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/>
                </svg>
            </a>
            <form method="POST" class="delete-form" onsubmit="return confirm('Rechnung wirklich löschen?');">
                <input type="hidden" name="loeschen_id" value="<?php echo (int)$rechnung['id']; ?>">
                <button type="submit" class="action-square action-delete" title="Löschen" aria-label="Löschen">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3,6 5,6 21,6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </form>
        </div>
    </div>
    <?php
}

require_once __DIR__ . '/includes/header.php';
?>

<?php if ($edit_rechnung): ?>
<section id="edit-panel" class="edit-panel">
    <h2>Rechnung bearbeiten</h2>
    <p>Hier können Sie die Rechnung korrigieren: Kategorie, Beträge, Lieferant, Fälligkeit und Kommentar.</p>
    <div class="edit-layout">
        <div class="edit-preview">
            <?php if (strpos((string)$edit_rechnung['dateityp'], 'pdf') !== false): ?>
                <object data="uploads/<?php echo htmlspecialchars($edit_rechnung['dateiname']); ?>#page=1&view=FitH" type="application/pdf" class="edit-doc"></object>
            <?php else: ?>
                <img src="uploads/<?php echo htmlspecialchars($edit_rechnung['dateiname']); ?>" class="edit-doc" alt="Rechnung">
            <?php endif; ?>
        </div>
        <form method="POST" class="edit-form">
            <input type="hidden" name="save_id" value="<?php echo (int)$edit_rechnung['id']; ?>">
            <div class="edit-grid">
                <div class="form-group"><label>Lieferant</label><input type="text" name="lieferant" value="<?php echo htmlspecialchars((string)$edit_rechnung['lieferant']); ?>"></div>
                <div class="form-group">
                    <label>Kategorie</label>
                    <select name="kategorie_id">
                        <option value="0">Keine Kategorie</option>
                        <?php foreach ($kategorien as $kat): ?>
                            <option value="<?php echo (int)$kat['id']; ?>" <?php echo ((int)$edit_rechnung['kategorie_id'] === (int)$kat['id']) ? 'selected' : ''; ?>><?php echo htmlspecialchars($kat['name']); ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Rechnungstyp</label>
                    <select name="rechnung_typ">
                        <option value="eingang" <?php echo ($edit_rechnung['rechnung_typ'] ?? 'eingang') === 'eingang' ? 'selected' : ''; ?>>Eingang</option>
                        <option value="ausgang" <?php echo ($edit_rechnung['rechnung_typ'] ?? '') === 'ausgang' ? 'selected' : ''; ?>>Ausgang</option>
                    </select>
                </div>
                <div class="form-group"><label>Fälligkeit</label><input type="date" name="faelligkeitsdatum" value="<?php echo htmlspecialchars((string)($edit_rechnung['faelligkeitsdatum'] ?? '')); ?>"></div>
                <div class="form-group"><label>Netto</label><input type="number" step="0.01" name="netto_betrag" value="<?php echo htmlspecialchars((string)($edit_rechnung['netto_betrag'] ?? '0')); ?>"></div>
                <div class="form-group"><label>MwSt.-Satz</label><input type="number" step="0.01" name="mwst_satz" value="<?php echo htmlspecialchars((string)($edit_rechnung['mwst_satz'] ?? '0')); ?>"></div>
                <div class="form-group"><label>MwSt.-Betrag</label><input type="number" step="0.01" name="mwst_betrag" value="<?php echo htmlspecialchars((string)($edit_rechnung['mwst_betrag'] ?? '0')); ?>"></div>
                <div class="form-group"><label>Brutto</label><input type="number" step="0.01" name="brutto_betrag" value="<?php echo htmlspecialchars((string)($edit_rechnung['brutto_betrag'] ?? '0')); ?>"></div>
                <div class="form-group"><label>Währung</label><input type="text" name="waehrung" value="<?php echo htmlspecialchars((string)($edit_rechnung['waehrung'] ?? 'EUR')); ?>"></div>
                <div class="form-group full"><label>Beschreibung</label><input type="text" name="beschreibung" value="<?php echo htmlspecialchars((string)($edit_rechnung['beschreibung'] ?? '')); ?>"></div>
            </div>
            <div class="edit-actions">
                <a href="uploads/<?php echo htmlspecialchars($edit_rechnung['dateiname']); ?>" target="_blank" class="btn btn-outline">Ansehen</a>
                <button type="submit" formaction="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => $typ_filter, 'kategorie' => $kat_filter]); ?>" formmethod="post" name="loeschen_id" value="<?php echo (int)$edit_rechnung['id']; ?>" class="btn btn-outline">Löschen</button>
                <button type="submit" class="btn btn-primary">Speichern</button>
            </div>
        </form>
    </div>
</section>
<?php endif; ?>

<section class="rechnungen-section">
    <div class="section-header">
        <h2>Meine Rechnungen</h2>
        <div class="filter-group">
            <form method="GET">
                <input type="hidden" name="typ" value="<?php echo htmlspecialchars($typ_filter); ?>">
                <input type="hidden" name="kategorie" value="<?php echo htmlspecialchars($kat_filter); ?>">
                <select name="zeitraum" class="filter-select" onchange="this.form.submit()">
                    <option value="week" <?php echo $zeit_gruppe === 'week' ? 'selected' : ''; ?>>Wöchentlich (KW)</option>
                    <option value="month" <?php echo $zeit_gruppe === 'month' ? 'selected' : ''; ?>>Monatlich</option>
                    <option value="quarter" <?php echo $zeit_gruppe === 'quarter' ? 'selected' : ''; ?>>Quartal</option>
                    <option value="year" <?php echo $zeit_gruppe === 'year' ? 'selected' : ''; ?>>Jährlich</option>
                </select>
            </form>
        </div>
    </div>

    <div class="rechnungen-layout">
        <aside class="rechnungen-sidebar">
            <h3>Rechnungstyp</h3>
            <div class="type-buttons">
                <a class="type-btn <?php echo $typ_filter === 'eingang' ? 'active' : ''; ?>" href="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => 'eingang', 'kategorie' => $kat_filter]); ?>">Eingangsrechnungen</a>
                <a class="type-btn <?php echo $typ_filter === 'ausgang' ? 'active' : ''; ?>" href="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => 'ausgang', 'kategorie' => $kat_filter]); ?>">Ausgangsrechnungen</a>
            </div>
            <h3>Kategorien</h3>
            <div class="category-list">
                <a class="category-item <?php echo $kat_filter === '' ? 'active' : ''; ?>" href="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => $typ_filter]); ?>">
                    <span class="cat-color" style="background:#cbd5e1;"></span>
                    <span class="cat-label">Alle Kategorien</span>
                </a>
                <?php foreach ($kategorien as $kat): ?>
                    <a class="category-item <?php echo $kat_filter === $kat['name'] ? 'active' : ''; ?>" href="rechnungen.php?<?php echo http_build_query(['zeitraum' => $zeit_gruppe, 'typ' => $typ_filter, 'kategorie' => $kat['name']]); ?>">
                        <span class="cat-color" style="background:<?php echo htmlspecialchars($kat['farbe'] ?: '#95A5A6'); ?>;"></span>
                        <span class="cat-label"><?php echo htmlspecialchars($kat['name']); ?></span>
                    </a>
                <?php endforeach; ?>
            </div>
        </aside>
        <div class="rechnungen-content">
            <h3 class="split-title"><?php echo $typ_filter === 'ausgang' ? 'Ausgangsrechnungen' : 'Eingangsrechnungen'; ?></h3>
            <?php if (empty($aktive_rechnungen)): ?>
                <p class="empty-note">Für diesen Filter wurden keine Rechnungen gefunden.</p>
            <?php else: ?>
                <?php foreach ($aktive_gruppen as $gruppenname => $rechnungen): ?>
                    <h4 class="group-title"><?php echo htmlspecialchars($gruppenname); ?></h4>
                    <div class="rechnungen-grid">
                        <?php foreach ($rechnungen as $rechnung): ?>
                            <?php render_rechnungs_card_rechnung($rechnung, $kategorien, $zeit_gruppe, $typ_filter, $kat_filter); ?>
                        <?php endforeach; ?>
                    </div>
                <?php endforeach; ?>
            <?php endif; ?>
        </div>
    </div>
</section>


<div id="previewModal" class="preview-modal" hidden>
    <div class="preview-backdrop" data-close="1"></div>
    <div class="preview-content">
        <button type="button" class="preview-close" data-close="1">Schließen</button>
        <div id="previewBody"></div>
    </div>
</div>

<script>
document.querySelectorAll('.thumb-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
        const file = this.dataset.file || '';
        const type = (this.dataset.type || '').toLowerCase();
        const body = document.getElementById('previewBody');
        const modal = document.getElementById('previewModal');
        if (!file || !body || !modal) return;

        if (type.includes('pdf')) {
            body.innerHTML = '<object data=\"' + file + '#toolbar=1\" type=\"application/pdf\" class=\"preview-doc\"></object>';
        } else {
            body.innerHTML = '<img src=\"' + file + '\" alt=\"Rechnung\" class=\"preview-doc\">';
        }
        modal.hidden = false;
    });
});

document.querySelectorAll('[data-close=\"1\"]').forEach(function(el) {
    el.addEventListener('click', function() {
        const modal = document.getElementById('previewModal');
        const body = document.getElementById('previewBody');
        if (modal && body) {
            modal.hidden = true;
            body.innerHTML = '';
        }
    });
});
</script>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
