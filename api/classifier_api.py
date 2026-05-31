# Project owner: Levent Cetin
#!/usr/bin/env python3
"""Rechnungs-Klassifizierer REST-API (Flask)"""

import os
import sys
import uuid
import json
import requests
import re
import difflib
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from classifier.categories import STANDARDS_KATEGORIEN
from main import process_invoice_file
from classifier.ocr_engine import prepare_invoice_image_file_inplace, bild_text_extrahieren

app = Flask(__name__)
CORS(app)


UPLOAD_ORDNER = os.path.join(os.path.dirname(__file__), '..', 'uploads')
os.makedirs(UPLOAD_ORDNER, exist_ok=True)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".tif", ".tiff", ".webp", ".heic", ".heif"}
MAX_OCR_COMPARE_CANDIDATES = 6
OCR_DUPLICATE_THRESHOLD = 0.93


def _normalize_api_model(api_provider: str, api_model: str) -> str:
    provider = (api_provider or "openrouter").strip().lower()
    raw = (api_model or "").strip()
    if not raw:
        return "gpt-4o-mini" if provider == "openai" else "openai/gpt-4o-mini"
    return raw


def _sicherer_dateiname(original_name: str) -> str:
    """Normalize uploaded filename to URL-safe ASCII-ish characters."""
    base = os.path.basename(original_name or "datei")
    stem, ext = os.path.splitext(base)
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._-") or "datei"
    ext = re.sub(r"[^A-Za-z0-9.]+", "", ext.lower())
    if len(ext) > 10:
        ext = ""
    return f"{stem}{ext}"


def _normalisiere_ocr_text(text: str) -> str:
    value = (text or "").lower()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"[^a-z0-9äöüß€.,:/ -]+", "", value)
    return value.strip()


def _nennname_aus_uuid_dateiname(name: str) -> str:
    value = os.path.basename(name or "")
    if "_" in value:
        maybe_uuid, rest = value.split("_", 1)
        if re.fullmatch(r"[0-9a-f]{32}", maybe_uuid):
            return rest
    return value


def _lokale_duplicate_pruefung(datei_pfad: str, original_name: str) -> dict:
    ext = os.path.splitext(datei_pfad)[1].lower()
    if ext not in IMAGE_EXTS:
        return {"duplicate": False, "reason": "", "matched_file": "", "score": 0.0}

    try:
        incoming_size = os.path.getsize(datei_pfad)
    except Exception:
        incoming_size = -1

    safe_original = _sicherer_dateiname(original_name or "")
    candidate_files = []
    same_name_hit = None

    for file_name in os.listdir(UPLOAD_ORDNER):
        candidate_path = os.path.join(UPLOAD_ORDNER, file_name)
        if not os.path.isfile(candidate_path):
            continue
        if os.path.abspath(candidate_path) == os.path.abspath(datei_pfad):
            continue
        if os.path.splitext(candidate_path)[1].lower() not in IMAGE_EXTS:
            continue

        readable_name = _nennname_aus_uuid_dateiname(file_name)
        if safe_original and readable_name == safe_original:
            same_name_hit = file_name
            break

        try:
            size = os.path.getsize(candidate_path)
        except Exception:
            continue
        if incoming_size > 0 and size == incoming_size:
            candidate_files.append((file_name, candidate_path))

    if same_name_hit:
        return {
            "duplicate": True,
            "reason": "filename",
            "matched_file": same_name_hit,
            "score": 1.0,
        }

    if not candidate_files:
        return {"duplicate": False, "reason": "no_size_match", "matched_file": "", "score": 0.0}

    try:
        incoming_ocr = _normalisiere_ocr_text(bild_text_extrahieren(datei_pfad))
    except Exception:
        incoming_ocr = ""

    if len(incoming_ocr) < 24:
        return {"duplicate": False, "reason": "ocr_too_short", "matched_file": "", "score": 0.0}

    top_candidates = candidate_files[:MAX_OCR_COMPARE_CANDIDATES]
    best_score = 0.0
    best_name = ""
    for candidate_name, candidate_path in top_candidates:
        try:
            candidate_ocr = _normalisiere_ocr_text(bild_text_extrahieren(candidate_path))
        except Exception:
            continue
        if len(candidate_ocr) < 24:
            continue
        score = difflib.SequenceMatcher(None, incoming_ocr, candidate_ocr).ratio()
        if score > best_score:
            best_score = score
            best_name = candidate_name

    if best_score >= OCR_DUPLICATE_THRESHOLD and best_name:
        return {
            "duplicate": True,
            "reason": "ocr",
            "matched_file": best_name,
            "score": round(float(best_score), 4),
        }

    return {"duplicate": False, "reason": "ocr_below_threshold", "matched_file": best_name, "score": round(float(best_score), 4)}


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

    duplicate_check = _lokale_duplicate_pruefung(datei_pfad, datei.filename or "")
    if duplicate_check.get("duplicate"):
        try:
            os.remove(datei_pfad)
        except Exception:
            pass
        return jsonify({
            "erfolgreich": False,
            "duplicate": True,
            "message": "Dieses Dokument wurde bereits verarbeitet.",
            "duplicate_meta": duplicate_check,
        }), 409

    preprocess_debug = {}
    orientation_locked = str(request.form.get("orientation_locked", "") or "").strip().lower() in ("1", "true", "yes", "on")
    if os.path.splitext(datei_pfad)[1].lower() in IMAGE_EXTS and not orientation_locked:
        preprocess_debug = prepare_invoice_image_file_inplace(datei_pfad, orientation_locked=orientation_locked)
    elif orientation_locked:
        preprocess_debug = {"skipped": True, "reason": "orientation_locked"}
    preprocess_debug["orientation_locked_applied"] = bool(orientation_locked)

    # Optional: API-Key aus dem Web-Frontend
    api_key = (request.form.get('api_key') or "").strip()
    api_provider = (request.form.get('api_provider') or "openrouter").strip().lower()
    api_model = _normalize_api_model(api_provider, request.form.get('api_model') or "")

    # Gemeinsamer Motor aus main.py (CLI + API)
    out = process_invoice_file(datei_pfad, api_key=api_key, api_provider=api_provider, api_model=api_model)
    debug = out.get('debug', {})
    debug['image_preprocess'] = preprocess_debug

    return jsonify({
        'erfolgreich': True,
        'datei_name': datei_name,
        'ergebnis': out['ergebnis'],
        'qualitaet_score': out['qualitaet_score'],
        'debug': debug,
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
    api_model = _normalize_api_model(api_provider, payload.get('api_model') or "")

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
                    "model": api_model,
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
                    "model": api_model,
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
