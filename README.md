<!-- Project owner: Levent Cetin -->
# RechnungsManager

![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)
![Python](https://img.shields.io/badge/Python-3.8%2B-3776AB?logo=python&logoColor=white)
![Flask API](https://img.shields.io/badge/API-Flask-000000?logo=flask)
![MySQL](https://img.shields.io/badge/Database-MySQL-4479A1?logo=mysql&logoColor=white)
![Lizenz](https://img.shields.io/badge/Lizenz-Proprietary-red)

Umfassende Plattform fuer Rechnungsverwaltung mit KI-gestuetzter Datenerkennung.
Das Projekt kombiniert eine **Next.js App Router** Webanwendung mit einer **Python Flask Classifier API**.

## Inhalt

- [Ueberblick](#ueberblick)
- [Hauptfunktionen](#hauptfunktionen)
- [Technische Architektur](#technische-architektur)
- [Projektstruktur (Tree)](#projektstruktur-tree)
- [Voraussetzungen](#voraussetzungen)
- [Installation (lokale Entwicklung)](#installation-lokale-entwicklung)
- [Starten](#starten)
- [Umgebungsvariablen](#umgebungsvariablen)
- [API-Ablauf (Kurzfassung)](#api-ablauf-kurzfassung)
- [Production / Hosting](#production--hosting)
- [Second-Brain-Integration](#second-brain-integration)
- [Fehlerbehebung](#fehlerbehebung)

## Ueberblick

RechnungsManager fokussiert sich auf folgende Aufgaben:

- Zentrale Erfassung von Rechnungen (Bild/PDF)
- Automatische Extraktion von Feldern wie Lieferant, Betrag, Steuer und Datum per OCR + KI
- Verwaltung von Kategorien, Budgets und Auswertungen in einem einzigen System
- Schnelle Suche, Vorschau, Bearbeitung und Validierung

## Hauptfunktionen

- Login/Logout mit Session-Verwaltung
- Rechnungsupload mit KI-Klassifikation
- Bearbeitbare Rechnungsdetailansicht (Zoom/Pan + Metadaten)
- Erweiterte Suchseite (Inline-Preview + Detailbereich)
- Kategorie- und Budgetverwaltung
- Dashboard mit KPIs und Diagrammen
- Duplicate-Pruefung und Bestaetigungsdialoge

## Technische Architektur

### 1) Next.js-Schicht (`nextjs-app`)

- UI, Server Components und Route Handler
- Authentifizierung, Datenbankzugriff, Dateiauslieferung
- Kommunikation mit Python Classifier API per HTTP

### 2) Python-Classifier-Schicht (`api`, `classifier`)

- Flask-basierter Service
- OCR, Bildvorverarbeitung, KI-Extraktion
- Rueckgabe normalisierter Ergebnisse an Next.js

### 3) Daten-Schicht (`MySQL` + `uploads/`)

- MySQL: Rechnungen, Kategorien, Einstellungen, Statistikdaten
- `uploads/`: gemeinsamer Dateiordner fuer Next.js und Python

## Projektstruktur (Tree)

```text
.
|-- api/
|   `-- classifier_api.py
|-- classifier/
|   |-- ocr_engine.py
|   |-- image_preprocess.py
|   `-- ...
|-- nextjs-app/
|   |-- app/
|   |-- components/
|   |-- lib/
|   |-- lang/
|   `-- package.json
|-- scripts/
|   |-- start_api.sh
|   |-- hosting_bootstrap.sh
|   |-- hosting_start.sh
|   |-- second_brain_log.sh
|   |-- second_brain_pull.sh
|   `-- second_brain_status.sh
|-- sql/
|   `-- schema.sql
|-- uploads/
|-- requirements.txt
`-- README.md
```

## Voraussetzungen

- Node.js 20+
- Python 3.8+
- MySQL 8+
- macOS/Linux Terminal (fuer die Scripts)

## Installation (lokale Entwicklung)

### 1) Datenbank vorbereiten

```bash
mysql -u root -p < sql/schema.sql
```

### 2) Python API einrichten

Im Projektverzeichnis:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3) Next.js einrichten

```bash
cd nextjs-app
cp .env.example .env.local
npm install
```

## Starten

Empfohlen: zwei getrennte Terminalfenster.

### Terminal A: Python Classifier API

```bash
./scripts/start_api.sh
```

Standard-URL: `http://127.0.0.1:8000`

Health-Check:

```bash
curl -i http://127.0.0.1:8000/api/kategorien
```

### Terminal B: Next.js

```bash
cd nextjs-app
npm run dev
```

App-URL: `http://localhost:3000`

## Umgebungsvariablen

Minimalbeispiel fuer `nextjs-app/.env.local`:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=firma_rechnungen
DB_USER=root
DB_PASS=

CLASSIFIER_API_URL=http://127.0.0.1:8000
SESSION_SECRET=replace-with-a-long-random-secret
UPLOAD_DIR=../uploads
```

In der Root-`.env` koennen produktive Secrets/KI-Keys hinterlegt werden.

## API-Ablauf (Kurzfassung)

- Upload + Klassifikation:
  - `nextjs-app/api/invoices` -> `api/classifier_api.py` (`/api/klassifizieren`)
- Rechnungs-CRUD:
  - `nextjs-app/api/invoices`, `nextjs-app/api/invoices/[id]`
- Kategorien:
  - `nextjs-app/api/categories*`
- Stats/Insights:
  - `nextjs-app/api/stats` -> Python Insight-Endpunkte

## Production / Hosting

### Build

```bash
cd nextjs-app
npm run build
npm run start
```

### Schnellstart ueber Scripts

```bash
./scripts/hosting_bootstrap.sh
./scripts/hosting_start.sh
pm2 status
```

PM2 Autostart:

```bash
pm2 startup
pm2 save
```

## Second-Brain-Integration

Im Repository sind folgende Second-Brain-Helferskripte enthalten:

- `scripts/second_brain_log.sh`
- `scripts/second_brain_pull.sh`
- `scripts/second_brain_status.sh`
- `scripts/install_second_brain_git_hook.sh`

Standardpfade:

- `/Users/lventctn/Documents/ikinci-beyin`
- Projekt-Wiki: `masterschool-wiki`
- Logdatei: `/Users/lventctn/Documents/ikinci-beyin/masterschool-wiki/log.md`

Weitere Dokumentation:

- `scripts/SECOND_BRAIN_USAGE.md`
- `docs/SECOND_BRAIN_PROJECT_BOOTSTRAP.md`

## Fehlerbehebung

1. Fehler `Nicht autorisiert`
- Erneut einloggen.
- Browser-Cookies pruefen.

2. Classifier-API nicht erreichbar
- Pruefen, ob `./scripts/start_api.sh` laeuft.
- Wert von `CLASSIFIER_API_URL` verifizieren.

3. Datenbankverbindung fehlgeschlagen
- DB-Werte in `nextjs-app/.env.local` pruefen.
- Sicherstellen, dass `firma_rechnungen` existiert.

4. Upload erfolgreich, aber KI-Ergebnis schwach/leer
- Bildqualitaet und Rotation/Crop pruefen.
- Python-Logs auf OCR/KI-Warnungen kontrollieren.

## Lizenz

Dieses Projekt ist proprietaer und vertraulich.
Alle Rechte vorbehalten (`All Rights Reserved`).

Die vollstaendige Lizenz befindet sich in der Datei [LICENSE](./LICENSE).

Ohne eine ausdrueckliche schriftliche Genehmigung duerfen der Quellcode, die Architektur, die Inhalte und die zugehoerigen Assets nicht kopiert, veraendert, weitergegeben, veroefentlicht oder kommerziell genutzt werden.

Wenn spaeter eine kommerzielle Lizenzierung geplant ist, sollte die Nutzung immer ueber einen separaten schriftlichen Vertrag geregelt werden.
