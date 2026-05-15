    </main>
    <footer class="footer">
        <p>&copy; <?php echo date('Y'); ?> RechnungsManager &mdash; Alle Rechte vorbehalten.</p>
    </footer>
    <?php if (isset($ek_js)): ?>
        <?php echo $ek_js; ?>
    <?php endif; ?>
    <script src="assets/js/main.js"></script>
    <?php if (file_exists(__DIR__ . '/../assets/js/' . basename($_SERVER['PHP_SELF'], '.php') . '.js')): ?>
    <script src="assets/js/<?php echo basename($_SERVER['PHP_SELF'], '.php'); ?>.js"></script>
    <?php endif; ?>
</body>
</html>
