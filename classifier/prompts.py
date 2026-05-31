"""Prompt templates used by OCR and classification flows."""

# ── Shared rule blocks ────────────────────────────────────────────────────────

_CATEGORY_RULE = """- Kategorisierung nach dem GEKAUFTEN PRODUKT / der LEISTUNG aus den Positionen.
- Nicht nach Lieferantenname/Marke kategorisieren.
- Lieferantenname darf die Kategorie NICHT beeinflussen (z.B. MediaMarkt kann je nach gekauftem Produkt auch "Gastronomie" sein).
- Falls mehrere Positionen vorliegen: nach dem Hauptkostenblock entscheiden.
- Beispiele:
  - Airfryer/Küchengerät/Lebensmittelnahe Ausgaben => "Gastronomie"
  - Lebensmittel, Getränke, Kaffee, Cappuccino, Sandwich, Fruchtaufstrich, Proteinpulver => "Gastronomie"
  - Auto, Tanken, Parken, Maut, Fahrkarten, Mobilität => "Transport"
  - IT/Elektronik/Software/Lizenzen => "Software & Hardware" """

_DATE_RULE = """- Rechnungsdatum NUR aus expliziten Datumsfeldern lesen (z.B. "Datum", "Rechnungsdatum", "Belegdatum", "Gedruckt am").
- Bei Kassenbons mit mehreren Daten: Bevorzuge das KAUF-/BELEGDATUM in der Zeile mit "Datum" (oft nahe "Uhrzeit"/"Beleg Nr.").
- Ignoriere technische oder nachgelagerte Zeitangaben (z.B. "Startdatum", "Enddatum", "TSE", "Signatur", "Gueltig bis", Kartengueltigkeit).
- Wenn kein eindeutiges Rechnungsdatum sichtbar ist: rechnungsdatum leer lassen.
- NIEMALS das heutige Datum oder Upload-Datum raten, falls es nicht explizit im Beleg steht."""

_RECHNUNG_TYP_RULE = """- rechnung_typ aus Perspektive des Nutzers:
  - Einkauf/Kassenbon/Haendlerbeleg (MediaMarkt, Lidl, Amazon etc.) => "eingang" (Ausgabe des Nutzers).
  - Eigene Ausgangsrechnung des Nutzers an Kunden => "ausgang".
  - Wenn unklar, standardmaessig "eingang"."""

_NETTO_MWST_RULE = """- WICHTIG (Netto vs. MwSt Spalten):
  - Der Netto-Betrag ist IMMER wesentlich größer als der MwSt-Betrag (ca. 5-mal so groß bei 19% und ca. 14-mal so groß bei 7%).
  - Beispiel: Wenn bei 19% ein deutlich größerer Betrag und ein kleinerer MwSt-Betrag zusammenstehen, ist der größere Wert netto_betrag_1 und der kleinere mwst_betrag_1.
  - Beispiel: Wenn bei 7% ein deutlich größerer Betrag und ein kleinerer MwSt-Betrag zusammenstehen, ist der größere Wert netto_betrag_2 und der kleinere mwst_betrag_2.
  - Vertausche Netto und MwSt NIEMALS!"""

_NO_HALLUCINATION_RULE = """- KEINE HALLUZINATION: Nur Werte zurückgeben, die im Bild klar lesbar sind.
- Wenn du nicht sicher bist oder ein Wert nicht eindeutig lesbar ist: leerer String.
- Nichts raten, nichts ergänzen, nichts aus Kontext ableiten.
- KEINE Fantasie-/Platzhalterwerte wie "N/A", "unknown", "###". In solchen Fällen: leerer String."""

_JSON_ONLY_RULE = "Gib NUR JSON zuruck. Keine Erklarungen."
_JSON_ONLY_NO_MARKDOWN_RULE = "Keine Erklaerung, kein Markdown, nur JSON."
_EXPERIENCED_BOOKKEEPER_RULE = "- Rückgabe wie ein erfahrener Buchhalter: relevante Belegdaten vollständig extrahieren."

_BASE_PARSE_FIELDS = """- lieferant: Firmenname
- rechnung_typ: "eingang" oder "ausgang"
- rechnungsdatum: Rechnungsdatum im Format YYYY-MM-DD (wenn erkennbar)
- kategorie: Eine der folgenden Kategorien (nur der Kategoriename):
{categories}
- netto_betrag: Nettobetrag
- mwst_satz: MwSt-Satz
- mwst_betrag: MwSt-Betrag
- brutto_betrag: Bruttobetrag
- waehrung: Währung"""


# ── Public prompt builders ────────────────────────────────────────────────────

def build_vision_direct_parse_prompt(categories: list[str]) -> str:
    """Direct one-shot vision parse: image → full JSON in a single API call."""
    return f"""
Analysiere dieses Belegbild DIREKT und gib NUR JSON im folgenden Schema zurueck:
{{
  "lieferant": "string",
  "adresse": "string",
  "rechnung_typ": "eingang|ausgang",
  "rechnungsdatum": "YYYY-MM-DD oder leer",
  "uhrzeit": "HH:MM oder leer",
  "kategorie": "eine aus {categories}",
  "netto_betrag": "string",
  "mwst_satz": "string",
  "mwst_betrag": "string",
  "brutto_betrag": "string",
  "gesamt_betrag": "string",
  "waehrung": "string",
  "zahlungsart": "string",
  "zahlungsmittel": "string",
  "karten_nr": "string",
  "t_id": "string",
  "beleg_nr": "string",
  "vu_nummer": "string",
  "ust_id_nr": "string",
  "belegnummer": "string",
  "rechnungsnummer": "string",
  "kundennummer": "string",
  "steuer_id": "string",
  "iban_maskiert": "string",
  "faelligkeitsdatum": "YYYY-MM-DD oder leer",
  "notizen": "string",
  "mwst_satz_1": "string",
  "mwst_betrag_1": "string",
  "netto_betrag_1": "string",
  "mwst_satz_2": "string",
  "mwst_betrag_2": "string",
  "netto_betrag_2": "string"
}}
{_JSON_ONLY_NO_MARKDOWN_RULE}
WICHTIG:
{_NO_HALLUCINATION_RULE}
- `beleg_nr`, `belegnummer`, `rechnungsnummer`, `kundennummer`, `steuer_id`, `iban_maskiert`, `ust_id_nr`, `vu_nummer`:
  - nur kurze, echte Werte übernehmen;
  - wenn der Wert unklar, verrauscht oder sehr lang ist (z.B. > 40 Zeichen), leerer String zurückgeben.
- Wenn mehrere Steuerzeilen vorhanden sind:
  - Zeile mit 19% (oder dem höheren Satz) in *_1.
  - Zeile mit 7% (oder dem niedrigeren Satz) in *_2.
{_NETTO_MWST_RULE}
{_CATEGORY_RULE}
{_DATE_RULE}
{_RECHNUNG_TYP_RULE}
{_EXPERIENCED_BOOKKEEPER_RULE}
"""


def build_vision_tax_only_prompt() -> str:
    """Minimal pass: extract VAT buckets only from the invoice totals section."""
    return f"""
Lies NUR die MwSt-Aufteilung im Summenbereich des Belegs.
Nutze ausschließlich Zeilen, die Steuern ausweisen (z.B. "19%" / "7%" oder "A" / "B").

Gib NUR dieses JSON zurück:
{{
  "mwst_betrag_1": "string",
  "mwst_satz_1": "string",
  "netto_betrag_1": "string",
  "mwst_betrag_2": "string",
  "mwst_satz_2": "string",
  "netto_betrag_2": "string"
}}

Regeln:
{_NO_HALLUCINATION_RULE}
- Wenn 2 Steuerzeilen vorhanden sind: _1 ist die 19%-Zeile (oder der höhere Satz), _2 ist die 7%-Zeile (oder der niedrigere Satz).
{_NETTO_MWST_RULE}
- Zahlen exakt vom Beleg übernehmen, Format mit Komma (z.B. 19,16).
- {_JSON_ONLY_RULE}
"""


def build_text_invoice_prompt(invoice_text: str, categories: list[str]) -> str:
    """Parse plain-text invoice (PDF text extraction flow)."""
    return f"""
Analysiere die folgende Rechnung und gib die folgenden Felder als JSON zuruck.

Felder:
{_BASE_PARSE_FIELDS.format(categories=categories)}

WICHTIG:
{_CATEGORY_RULE}
{_DATE_RULE}
- Datumsformat kann auch "13 Oktober 2023" / "13 October 2023" sein; korrekt zu YYYY-MM-DD normalisieren.
- Bei mehreren Datumsangaben (z.B. TSE Start/Ende/Signatur): nur das Kauf-/Belegdatum verwenden.
{_RECHNUNG_TYP_RULE}

{_JSON_ONLY_RULE}

Rechnungstext:
{invoice_text}
"""
