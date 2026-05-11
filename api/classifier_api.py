#!/usr/bin/env python3
"""Rechnungs-Klassifizierer REST-API (Flask)"""

import os
import sys
import uuid
import json
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from classifier.categories import STANDARDS_KATEGORIEN
from main import process_invoice_file

app = Flask(__name__)
CORS(app)


UPLOAD_ORDNER = os.path.join(os.path.dirname(__file__), '..', 'uploads')
os.makedirs(UPLOAD_ORDNER, exist_ok=True)
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")


@app.route('/api/klassifizieren', methods=['POST'])
def klassifiziere_rechnung():
    """Rechnungsdatei hochladen und klassifizieren."""
    if 'datei' not in request.files:
        return jsonify({'fehler': 'Keine Datei gefunden!'}), 400

    datei = request.files['datei']
    if datei.filename == '':
        return jsonify({'fehler': 'Keine Datei ausgewahlt!'}), 400

    # Datei speichern
    datei_name = f"{uuid.uuid4().hex}_{datei.filename}"
    datei_pfad = os.path.join(UPLOAD_ORDNER, datei_name)
    datei.save(datei_pfad)

    # Optional: API-Key aus dem Web-Frontend
    api_key = (request.form.get('api_key') or "").strip()

    # Gemeinsamer Motor aus main.py (CLI + API)
    out = process_invoice_file(datei_pfad, api_key=api_key)

    return jsonify({
        'erfolgreich': True,
        'datei_name': datei_name,
        'ergebnis': out['ergebnis'],
        'qualitaet_score': out['qualitaet_score'],
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

    verwendeter_key = api_key or OPENROUTER_API_KEY
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
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {verwendeter_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "openai/gpt-4o-mini",
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


if __name__ == '__main__':
    print("Rechnungs-Klassifizierer-API startet...")
    print("Aufruf: python api/classifier_api.py")
    app.run(host='127.0.0.1', port=5000, debug=True)
