<?php require_once __DIR__ . '/../config/settings.php'; ?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?php echo isset($page_titel) ? $page_titel : 'Rechnungskategorisierung'; ?></title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="assets/css/style.css">
    <?php if (isset($ek_css)): ?>
        <?php echo $ek_css; ?>
    <?php endif; ?>
</head>
<body>
    <nav class="navbar">
        <div class="navbar-container">
            <a href="<?php echo isset($_SESSION['benutzer_id']) ? 'eingabe.php' : 'index.php'; ?>" class="navbar-logo">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="32" height="32" rx="8" fill="#6366F1"/>
                    <path d="M8 12h16M8 16h12M8 20h8" stroke="white" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span>RechnungsManager</span>
            </a>
            <?php if (isset($_SESSION['benutzer_id'])): ?>
            <div class="navbar-menu">
                <a href="eingabe.php" class="navbar-link <?php echo basename($_SERVER['PHP_SELF']) == 'eingabe.php' ? 'active' : ''; ?>">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                    Eingabe
                </a>
                <a href="admin.php" class="navbar-link <?php echo basename($_SERVER['PHP_SELF']) == 'admin.php' ? 'active' : ''; ?>">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
                    Verwaltung
                </a>
                <a href="rechnungen.php" class="navbar-link <?php echo basename($_SERVER['PHP_SELF']) == 'rechnungen.php' ? 'active' : ''; ?>">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14,2 14,8 20,8"/>
                    </svg>
                    Rechnungen
                </a>
                <a href="logout.php" class="navbar-logout">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                    Abmelden
                </a>
            </div>
            <?php endif; ?>
        </div>
    </nav>
    <main class="main-content">
