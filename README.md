# RechnungsManager - Rechnungsklassifizierung

Eine Anwendung zur automatischen Klassifizierung von Rechnungen mit Python (OCR + KI), SQL und PHP.

## Voraussetzungen

- XAMPP (Apache + MySQL)
- Python 3.8+
- pip-Pakete

## Installation

### 1. XAMPP starten

Starten Sie in der XAMPP Control Panel **Apache** und **MySQL**.

### 2. Datenbank erstellen

1. Offnen Sie `http://localhost/phpmyadmin` im Browser.
2. Gehen Sie auf den Reiter "SQL".
3. Kopieren Sie den Inhalt von `sql/schema.sql` und fuhren Sie ihn aus.

### 3. Python-Pakete installieren

```bash
pip install pdfplumber flask flask-cors python-dotenv requests
```

### 4. Python KI-API starten

```bash
python3 api/classifier_api.py
```

Die API lauft auf `http://127.0.0.1:5000`.

### 5. Projekt nach XAMPP htdocs kopieren

```bash
cp -r Masterschool-Project /Applications/XAMPP/xamppfiles/htdocs/rechnung
```

### 6. Im Browser offnen

```
http://localhost/rechnung
```

## Anmeldedaten

| Benutzer  | Passwort |
|-----------|----------|
| admin     | admin123 |

## Projektstruktur

```
Masterschool-Project/
├── main.py                     # Haupt-Python-Skript (CLI)
├── api/
│   └── classifier_api.py       # Flask REST-API (Port 5000)
├── classifier/
│   ├── __init__.py
│   ├── categories.py           # Kategori-Definitionen
│   └── ocr_engine.py           # OCR + KI-Klassifizierer
├── config/
│   ├── database.php            # Datenbank-Verbindung
│   └── settings.php            # Projekteinstellungen
├── includes/
│   ├── header.php              # Navbar und HTML-Header
│   └── footer.php              # HTML-Fusszeile
├── assets/
│   ├── css/style.css           # Stylesheet
│   └── js/main.js              # JavaScript
├── sql/
│   └── schema.sql              # Datenbank-Schema
├── uploads/                    # Hochgeladene Dateien
├── eingabe.php                 # Eingabe-Seite (Rechnung hochladen)
├── admin.php                   # Administrations-Seite (Kategorie-Verwaltung)
├── index.php                   # Anmeldeseite
├── logout.php                  # Abmelden
└── README.md                   # Diese Datei
```

## So funktioniert es

1. **Anmeldung**: Melden Sie sich mit admin/admin123 an.
2. **Eingabe**: Laden Sie eine PDF oder ein Bild hoch.
3. **OCR + KI**: Python extrahiert den Text und klassifiziert die Rechnung mit OpenRouter KI.
4. **Datenbank**: Die Ergebnisse werden in MySQL gespeichert.
5. **Verwaltung**: Verwalten Sie Kategorien auf der Administrations-Seite.

## Hinweise

- Der OpenRouter-API-Schusseler wird in der `.env`-Datei gespeichert.
- Die Python-API muss laufend laufen (Port 5000).
- Rechnungen werden im `uploads/`-Ordner gespeichert.

## Update-Übersicht (Mai 2026)

Die Anwendung wurde für den produktiven KMU-Einsatz erweitert:

- Eingangs- und Ausgangsrechnungen als separate Bereiche.
- Zeitbasierte Gruppierung: täglich, wöchentlich, monatlich, jährlich.
- Moderne Admin-Statistik mit KPIs (Top-Zeitraum, Top-Kategorie, Top-Lieferant, Cashflow, 30-Tage-Trend).
- KI-Empfehlungen im Admin-Dashboard (inkl. Fallback ohne API-Key).
- API-Key-Verwaltung direkt im Admin-Panel (pro Installation speicherbar).
- OCR-Qualitätsscore pro Rechnung.
- Fälligkeitsdatum und Kennzahlen für überfällige/nah fällige Rechnungen.
- Kategorie-Monatsbudgets mit Warnungen ab hoher Auslastung.
- Thumbnail-Vorschau für hochgeladene Rechnungen (inkl. PDF-Fallback).
- Gemeinsamer Analyse-Motor: `main.py` wird von CLI und Flask-API genutzt.

## Schneller Start (Empfohlen)

Wenn Sie die Anwendung so einfach wie möglich nutzen möchten:

1. API starten (Terminal 1):

```bash
./scripts/start_api.sh
```

2. Projekt nach XAMPP synchronisieren (Terminal 2):

```bash
./scripts/deploy_local.sh
```

3. Browser öffnen:

```
http://localhost/rechnung
```

Bei Änderungen im Projekt reicht danach meist nur:

```bash
./scripts/deploy_local.sh
```
