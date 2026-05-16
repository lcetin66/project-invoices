import pdfplumber
import os
import json
import requests
import base64
import re
from dotenv import load_dotenv
from .categories import STANDARDS_KATEGORIEN

try:
    from PIL import Image
except Exception:
    Image = None

try:
    import pytesseract
except Exception:
    pytesseract = None

load_dotenv()
API_KEY_OPENROUTER = os.getenv("OPENROUTER_API_KEY", "")
API_KEY_OPENAI = os.getenv("OPENAI_API_KEY", "")


def _typ_heuristik_aus_text(text: str) -> str:
    t = (text or "").lower()
    ausgang_hits = [
        r"\brechnung\s+an\b",
        r"\bkunde\b",
        r"\bleistungszeitraum\b",
        r"\bwir\s+berechnen\b",
        r"\bzahlbar\s+bis\b",
    ]
    eingang_hits = [
        r"\bihr\s+vertrag\b",
        r"\bzu\s+zahl(?:en|ender)\b",
        r"\blastschrift\b",
        r"\babbuchung\b",
        r"\bkundennummer\b",
        r"\brechnungsnummer\b",
    ]
    a = sum(1 for p in ausgang_hits if re.search(p, t))
    e = sum(1 for p in eingang_hits if re.search(p, t))
    return "ausgang" if a > e else "eingang"


def _kategorie_nach_produktlogik(ergebnis: dict, text: str = "") -> dict:
    """
    Produkt-/Leistungslogik statt Lieferanten-Logik:
    - nur Inhalte/Positionen der Rechnung bewerten
    - Lieferantenname NICHT als hartes Kriterium verwenden
    """
    kategorie = str(ergebnis.get("kategorie", "") or "Sonstige").strip()
    brutto = str(ergebnis.get("brutto_betrag", "0") or "0")
    full_text = (text or "").lower()

    # Wenn KI keine brauchbare Kategorie geliefert hat, aus Produkttext ableiten.
    if kategorie in ("", "Sonstige"):
        kw = nach_schluesselwort(full_text)
        if kw.get("kategorie") and kw.get("kategorie") != "Sonstige":
            ergebnis["kategorie"] = kw["kategorie"]
            # Nur fehlende Zahlenfelder ergänzen
            if brutto in ("", "0", "0.0", "0.00") and str(kw.get("brutto_betrag", "0")) not in ("", "0", "0.0", "0.00"):
                ergebnis["brutto_betrag"] = kw.get("brutto_betrag", ergebnis.get("brutto_betrag", "0"))
                ergebnis["netto_betrag"] = kw.get("netto_betrag", ergebnis.get("netto_betrag", "0"))
                ergebnis["mwst_satz"] = kw.get("mwst_satz", ergebnis.get("mwst_satz", ""))
                ergebnis["mwst_betrag"] = kw.get("mwst_betrag", ergebnis.get("mwst_betrag", "0"))
                ergebnis["waehrung"] = kw.get("waehrung", ergebnis.get("waehrung", "EUR"))

    return _standard_response(ergebnis)


def text_extrahieren(pdf_pfad: str) -> str:
    """Text aus PDF extrahieren."""
    text = ""
    with pdfplumber.open(pdf_pfad) as pdf:
        for seite in pdf.pages:
            t = seite.extract_text()
            if t:
                text += t + "\n"
    return text


def bild_text_extrahieren(datei_pfad: str) -> str:
    """Text aus Bild extrahieren (lokaler OCR-Fallback)."""
    if not os.path.isfile(datei_pfad) or Image is None or pytesseract is None:
        return ""
    try:
        with Image.open(datei_pfad) as img:
            return (pytesseract.image_to_string(img, lang="deu+eng") or "").strip()
    except Exception:
        return ""


def _standard_response(ergebnis: dict) -> dict:
    typ = str(ergebnis.get("rechnung_typ", "eingang") or "eingang").strip().lower()
    if typ not in ("eingang", "ausgang"):
        typ = "eingang"
    return {
        "lieferant": ergebnis.get("lieferant", "Unbekannt"),
        "rechnung_typ": typ,
        "kategorie": ergebnis.get("kategorie", "Sonstige"),
        "netto_betrag": ergebnis.get("netto_betrag", "0"),
        "mwst_satz": ergebnis.get("mwst_satz", ""),
        "mwst_betrag": ergebnis.get("mwst_betrag", "0"),
        "brutto_betrag": ergebnis.get("brutto_betrag", "0"),
        "waehrung": ergebnis.get("waehrung", "EUR"),
    }


def _vision_klassifizieren(datei_pfad: str, api_key: str, api_provider: str = "openrouter", api_model: str = "") -> dict:
    if not os.path.isfile(datei_pfad):
        return {}

    ext = os.path.splitext(datei_pfad)[1].lower()
    mime = "image/jpeg"
    if ext == ".png":
        mime = "image/png"
    elif ext == ".gif":
        mime = "image/gif"
    elif ext in (".tif", ".tiff"):
        mime = "image/tiff"
    elif ext == ".webp":
        mime = "image/webp"
    elif ext in (".heic", ".heif"):
        mime = "image/heic"

    with open(datei_pfad, "rb") as f:
        encoded = base64.b64encode(f.read()).decode("ascii")

    prompt = f"""
Analysiere das Rechnungsbild und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- rechnung_typ: "eingang" oder "ausgang"
- kategorie: Eine der folgenden Kategorien (nur der Kategoriename):
{list(STANDARDS_KATEGORIEN.keys())}
- netto_betrag: Nettobetrag
- mwst_satz: MwSt-Satz
- mwst_betrag: MwSt-Betrag
- brutto_betrag: Bruttobetrag
- waehrung: Währung

WICHTIG:
- Kategorisierung nach dem GEKAUFTEN PRODUKT / der LEISTUNG aus den Positionen.
- Nicht nach Lieferantenname/Marke kategorisieren.
- Falls mehrere Positionen vorliegen: nach dem Hauptkostenblock entscheiden.

Gib NUR JSON zuruck. Keine Erklarungen.
"""

    if api_provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "gpt-4o-mini",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                ],
            }],
            "temperature": 0,
        }
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "openai/gpt-4o-mini",
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
        parsed = _standard_response(json.loads(raw))
        return _kategorie_nach_produktlogik(parsed, "")
    except Exception:
        return {}


def klassifizieren(text: str, api_key: str = "", datei_pfad: str = "", api_provider: str = "openrouter", api_model: str = "") -> dict:
    """KI analysiert die Rechnung und weist Kategorie zu."""
    prompt = f"""
Analysiere die folgende Rechnung und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- rechnung_typ: "eingang" oder "ausgang"
- kategorie: Eine der folgenden Kategorien (nur der Kategoriename):
{list(STANDARDS_KATEGORIEN.keys())}
- netto_betrag: Nettobetrag
- mwst_satz: MwSt-Satz
- mwst_betrag: MwSt-Betrag
- brutto_betrag: Bruttobetrag
- waehrung: Währung

WICHTIG:
- Kategorisierung nach dem GEKAUFTEN PRODUKT / der LEISTUNG (Positionszeilen).
- Nicht nach Lieferantenname/Marke kategorisieren.
- Falls mehrere Positionen vorhanden sind, entscheide nach dem größten/zentralen Kostenblock.

Gib NUR JSON zuruck. Keine Erklarungen.

Rechnungstext:
{text}
"""

    provider = (api_provider or "openrouter").strip().lower()
    if provider not in ("openrouter", "openai"):
        provider = "openrouter"
    if provider == "openai":
        default_key = API_KEY_OPENAI or API_KEY_OPENROUTER
    else:
        default_key = API_KEY_OPENROUTER or API_KEY_OPENAI
    verwendeter_key = api_key.strip() or default_key
    if not verwendeter_key:
        return nach_schluesselwort(text)

    if not (text or "").strip() and datei_pfad:
        vision_result = _vision_klassifizieren(datei_pfad, verwendeter_key, provider, api_model)
        if vision_result:
            return _kategorie_nach_produktlogik(vision_result, text)

    if provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {verwendeter_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        }
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {verwendeter_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "openai/gpt-4o-mini",
            "messages": [{"role": "user", "content": prompt}],
        }

    try:
        response = requests.post(url, headers=headers, json=data, timeout=30)
        response_json = response.json()
    except Exception:
        return nach_schluesselwort(text)

    if "error" in response_json:
        return nach_schluesselwort(text)

    if "choices" not in response_json:
        return nach_schluesselwort(text)

    raw = response_json["choices"][0]["message"]["content"]
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1].replace("json", "", 1).strip()

    try:
        ergebnis = _standard_response(json.loads(raw))
        if not ergebnis.get("rechnung_typ"):
            ergebnis["rechnung_typ"] = _typ_heuristik_aus_text(text)
        return _kategorie_nach_produktlogik(ergebnis, text)
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

    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    lieferant = "Unbekannt"
    for ln in lines[:8]:
        if re.search(r"(gmbh|ag|kg|ug|ltd|s\.a\.r\.l|inc|llc)", ln, re.IGNORECASE):
            lieferant = ln
            break
    if lieferant == "Unbekannt" and lines:
        lieferant = lines[0][:120]

    def parse_de_amount(raw: str) -> float:
        cleaned = raw.replace(" ", "").replace(".", "").replace(",", ".")
        try:
            return float(cleaned)
        except ValueError:
            return 0.0

    brutto = 0.0
    # 1) Strongest signals first
    keyword_patterns = [
        r"Rechnungsbetrag[^0-9]{0,20}(\d{1,3}(?:[.\s]\d{3})*,\d{2})",
        r"Gesamtbetrag[^0-9]{0,20}(\d{1,3}(?:[.\s]\d{3})*,\d{2})",
        r"zu\s*zahl(?:en|ender\s*Betrag)[^0-9]{0,20}(\d{1,3}(?:[.\s]\d{3})*,\d{2})",
        r"Den\s*Betrag\s*von\s*(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€",
    ]
    for pat in keyword_patterns:
        m = re.search(pat, text or "", re.IGNORECASE)
        if m:
            brutto = parse_de_amount(m.group(1))
            if brutto > 0:
                break

    # 2) Fallback: only numbers close to EUR markers
    if brutto <= 0:
        eur_matches = re.findall(r"(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€", text or "", re.IGNORECASE)
        amount_candidates = [parse_de_amount(x) for x in eur_matches]
        amount_candidates = [x for x in amount_candidates if 0.01 <= x <= 100000.0]
        brutto = max(amount_candidates) if amount_candidates else 0.0

    mwst_satz = ""
    mwst_match = re.search(r"\b(7|10|19|20)\s*%|\b(?:MwSt|USt)\.?\s*[:\-]?\s*(\d{1,2})\s*%", text or "", re.IGNORECASE)
    if mwst_match:
        mwst_satz = next((g for g in mwst_match.groups() if g), "")

    mwst_factor = (float(mwst_satz) / 100.0) if mwst_satz else 0.0
    netto = brutto / (1.0 + mwst_factor) if brutto > 0 and mwst_factor > 0 else brutto
    mwst_betrag = brutto - netto if brutto > 0 and mwst_factor > 0 else 0.0

    waehrung = "EUR"
    if re.search(r"\bUSD|\$\b", text or "", re.IGNORECASE):
        waehrung = "USD"
    elif re.search(r"\bTRY|₺\b", text or "", re.IGNORECASE):
        waehrung = "TRY"

    return {
        "lieferant": lieferant,
        "rechnung_typ": _typ_heuristik_aus_text(text),
        "kategorie": gefundene_kategorie,
        "netto_betrag": f"{netto:.2f}" if netto else "0",
        "mwst_satz": mwst_satz,
        "mwst_betrag": f"{mwst_betrag:.2f}" if mwst_betrag else "0",
        "brutto_betrag": f"{brutto:.2f}" if brutto else "0",
        "waehrung": waehrung,
    }
