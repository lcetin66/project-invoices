#!/usr/bin/env python3
import argparse
import json
from classifier.ocr_engine import text_extrahieren, klassifizieren


def qualitaet_score_berechnen(text: str, ergebnis: dict) -> int:
    score = 20
    text_len = len((text or "").strip())
    if text_len > 1200:
        score += 35
    elif text_len > 500:
        score += 25
    elif text_len > 150:
        score += 15

    if ergebnis.get("lieferant") and ergebnis.get("lieferant") != "Unbekannt":
        score += 15
    if ergebnis.get("kategorie") and ergebnis.get("kategorie") != "Sonstige":
        score += 10
    if ergebnis.get("brutto_betrag") and str(ergebnis.get("brutto_betrag")) not in ("0", "0.0", "0.00"):
        score += 10
    if ergebnis.get("waehrung"):
        score += 5

    return max(0, min(100, int(score)))


def process_invoice_file(datei_pfad: str, api_key: str = "") -> dict:
    text = ""
    if datei_pfad.lower().endswith(".pdf"):
        try:
            text = text_extrahieren(datei_pfad)
        except Exception:
            text = ""

    ergebnis = klassifizieren(text, api_key=api_key)
    qualitaet_score = qualitaet_score_berechnen(text, ergebnis)
    return {
        "ergebnis": ergebnis,
        "qualitaet_score": qualitaet_score,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Rechnung analysieren (CLI)")
    parser.add_argument("datei", nargs="?", default="rechnung.pdf", help="PDF-Dateipfad")
    parser.add_argument("--api-key", default="", help="Optionaler OpenRouter API-Key")
    args = parser.parse_args()

    out = process_invoice_file(args.datei, api_key=args.api_key)
    result = out["ergebnis"]
    print(json.dumps({
        "lieferant": result.get("lieferant", "Unbekannt"),
        "kategorie": result.get("kategorie", "Sonstige"),
        "netto_betrag": result.get("netto_betrag", "0"),
        "mwst_satz": result.get("mwst_satz", ""),
        "mwst_betrag": result.get("mwst_betrag", "0"),
        "brutto_betrag": result.get("brutto_betrag", "0"),
        "waehrung": result.get("waehrung", "EUR"),
        "qualitaet_score": out["qualitaet_score"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
