import pdfplumber
import os
import json
import requests
import base64
from dotenv import load_dotenv
from .categories import STANDARDS_KATEGORIEN

load_dotenv()
API_KEY = os.getenv("OPENAI_API_KEY", "")


def text_extrahieren(pdf_pfad: str) -> str:
    """Text aus PDF extrahieren."""
    text = ""
    with pdfplumber.open(pdf_pfad) as pdf:
        for seite in pdf.pages:
            t = seite.extract_text()
            if t:
                text += t + "\n"
    return text


def _standard_response(ergebnis: dict) -> dict:
    return {
        "lieferant": ergebnis.get("lieferant", "Unbekannt"),
        "kategorie": ergebnis.get("kategorie", "Sonstige"),
        "netto_betrag": ergebnis.get("netto_betrag", "0"),
        "mwst_satz": ergebnis.get("mwst_satz", ""),
        "mwst_betrag": ergebnis.get("mwst_betrag", "0"),
        "brutto_betrag": ergebnis.get("brutto_betrag", "0"),
        "waehrung": ergebnis.get("waehrung", "EUR"),
    }


def _vision_klassifizieren(datei_pfad: str, api_key: str) -> dict:
    if not os.path.isfile(datei_pfad):
        return {}

    ext = os.path.splitext(datei_pfad)[1].lower()
    mime = "image/jpeg"
    if ext == ".png":
        mime = "image/png"
    elif ext == ".webp":
        mime = "image/webp"

    with open(datei_pfad, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")

    prompt = f"""
Analysiere das Rechnungsbild und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- kategorie: Eine der folgenden Kategorien (nur der Kategoriename):
{list(STANDARDS_KATEGORIEN.keys())}
- netto_betrag: Nettobetrag
- mwst_satz: MwSt-Satz
- mwst_betrag: MwSt-Betrag
- brutto_betrag: Bruttobetrag
- waehrung: Währung

Gib NUR JSON zuruck. Keine Erklarungen.
"""

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": "openai/gpt-4o-mini",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
            ],
        }],
    }

    try:
        response = requests.post(url, headers=headers, json=data, timeout=45)
        response_json = response.json()
        if "choices" not in response_json:
            return {}
        raw = response_json["choices"][0]["message"]["content"].strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].replace("json", "", 1).strip()
        return _standard_response(json.loads(raw))
    except Exception:
        return {}


def klassifizieren(text: str, api_key: str = "", datei_pfad: str = "") -> dict:
    """KI analysiert die Rechnung und weist Kategorie zu."""
    prompt = f"""
Analysiere die folgende Rechnung und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- kategorie: Eine der folgenden Kategorien (nur der Kategoriename):
{list(STANDARDS_KATEGORIEN.keys())}
- netto_betrag: Nettobetrag
- mwst_satz: MwSt-Satz
- mwst_betrag: MwSt-Betrag
- brutto_betrag: Bruttobetrag
- waehrung: Währung

Gib NUR JSON zuruck. Keine Erklarungen.

Rechnungstext:
{text}
"""

    verwendeter_key = api_key.strip() or API_KEY
    if not verwendeter_key:
        return nach_schluesselwort(text)

    if not (text or "").strip() and datei_pfad:
        vision_result = _vision_klassifizieren(datei_pfad, verwendeter_key)
        if vision_result:
            return vision_result

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {verwendeter_key}",
        "Content-Type": "application/json",
    }
    data = {
        "model": "openai/gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
    }

    response = requests.post(url, headers=headers, json=data)
    response_json = response.json()

    if "error" in response_json:
        return nach_schluesselwort(text)

    if "choices" not in response_json:
        return nach_schluesselwort(text)

    raw = response_json["choices"][0]["message"]["content"]
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].replace("json", "", 1).strip()

    try:
        ergebnis = json.loads(raw)
        return _standard_response(ergebnis)
    except json.JSONDecodeError:
        return nach_schluesselwort(text)


def nach_schluesselwort(text: str) -> dict:
    """Falls KI nicht verfugbar, Kategorie nach Stichwort finden."""
    text_lower = text.lower()
    maximal = 0
    gefundene_kategorie = "Sonstige"

    for kategorie, info in STANDARDS_KATEGORIEN.items():
        for wort in info["schluesselwoerter"]:
            if wort.lower() in text_lower:
                gefundene_kategorie = kategorie
                maximal += 1

    return {
        "lieferant": "Unbekannt",
        "kategorie": gefundene_kategorie,
        "netto_betrag": "0",
        "mwst_satz": "",
        "mwst_betrag": "0",
        "brutto_betrag": "0",
        "waehrung": "EUR",
    }
