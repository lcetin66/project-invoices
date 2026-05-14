<?php
require_once __DIR__ . '/config/settings.php';
session_pruefen();
$page_titel = 'Rechnungen';
include __DIR__ . '/includes/header.php';
?>
<h1>Rechnungen</h1>
<p class="lead">Übersicht mit klarer Lesbarkeit und mehr Platz für Bearbeitung.</p>

<section class="cards">
  <article class="card">
    <h3>Telekom Deutschland GmbH</h3>
    <p class="meta">11.05.2026 · 59,94 EUR · Telekommunikation</p>
    <div class="actions">
      <a class="btn btn-outline" href="#">Ansehen</a>
      <a class="btn btn-primary" href="#">Bearbeiten</a>
    </div>
  </article>

  <article class="card">
    <h3>Amazon EU S.à r.l.</h3>
    <p class="meta">11.05.2026 · 109,99 EUR · Büromaterial</p>
    <div class="actions">
      <a class="btn btn-outline" href="#">Ansehen</a>
      <a class="btn btn-primary" href="#">Bearbeiten</a>
    </div>
  </article>
</section>
<?php include __DIR__ . '/includes/footer.php'; ?>
