<?php
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/config/settings.php';

$fehler = [];
$erfolg = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $benutzername = trim($_POST['benutzername'] ?? '');
    $passwort = $_POST['passwort'] ?? '';

    if (empty($benutzername) || empty($passwort)) {
        $fehler[] = 'Bitte Benutzername und Passwort eingeben.';
    } else {
        $stmt = $pdo->prepare('SELECT id, benutzername, passwort_hash FROM benutzer WHERE benutzername = ?');
        $stmt->execute([$benutzername]);
        $benutzer = $stmt->fetch();

        if ($benutzer && password_verify($passwort, $benutzer['passwort_hash'])) {
            $_SESSION['benutzer_id'] = $benutzer['id'];
            $_SESSION['benutzername'] = $benutzer['benutzername'];
            header('Location: eingabe.php');
            exit;
        } else {
            $fehler[] = 'Benutzername oder Passwort ist falsch.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Anmeldung - RechnungsManager</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body class="login-page">
    <div class="login-container">
        <div class="login-card">
            <div class="login-header">
                <svg width="56" height="56" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="32" height="32" rx="8" fill="#6366F1"/>
                    <path d="M8 12h16M8 16h12M8 20h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <h1>Willkommen!</h1>
                <p>Melden Sie sich an, um Ihre Rechnungen zu verwalten.</p>
            </div>

            <?php if ($fehler): ?>
                <div class="alert alert-error">
                    <?php foreach ($fehler as $f): ?>
                        <div><?php echo htmlspecialchars($f); ?></div>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>

            <?php if ($erfolg): ?>
                <div class="alert alert-success">
                    <?php echo htmlspecialchars($erfolg); ?>
                </div>
            <?php endif; ?>

            <form method="POST" class="login-form" autocomplete="off">
                <div class="form-group">
                    <label for="benutzername">Benutzername</label>
                    <input type="text" id="benutzername" name="benutzername"
                           value="<?php echo htmlspecialchars($benutzername ?? ''); ?>"
                           placeholder="Ihr Benutzername" required autofocus>
                </div>
                <div class="form-group">
                    <label for="passwort">Passwort</label>
                    <div class="password-input-wrap">
                        <input type="password" id="passwort" name="passwort"
                               placeholder="Ihr Passwort" required>
                        <button type="button" class="password-toggle" onclick="togglePass()">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <button type="submit" class="btn btn-primary btn-full">
                    Anmelden
                </button>
            </form>

            <div class="login-footer">
                <p>Standard: <strong>admin</strong> / <strong>admin123</strong></p>
            </div>
        </div>
    </div>
    <script>
    function togglePass() {
        const input = document.getElementById('passwort');
        input.type = input.type === 'password' ? 'text' : 'password';
    }
    </script>
</body>
</html>
