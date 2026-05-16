<?php
// Projekteinstellungen

define('UPLOAD_DIR', __DIR__ . '/../uploads/');
define('MAX_FILE_SIZE', 10485760); // 10 MB
define('ALLOWED_TYPES', [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/tiff',
    'image/webp',
    'image/heic',
    'image/heif',
    'application/pdf'
]);
define('CLASSIFIER_API', 'http://127.0.0.1:5000/api/klassifizieren');
define('INSIGHTS_API', 'http://127.0.0.1:5000/api/business_insights');

// Session-Einstellungen
ini_set('session.cookie_httponly', 1);
session_start();

function session_pruefen() {
    if (!isset($_SESSION['benutzer_id'])) {
        header('Location: index.php');
        exit;
    }
}

function aktueller_benutzer() {
    return isset($_SESSION['benutzername']) ? $_SESSION['benutzername'] : 'Gast';
}

function app_settings_table_sicherstellen() {
    global $pdo;
    static $ok = false;
    if ($ok) return;
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS app_settings (
            `key` VARCHAR(100) PRIMARY KEY,
            `value` TEXT,
            aktualisierungszeit TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    $ok = true;
}

function app_setting_holen(string $key, string $default = ''): string {
    global $pdo;
    app_settings_table_sicherstellen();
    $stmt = $pdo->prepare("SELECT `value` FROM app_settings WHERE `key` = ?");
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value !== false ? (string)$value : $default;
}

function app_setting_speichern(string $key, string $value): void {
    global $pdo;
    app_settings_table_sicherstellen();
    $stmt = $pdo->prepare("
        INSERT INTO app_settings (`key`, `value`) VALUES (?, ?)
        ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)
    ");
    $stmt->execute([$key, $value]);
}

?>
