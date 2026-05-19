#!/usr/bin/env python3
"""Rechnungs-Klassifizierer REST-API (Flask)"""

import os
import sys
import uuid
import json
import requests
import re
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from io import BytesIO

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from classifier.categories import STANDARDS_KATEGORIEN
from main import process_invoice_file
from classifier.ocr_engine import _crop_rechnung_region

try:
    from PIL import Image
except Exception:
    Image = None

app = Flask(__name__)
CORS(app)


UPLOAD_ORDNER = os.path.join(os.path.dirname(__file__), '..', 'uploads')
os.makedirs(UPLOAD_ORDNER, exist_ok=True)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".webp", ".heic", ".heif"}


def _sicherer_dateiname(original_name: str) -> str:
    """Normalize uploaded filename to URL-safe ASCII-ish characters."""
    base = os.path.basename(original_name or "datei")
    stem, ext = os.path.splitext(base)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "datei"
    ext = re.sub(r"[^A-Za-z0-9.]+", "", ext.lower())
    if len(ext) > 10:
        ext = ""
    return f"{stem}{ext}"


def _crop_uploaded_image_inplace(datei_pfad: str) -> bool:
    """Crop invoice region in-place so preview and processing use the same focused image."""
    if Image is None or not os.path.isfile(datei_pfad):
        return False
    try:
        with Image.open(datei_pfad) as img:
            cropped = _crop_rechnung_region(img)
            ext = os.path.splitext(datei_pfad)[1].lower()
            save_format = "PNG" if ext == ".png" else "JPEG"
            rgb = cropped.convert("RGB") if save_format == "JPEG" else cropped
            out = BytesIO()
            if save_format == "JPEG":
                rgb.save(out, format=save_format, quality=95, optimize=True)
            else:
                rgb.save(out, format=save_format, optimize=True)
        with open(datei_pfad, "wb") as f:
            f.write(out.getvalue())
        return True
    except Exception:
        return False


@app.route('/api/klassifizieren', methods=['POST'])
def klassifiziere_rechnung():
    """Rechnungsdatei hochladen und klassifizieren."""
    if 'datei' not in request.files:
        return jsonify({'fehler': 'Keine Datei gefunden!'}), 400

    datei = request.files['datei']
    if datei.filename == '':
        return jsonify({'fehler': 'Keine Datei ausgewahlt!'}), 400

    # Datei speichern
    safe_original = _sicherer_dateiname(datei.filename or "datei")
    datei_name = f"{uuid.uuid4().hex}_{safe_original}"
    datei_pfad = os.path.join(UPLOAD_ORDNER, datei_name)
    datei.save(datei_pfad)
    # Keep original upload bytes. Local OCR already tries crop/no-crop variants and
    # aggressive in-place cropping can permanently remove text regions.

    # Optional: API-Key aus dem Web-Frontend
    api_key = (request.form.get('api_key') or "").strip()
    api_provider = (request.form.get('api_provider') or "openrouter").strip().lower()
    api_model = (request.form.get('api_model') or "").strip()

    # Gemeinsamer Motor aus main.py (CLI + API)
    out = process_invoice_file(datei_pfad, api_key=api_key, api_provider=api_provider, api_model=api_model)

    return jsonify({
        'erfolgreich': True,
        'datei_name': datei_name,
        'ergebnis': out['ergebnis'],
        'qualitaet_score': out['qualitaet_score'],
        'debug': out.get('debug', {}),
    })


@app.route('/api/kategorien', methods=['GET'])
def kategorien_abrufen():
    """Alle Kategorien zuruckgeben."""
    ergebnis = {}
    for name, info in STANDARDS_KATEGORIEN.items():
        ergebnis[name] = {
            'beschreibung': info['beschreibung'],
            'farbe': info['farbe'],
        }
    return jsonify(ergebnis)


@app.route('/api/rechnungen', methods=['GET'])
def rechnungen_abrufen():
    """Hochgeladene Rechnungen auflisten."""
    dateien = []
    for f in sorted(os.listdir(UPLOAD_ORDNER)):
        pfad = os.path.join(UPLOAD_ORDNER, f)
        if os.path.isfile(pfad):
            dateien.append({
                'name': f,
                'groesse': os.path.getsize(pfad),
                'datum': os.path.getmtime(pfad),
            })
    return jsonify(dateien)


@app.route('/api/business_insights', methods=['POST'])
def business_insights():
    """Kleine/Mittlere Unternehmen: KI-Empfehlungen aus KPI-Daten."""
    payload = request.get_json(silent=True) or {}
    stats = payload.get('stats', {})
    api_key = (payload.get('api_key') or "").strip()
    api_provider = (payload.get('api_provider') or "openrouter").strip().lower()
    api_model = (payload.get('api_model') or "").strip()

    if not stats:
        return jsonify({
            'erfolgreich': True,
            'quelle': 'fallback',
            'insights': [
                "Noch keine ausreichenden Daten. Laden Sie mehr Rechnungen hoch, um Trends zu erkennen.",
                "Aktivieren Sie Eingangs-/Ausgangsrechnungen konsequent für bessere Liquiditätsauswertung.",
                "Pflegen Sie Lieferanten- und Kategoriezuordnung vollständig für belastbare Reports."
            ],
        })

    fallback = [
        "Prüfen Sie den Zeitraum mit den höchsten Ausgaben und verhandeln Sie dort Lieferantenpreise.",
        "Die Top-Kategorie sollte ein Budget-Limit und eine monatliche Abweichungswarnung erhalten.",
        "Der häufigste Lieferant sollte auf Sammelrechnung oder Rabatte optimiert werden.",
        "Reduzieren Sie Unbekannt/Nicht kategorisiert, um bessere KI-Entscheidungshilfen zu erhalten."
    ]

    if api_provider == "openai":
        verwendeter_key = api_key or OPENAI_API_KEY or OPENROUTER_API_KEY
    else:
        verwendeter_key = api_key or OPENROUTER_API_KEY or OPENAI_API_KEY
    if not verwendeter_key:
        return jsonify({'erfolgreich': True, 'quelle': 'fallback', 'insights': fallback})

    prompt = f"""
Du bist ein CFO-Assistent für kleine und mittlere Unternehmen.
Analysiere die folgenden Kennzahlen und gib genau 4 kurze, konkrete Empfehlungen.
Fokus: Liquidität, Kostenkontrolle, Lieferantenmanagement, operatives Handeln.
Antwortformat: JSON mit Feld 'insights' als Liste von 4 Strings.

Kennzahlen:
{json.dumps(stats, ensure_ascii=False)}
"""

    try:
        if api_provider == "openai":
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {verwendeter_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": api_model or "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
                timeout=20,
            )
        else:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {verwendeter_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": api_model or "openai/gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=20,
            )
        data = response.json()
        if "choices" not in data:
            return jsonify({'erfolgreich': True, 'quelle': 'fallback', 'insights': fallback})

        raw = data["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].replace("json", "", 1).strip()
        parsed = json.loads(raw)
        insights = parsed.get("insights", [])
        if not isinstance(insights, list) or not insights:
            insights = fallback

        return jsonify({'erfolgreich': True, 'quelle': 'ki', 'insights': insights[:4]})
    except Exception:
        return jsonify({'erfolgreich': True, 'quelle': 'fallback', 'insights': fallback})


@app.route('/uploads/<path:datei_name>')
def hochgeladen_anzeigen(datei_name):
    return send_from_directory(UPLOAD_ORDNER, datei_name)


@app.route('/api/datei-loeschen', methods=['POST'])
def datei_loeschen():
    """Delete one uploaded file from API upload folder."""
    payload = request.get_json(silent=True) or {}
    name = os.path.basename((payload.get('name') or '').strip())
    if not name:
        return jsonify({'erfolgreich': False, 'fehler': 'name fehlt'}), 400

    pfad = os.path.join(UPLOAD_ORDNER, name)
    if os.path.isfile(pfad):
        try:
            os.remove(pfad)
            return jsonify({'erfolgreich': True, 'geloescht': True})
        except Exception as ex:
            return jsonify({'erfolgreich': False, 'fehler': str(ex)}), 500
    return jsonify({'erfolgreich': True, 'geloescht': False})


if __name__ == '__main__':
    print("Rechnungs-Klassifizierer-API startet...")
    print("Aufruf: python api/classifier_api.py")
    host = os.getenv("CLASSIFIER_API_HOST", "0.0.0.0")
    port = int(os.getenv("CLASSIFIER_API_PORT", "8000"))
    app.run(host=host, port=port, debug=False)
