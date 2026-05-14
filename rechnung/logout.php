<?php
require_once __DIR__ . '/config/settings.php';
session_destroy();
header('Location: index.php');
exit;
?>
