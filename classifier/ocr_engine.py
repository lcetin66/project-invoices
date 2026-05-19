import pdfplumber
import os
import json
import requests
import base64
import re
import tempfile
from datetime import datetime, timedelta
from dotenv import load_dotenv
from .categories import STANDARDS_KATEGORIEN

try:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
except Exception:
    Image = None
    ImageEnhance = None
    ImageFilter = None
    ImageOps = None

try:
    import pytesseract
except Exception:
    pytesseract = None

try:
    import numpy as np
except Exception:
    np = None

try:
    import cv2
except Exception:
    cv2 = None

load_dotenv()
API_KEY_OPENROUTER = os.getenv("OPENROUTER_API_KEY", "")
API_KEY_OPENAI = os.getenv("OPENAI_API_KEY", "")
SYSTEM_ROLE = "Erfahrener Buchhaltungsexperte"
IMAGE_OCR_MODE = (os.getenv("IMAGE_OCR_MODE", "vision_first") or "vision_first").strip().lower()
_PADDLE_INSTANCE = None
_PADDLE_INIT_FAILED = False
LOCAL_OCR_CACHE_ROOT = os.path.join(tempfile.gettempdir(), "masterschool_ocr_cache")
_LAST_VISION_DEBUG = ""


def get_last_vision_debug() -> str:
    return str(_LAST_VISION_DEBUG or "")


def _typ_heuristik_aus_text(text: str) -> str:
    t = (text or "").lower()
    # Hard business rule: customer receipts/payment slips are incoming invoices.
    receipt_signals = [
        r"\bkundenbeleg\b",
        r"\bkartenzahlung\b",
        r"\bec\s*zahlung\b",
        r"\bbetrag\s*eur\b",
        r"\bmwst\b",
        r"\bgedruckt\s+am\b",
    ]
    if any(re.search(p, t) for p in receipt_signals):
        return "eingang"

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

    # Hard override by purchased product / usage intent (not supplier name).
    product_rules = [
        ("Transport", [r"\b(benzin|diesel|tank|tanken|ladestrom|ladevorgang|parken|parkhaus|autobahn|maut|bahn|db|uber|bolt|taxi|fahrkarte|kfz)\b"]),
        ("Gastronomie", [r"\b(airfryer|heissluftfritteuse|küche|kueche|küchengerät|kuechengeraet|kaffeemaschine|wasserkocher|toaster|mikrowelle|ofen)\b"]),
        ("Software & Hardware", [r"\b(laptop|notebook|pc|monitor|ssd|hdd|router|headset|software|lizenz|abo|saas|app)\b"]),
        ("Telekommunikation", [r"\b(sim|mobilfunk|telefon|internet|dsl|5g|roaming)\b"]),
    ]
    for cat, patterns in product_rules:
        if any(re.search(p, full_text) for p in patterns):
            ergebnis["kategorie"] = cat
            break

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


def _pil_lanczos():
    if Image is None:
        return None
    if hasattr(Image, "Resampling"):
        return Image.Resampling.LANCZOS
    return Image.LANCZOS


def _clean_ocr_text(text: str) -> str:
    if not text:
        return ""
    rows = [re.sub(r"\s+", " ", ln).strip() for ln in str(text).splitlines()]
    rows = [ln for ln in rows if ln]
    return "\n".join(rows).strip()


def _prepare_image_for_local_ocr(datei_pfad: str, use_crop: bool = True):
    if Image is None or not os.path.isfile(datei_pfad):
        return None
    try:
        with Image.open(datei_pfad) as raw:
            img = _crop_rechnung_region(raw) if use_crop else raw.convert("RGB")
            gray = img.convert("L")
            if ImageOps is not None:
                gray = ImageOps.autocontrast(gray)
            if ImageFilter is not None:
                gray = gray.filter(ImageFilter.MedianFilter(size=3))
            if ImageEnhance is not None:
                gray = ImageEnhance.Sharpness(gray).enhance(1.7)

            w, h = gray.size
            target_h = 2200
            if h > 0 and h < target_h:
                scale = target_h / float(h)
                resample = _pil_lanczos()
                if resample is not None:
                    gray = gray.resize((max(1, int(w * scale)), target_h), resample=resample)

            bw = gray.point(lambda p: 255 if p > 168 else 0)
            return bw
    except Exception:
        return None


def _prepare_image_variants_for_local_ocr(datei_pfad: str):
    """Build several image variants; some receipts fail on a single threshold."""
    if Image is None or not os.path.isfile(datei_pfad):
        return []
    variants = []
    for use_crop in (True, False):
        try:
            with Image.open(datei_pfad) as raw:
                img = _crop_rechnung_region(raw) if use_crop else raw.convert("RGB")
                gray = img.convert("L")
                if ImageOps is not None:
                    gray = ImageOps.autocontrast(gray)
                if ImageFilter is not None:
                    gray = gray.filter(ImageFilter.MedianFilter(size=3))
                if ImageEnhance is not None:
                    gray = ImageEnhance.Sharpness(gray).enhance(1.7)

                w, h = gray.size
                target_h = 2200
                if h > 0 and h < target_h:
                    scale = target_h / float(h)
                    resample = _pil_lanczos()
                    if resample is not None:
                        gray = gray.resize((max(1, int(w * scale)), target_h), resample=resample)

                # 1) plain gray
                variants.append(gray)
                # 2..n) multiple binary thresholds
                for th in (145, 160, 175, 190):
                    variants.append(gray.point(lambda p, t=th: 255 if p > t else 0))
        except Exception:
            continue
    return variants


def _get_paddle_instance():
    global _PADDLE_INSTANCE, _PADDLE_INIT_FAILED
    if _PADDLE_INSTANCE is not None:
        return _PADDLE_INSTANCE
    if _PADDLE_INIT_FAILED:
        return None
    try:
        os.makedirs(LOCAL_OCR_CACHE_ROOT, exist_ok=True)
        os.environ.setdefault("PADDLE_PDX_CACHE_HOME", os.path.join(LOCAL_OCR_CACHE_ROOT, "paddlex"))
        os.environ.setdefault("PADDLE_HOME", os.path.join(LOCAL_OCR_CACHE_ROOT, "paddle"))
        os.makedirs(os.environ["PADDLE_PDX_CACHE_HOME"], exist_ok=True)
        os.makedirs(os.environ["PADDLE_HOME"], exist_ok=True)
    except Exception:
        pass
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception:
        _PADDLE_INIT_FAILED = True
        return None

    candidates = [
        {"lang": "german"},
        {"lang": "en"},
    ]
    for kwargs in candidates:
        try:
            _PADDLE_INSTANCE = PaddleOCR(**kwargs)
            return _PADDLE_INSTANCE
        except TypeError:
            continue
        except Exception:
            continue
    _PADDLE_INIT_FAILED = True
    return None


def _collect_paddle_text(node, out_lines):
    if isinstance(node, (list, tuple)):
        if (
            len(node) == 2
            and isinstance(node[1], (list, tuple))
            and len(node[1]) >= 1
            and isinstance(node[1][0], str)
        ):
            txt = node[1][0].strip()
            if txt:
                out_lines.append(txt)
            return
        for item in node:
            _collect_paddle_text(item, out_lines)


def _ocr_with_paddle(prepared_img) -> str:
    ocr = _get_paddle_instance()
    if ocr is None or prepared_img is None:
        return ""

    tmp_path = ""
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="ocr_", suffix=".png")
        os.close(fd)
        prepared_img.save(tmp_path, format="PNG")
        out_lines = []
        try:
            result = ocr.ocr(tmp_path, cls=True)
            _collect_paddle_text(result, out_lines)
        except Exception:
            result = None
        if not out_lines:
            try:
                result2 = ocr.ocr(tmp_path, cls=False)
                _collect_paddle_text(result2, out_lines)
            except Exception:
                pass
        return _clean_ocr_text("\n".join(out_lines))
    except Exception:
        return ""
    finally:
        if tmp_path and os.path.isfile(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _ocr_with_tesseract(prepared_img) -> str:
    if pytesseract is None or prepared_img is None:
        return ""
    try:
        img_for_tesseract = prepared_img.convert("RGB")
    except Exception:
        img_for_tesseract = prepared_img
    languages = ["deu+eng", "eng+deu", "deu", "eng"]
    configs = ["--oem 3 --psm 6", "--oem 3 --psm 11"]
    best = ""
    for lang in languages:
        for cfg in configs:
            try:
                candidate = pytesseract.image_to_string(img_for_tesseract, lang=lang, config=cfg)
                candidate = _clean_ocr_text(candidate)
                if len(candidate) > len(best):
                    best = candidate
            except Exception:
                continue
    return best


def bild_text_extrahieren(datei_pfad: str) -> str:
    """Text aus Bild extrahieren (lokaler OCR-Fallback: PaddleOCR -> Tesseract)."""
    mode = IMAGE_OCR_MODE if IMAGE_OCR_MODE in ("local_first", "local_only", "vision_only") else "local_first"
    if mode == "vision_only":
        return ""
    variants = _prepare_image_variants_for_local_ocr(datei_pfad)
    if not variants:
        return ""

    best = ""
    for prepared in variants:
        text = _ocr_with_paddle(prepared)
        if len(text) > len(best):
            best = text
    if best:
        return best

    for prepared in variants:
        text = _ocr_with_tesseract(prepared)
        if len(text) > len(best):
            best = text
    return best


def _crop_rechnung_region(img):
    """
    Schneidet die wahrscheinliche Beleg-/Rechnungsregion aus dem Bild.
    Nutzt eine robuste Dokument-Maskierung (helle, entsättigte Fläche) + Connected Components.
    """
    if Image is None:
        return img
    try:
        src = img.convert("RGB")
        w, h = src.size
        if w < 40 or h < 40:
            return src

        # Fallback ohne OpenCV/Numpy: bestehendes, konservatives Verhalten.
        if np is None or cv2 is None:
            gray = src.convert("L")
            mask = gray.point(lambda p: 255 if p < 235 else 0)
            bbox = mask.getbbox()
            if not bbox:
                return src
            x0, y0, x1, y1 = bbox
            pad_x = max(8, int((x1 - x0) * 0.02))
            pad_y = max(8, int((y1 - y0) * 0.02))
            x0 = max(0, x0 - pad_x)
            y0 = max(0, y0 - pad_y)
            x1 = min(w, x1 + pad_x)
            y1 = min(h, y1 + pad_y)
            cropped = src.crop((x0, y0, x1, y1))
            cw, ch = cropped.size
            if cw < int(w * 0.15) or ch < int(h * 0.15):
                return src
            return cropped

        # Scale down for faster/stabler segmentation, keep mapping to original coords.
        max_side = 1400
        scale = min(1.0, max_side / float(max(w, h)))
        if scale < 1.0:
            sw, sh = int(w * scale), int(h * scale)
            work = src.resize((sw, sh), Image.Resampling.LANCZOS)
        else:
            sw, sh = w, h
            work = src

        arr = np.array(work, dtype=np.uint8)  # HxWx3 RGB
        # Whitish document mask: bright + low saturation-like channel spread
        maxc = arr.max(axis=2)
        minc = arr.min(axis=2)
        spread = maxc - minc
        gray = (0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]).astype(np.uint8)
        mask = ((gray > 165) & (spread < 70)).astype(np.uint8) * 255

        # Connect fragmented paper areas.
        kernel = np.ones((5, 5), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

        n_labels, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        if n_labels <= 1:
            return src

        best = None
        best_score = -1.0
        img_area = float(sw * sh)
        for i in range(1, n_labels):
            x, y, cw, ch, area = stats[i]
            if area < img_area * 0.004:  # ignore tiny noise
                continue
            if ch < int(sh * 0.20):
                continue
            aspect = ch / float(max(cw, 1))
            if aspect < 1.05:
                continue
            cx = x + cw / 2.0
            center_bonus = 1.0 - min(1.0, abs(cx - (sw / 2.0)) / (sw / 2.0))
            score = area * (1.0 + min(aspect, 8.0)) * (0.75 + 0.25 * center_bonus)
            if score > best_score:
                best_score = score
                best = (x, y, x + cw, y + ch)

        if not best:
            return src

        x0s, y0s, x1s, y1s = best
        # Map back to original coordinates.
        inv = (1.0 / scale) if scale > 0 else 1.0
        x0 = int(round(x0s * inv))
        y0 = int(round(y0s * inv))
        x1 = int(round(x1s * inv))
        y1 = int(round(y1s * inv))

        # Safety margin to keep border text.
        pad_x = max(8, int((x1 - x0) * 0.02))
        pad_y = max(8, int((y1 - y0) * 0.02))
        x0 = max(0, x0 - pad_x)
        y0 = max(0, y0 - pad_y)
        x1 = min(w, x1 + pad_x)
        y1 = min(h, y1 + pad_y)

        cropped = src.crop((x0, y0, x1, y1))
        cw, ch = cropped.size
        # Offensichtliche Fehl-Crops vermeiden.
        if cw < int(w * 0.15) or ch < int(h * 0.15):
            return src
        return cropped
    except Exception:
        return img


def _standard_response(ergebnis: dict) -> dict:
    typ = str(ergebnis.get("rechnung_typ", "eingang") or "eingang").strip().lower()
    if typ not in ("eingang", "ausgang"):
        typ = "eingang"
    return {
        "lieferant": ergebnis.get("lieferant", "Unbekannt"),
        "rechnung_typ": typ,
        "rechnungsdatum": ergebnis.get("rechnungsdatum", ""),
        "kategorie": ergebnis.get("kategorie", "Sonstige"),
        "netto_betrag": ergebnis.get("netto_betrag", "0"),
        "mwst_satz": ergebnis.get("mwst_satz", ""),
        "mwst_betrag": ergebnis.get("mwst_betrag", "0"),
        "brutto_betrag": ergebnis.get("brutto_betrag", "0"),
        "waehrung": ergebnis.get("waehrung", "EUR"),
        "zahlungsart": ergebnis.get("zahlungsart", ""),
        "zahlungsmittel": ergebnis.get("zahlungsmittel", ""),
        "belegnummer": ergebnis.get("belegnummer", ""),
        "rechnungsnummer": ergebnis.get("rechnungsnummer", ""),
        "kundennummer": ergebnis.get("kundennummer", ""),
        "steuer_id": ergebnis.get("steuer_id", ""),
        "iban_maskiert": ergebnis.get("iban_maskiert", ""),
        "faelligkeitsdatum": ergebnis.get("faelligkeitsdatum", ""),
        "notizen": ergebnis.get("notizen", ""),
    }


def _extract_plausible_invoice_date(text: str) -> str:
    t = text or ""
    if not t.strip():
        return ""

    month_map = {
        "januar": 1, "jan": 1, "january": 1,
        "februar": 2, "feb": 2, "february": 2,
        "maerz": 3, "märz": 3, "marz": 3, "mrz": 3, "mar": 3, "march": 3,
        "april": 4, "apr": 4,
        "mai": 5, "may": 5,
        "juni": 6, "jun": 6, "june": 6,
        "juli": 7, "jul": 7, "july": 7,
        "august": 8, "aug": 8,
        "september": 9, "sep": 9, "sept": 9,
        "oktober": 10, "okt": 10, "october": 10, "oct": 10,
        "november": 11, "nov": 11,
        "dezember": 12, "dez": 12, "december": 12, "dec": 12,
    }

    def _parse_line_dates(line: str):
        out = []
        for m in re.finditer(r"\b(20\d{2})[\./-]([01]?\d)[\./-]([0-3]?\d)\b", line):
            y, mo, d = m.groups()
            try:
                out.append(datetime(int(y), int(mo), int(d)))
            except ValueError:
                pass
        for m in re.finditer(r"\b([0-3]?\d)[\./-]([01]?\d)[\./-]((?:20)?\d{2})\b", line):
            d, mo, y = m.groups()
            if len(y) == 2:
                y = "20" + y
            try:
                out.append(datetime(int(y), int(mo), int(d)))
            except ValueError:
                pass
        for m in re.finditer(r"\b([0-3]?\d)\s+([A-Za-zÄÖÜäöüß]+)\s+((?:20)?\d{2})\b", line):
            d, mon_raw, y = m.groups()
            mon_key = mon_raw.strip().lower().replace(".", "")
            mo = month_map.get(mon_key)
            if not mo:
                continue
            if len(y) == 2:
                y = "20" + y
            try:
                out.append(datetime(int(y), int(mo), int(d)))
            except ValueError:
                pass
        return out

    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    scored = []
    for ln in lines:
        ln_l = ln.lower()
        dates = _parse_line_dates(ln)
        if not dates:
            continue
        score = 0
        if re.search(r"\b(datum|rechnungsdatum|belegdatum|gedruckt)\b", ln_l):
            score += 6
        if re.search(r"\b(uhrzeit|time)\b", ln_l):
            score += 2
        if re.search(r"\b(gültig|gueltig|bis|expiry|exp)\b", ln_l):
            score -= 4
        for dt in dates:
            scored.append((score, dt))

    if not scored:
        # fallback over entire text
        scored = [(0, dt) for dt in _parse_line_dates(t)]
    if not scored:
        return ""

    today = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)
    min_dt = today - timedelta(days=3650)  # ~10 years
    max_dt = today + timedelta(days=30)
    plausible = [(s, dt) for (s, dt) in scored if min_dt <= dt <= max_dt]
    if not plausible:
        return ""

    # Prefer high-confidence date lines ("Datum", "Rechnungsdatum"), then newest.
    best = sorted(plausible, key=lambda x: (x[0], x[1]), reverse=True)[0][1]
    return best.strftime("%Y-%m-%d")


_AMOUNT_TOKEN_RE = re.compile(
    r"(?<!\d)(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))(?!\d)"
)


def _parse_locale_amount(raw: str) -> float:
    value = str(raw or "").strip()
    if not value:
        return 0.0
    value = value.replace("\u00A0", " ").replace(" ", "")
    value = re.sub(r"[^0-9,.\-]", "", value)
    if not value:
        return 0.0

    if value.count(",") > 1 and "." not in value:
        last = value.rfind(",")
        value = value[:last].replace(",", "") + "." + value[last + 1:]
    elif value.count(".") > 1 and "," not in value:
        last = value.rfind(".")
        value = value[:last].replace(".", "") + "." + value[last + 1:]
    elif "," in value and "." in value:
        if value.rfind(",") > value.rfind("."):
            value = value.replace(".", "").replace(",", ".")
        else:
            value = value.replace(",", "")
    elif "," in value:
        value = value.replace(",", ".")

    try:
        return float(value)
    except Exception:
        return 0.0


def _extract_amount_tokens(line: str):
    tokens = []
    for raw in _AMOUNT_TOKEN_RE.findall(line or ""):
        parsed = _parse_locale_amount(raw)
        if parsed > 0:
            tokens.append(parsed)
    return tokens


def _extract_amount_evidence(text: str):
    out = {"brutto": 0.0, "netto": 0.0, "mwst_betrag": 0.0, "mwst_satz": 0.0}
    if not text:
        return out

    lines = [ln.strip() for ln in str(text).splitlines() if ln.strip()]
    if not lines:
        return out

    skip_for_total = re.compile(
        r"\b(punkte|trace|terminal|beleg\s*nr|belegnr|iban|konto|blz|karte|karten|transaktionsnummer|tse|startdatum|enddatum|basis)\b",
        re.IGNORECASE,
    )

    for line in lines:
        low = line.lower()
        amounts = _extract_amount_tokens(line)
        if not amounts:
            continue

        if re.search(r"\b(netto|netto-?warenwert)\b", low):
            out["netto"] = amounts[-1]
            continue

        if re.search(r"\b(mwst|ust|umsatzsteuer|vat|tax)\b", low):
            rate_match = re.search(r"\b(\d{1,2}(?:[.,]\d{1,2})?)\s*%", low)
            if rate_match:
                out["mwst_satz"] = _parse_locale_amount(rate_match.group(1))
            if len(amounts) >= 2 and out["mwst_satz"] > 0:
                rate_like = out["mwst_satz"]
                non_rate_amounts = [a for a in amounts if abs(a - rate_like) > 0.09]
                out["mwst_betrag"] = (non_rate_amounts or amounts)[-1]
            else:
                out["mwst_betrag"] = amounts[-1]
            continue

        if re.search(r"\b(total|gesamt(?:betrag)?|zahlbetrag|zu\s*zahlen|betrag)\b", low):
            if skip_for_total.search(low):
                continue
            out["brutto"] = amounts[-1]

    if out["brutto"] <= 0:
        for line in lines:
            low = line.lower()
            if "eur" not in low and "€" not in line:
                continue
            if skip_for_total.search(low):
                continue
            amounts = _extract_amount_tokens(line)
            if amounts:
                out["brutto"] = max(out["brutto"], amounts[-1])
    return out


def _extract_supplier_from_text(text: str) -> str:
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    if not lines:
        return ""

    stop = re.compile(
        r"\b(datum|uhrzeit|beleg|trace|summe|total|betrag|mwst|ust|netto|kartenzahlung|girocard|punkte|startdatum|enddatum|tse)\b",
        re.IGNORECASE,
    )
    company = re.compile(r"\b(gmbh|ag|kg|ug|ltd|inc|llc|s\.a\.r\.l)\b", re.IGNORECASE)

    for idx, line in enumerate(lines[:18]):
        if stop.search(line):
            continue
        if company.search(line):
            candidate = line
            if idx > 0 and re.search(r"\b(media\s*markt|saturn)\b", lines[idx - 1], re.IGNORECASE):
                candidate = f"{lines[idx - 1]} {line}"
            candidate = re.sub(r"\s+", " ", candidate).strip(" -,:;")
            if len(candidate) >= 3:
                return candidate[:120]

    for line in lines[:12]:
        if stop.search(line):
            continue
        if re.search(r"\bmedia\s*markt\b", line, re.IGNORECASE):
            return "Media Markt"

    for line in lines[:8]:
        if stop.search(line):
            continue
        if re.search(r"[A-Za-zÄÖÜäöüß]{3,}", line):
            candidate = re.sub(r"\s+", " ", line).strip(" -,:;")
            if len(candidate) >= 3:
                return candidate[:120]
    return ""


def _normalize_with_text(ergebnis: dict, text: str) -> dict:
    t = (text or "").lower()
    out = dict(ergebnis)
    supplier_hint = _extract_supplier_from_text(text)
    current_supplier = str(out.get("lieferant", "") or "").strip()
    current_supplier_low = current_supplier.lower()
    if supplier_hint:
        if (
            current_supplier_low in ("", "unbekannt", "unknown", "musterfirma", "musterfirma gmbh")
            or current_supplier_low.startswith("muster")
            or (
                "media markt" in supplier_hint.lower()
                and "media markt" not in current_supplier_low
            )
        ):
            out["lieferant"] = supplier_hint

    vat_evidence = bool(
        re.search(r"\b(mwst|ust|umsatzsteuer|vat|tax)\b", t)
        or re.search(r"\b(7|8|10|18|19|20|23)\s*%", t)
        or re.search(r"\binkl\.?\s*(mwst|ust)?\s*\d{1,2}\s*%", t)
    )

    # Currency reconciliation from explicit symbols/keywords in OCR text.
    has_eur = bool(re.search(r"(€|\beur\b)", t))
    has_pln = bool(re.search(r"(\bpln\b|zł|zl\b)", t))
    if has_eur and not has_pln:
        out["waehrung"] = "EUR"
    elif has_pln and not has_eur:
        out["waehrung"] = "PLN"

    # VAT reconciliation: prefer explicit rates visible in text.
    vat_hits = re.findall(r"\b(7|8|10|18|19|20|23)\s*%", t)
    if vat_hits:
        vat_vals = [int(v) for v in vat_hits]
        if out.get("waehrung") == "EUR":
            # For EUR receipts, trust DE rates only. Do NOT force unknown/noisy values like 18/23.
            if 19 in vat_vals:
                out["mwst_satz"] = "19"
            elif 7 in vat_vals:
                out["mwst_satz"] = "7"
            # else keep model value unchanged
        else:
            out["mwst_satz"] = str(vat_vals[0])

    # Hard safety rule for EUR receipts: only 7% or 19% are valid in this app context.
    if out.get("waehrung") == "EUR":
        raw_vat = str(out.get("mwst_satz", "")).strip().replace(",", ".")
        try:
            vat_num = float(raw_vat) if raw_vat != "" else 0.0
        except Exception:
            vat_num = 0.0
        if vat_num and vat_num not in (7.0, 19.0):
            out["mwst_satz"] = "19"

    # Date reconciliation: prefer text-derived plausible date.
    # If model date is not corroborated by OCR text, drop it to avoid hallucinated years.
    guessed_date = _extract_plausible_invoice_date(text)
    if guessed_date:
        out["rechnungsdatum"] = guessed_date
    else:
        raw_model_date = str(out.get("rechnungsdatum", "") or "").strip()
        if raw_model_date:
            try:
                dt = datetime.strptime(raw_model_date, "%Y-%m-%d")
                today = datetime.today().replace(hour=0, minute=0, second=0, microsecond=0)
                min_dt = today - timedelta(days=3650)
                max_dt = today + timedelta(days=30)
                dmy = dt.strftime("%d.%m.%Y")
                iso = dt.strftime("%Y-%m-%d")
                corroborated = (dmy in (text or "")) or (iso in (text or ""))
                if not (min_dt <= dt <= max_dt) or not corroborated:
                    out["rechnungsdatum"] = ""
            except Exception:
                out["rechnungsdatum"] = ""

    amount_evidence = _extract_amount_evidence(text)

    current_brutto = _parse_locale_amount(str(out.get("brutto_betrag", "0")))
    if amount_evidence["brutto"] > 0:
        # Override implausible model totals with explicit receipt totals from OCR text.
        if current_brutto <= 0 or abs(current_brutto - amount_evidence["brutto"]) > max(1.0, amount_evidence["brutto"] * 0.1):
            out["brutto_betrag"] = f"{amount_evidence['brutto']:.2f}"

    if amount_evidence["mwst_satz"] > 0:
        mwst_rate = amount_evidence["mwst_satz"]
        if out.get("waehrung") != "EUR" or mwst_rate in (7.0, 19.0):
            out["mwst_satz"] = str(int(mwst_rate)) if float(mwst_rate).is_integer() else str(round(mwst_rate, 2))

    if amount_evidence["netto"] > 0:
        out["netto_betrag"] = f"{amount_evidence['netto']:.2f}"
    if amount_evidence["mwst_betrag"] > 0:
        out["mwst_betrag"] = f"{amount_evidence['mwst_betrag']:.2f}"

    # Keep amounts consistent.
    try:
        brutto = float(str(out.get("brutto_betrag", "0")).replace(",", "."))
    except Exception:
        brutto = 0.0
    try:
        netto_existing = float(str(out.get("netto_betrag", "0")).replace(",", "."))
    except Exception:
        netto_existing = 0.0
    try:
        vat_rate = float(str(out.get("mwst_satz", "")).replace(",", "."))
    except Exception:
        vat_rate = 0.0
    try:
        mwst_existing = float(str(out.get("mwst_betrag", "0")).replace(",", "."))
    except Exception:
        mwst_existing = 0.0

    has_explicit_netto = amount_evidence["netto"] > 0
    has_explicit_mwst = amount_evidence["mwst_betrag"] > 0

    # If no explicit VAT evidence in OCR text, avoid aggressive overwrites.
    # Only fallback to brutto=netto when model also has no usable VAT rate.
    if not vat_evidence:
        if vat_rate <= 0:
            chosen = brutto if brutto > 0 else netto_existing
            if chosen > 0:
                out["brutto_betrag"] = f"{chosen:.2f}"
                out["netto_betrag"] = f"{chosen:.2f}"
            out["mwst_satz"] = ""
            out["mwst_betrag"] = "0"
    elif brutto > 0 and vat_rate > 0:
        netto = brutto / (1.0 + (vat_rate / 100.0))
        mwst_betrag = brutto - netto
        if not has_explicit_netto:
            out["netto_betrag"] = f"{netto:.2f}"
        if not has_explicit_mwst:
            out["mwst_betrag"] = f"{mwst_betrag:.2f}"

    if brutto > 0 and has_explicit_netto and not has_explicit_mwst and mwst_existing <= 0:
        delta = max(0.0, brutto - netto_existing)
        out["mwst_betrag"] = f"{delta:.2f}"
    if brutto > 0 and has_explicit_mwst and not has_explicit_netto and netto_existing <= 0:
        netto_calc = max(0.0, brutto - mwst_existing)
        out["netto_betrag"] = f"{netto_calc:.2f}"

    return _standard_response(out)


def _vision_klassifizieren(datei_pfad: str, api_key: str, api_provider: str = "openrouter", api_model: str = "") -> dict:
    global _LAST_VISION_DEBUG
    _LAST_VISION_DEBUG = ""
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
        raw_bytes = f.read()

    # Optional crop to focus receipt/invoice region before sending to vision model.
    encoded = base64.b64encode(raw_bytes).decode("ascii")
    encoded_chunks = [encoded]
    if Image is not None:
        try:
            from io import BytesIO
            with Image.open(BytesIO(raw_bytes)) as img:
                cropped = _crop_rechnung_region(img)
                w, h = cropped.size
                buf = BytesIO()
                cropped.save(buf, format="PNG")
                encoded = base64.b64encode(buf.getvalue()).decode("ascii")
                mime = "image/png"

                # Very long receipts lose detail in one-shot vision calls.
                # Split vertically into overlapping chunks for more stable OCR.
                if h > 1600 and h / float(max(w, 1)) > 2.2:
                    chunk_h = 1300
                    overlap = 180
                    step = max(500, chunk_h - overlap)
                    chunk_payloads = []
                    y = 0
                    while y < h:
                        y2 = min(h, y + chunk_h)
                        part = cropped.crop((0, y, w, y2))
                        part_buf = BytesIO()
                        part.save(part_buf, format="PNG")
                        chunk_payloads.append(base64.b64encode(part_buf.getvalue()).decode("ascii"))
                        if y2 >= h:
                            break
                        y += step
                    if chunk_payloads:
                        encoded_chunks = chunk_payloads
                    else:
                        encoded_chunks = [encoded]
                else:
                    encoded_chunks = [encoded]
        except Exception:
            pass

    text_prompt = """
Lies das Belegbild visuell und extrahiere den VOLLSTÄNDIGEN sichtbaren Text.
WICHTIG:
- Keine Zusammenfassung, keine Interpretation.
- Reihenfolge möglichst wie im Dokument (oben nach unten).
- Auch Datum/Uhrzeit/Belegnummer/Steuer- und Gesamtbeträge übernehmen.
- Gib NUR JSON zurück: {"ocr_text":"..."}.
"""

    parse_prompt_tpl = f"""
Analysiere den folgenden Rechnungstext und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- rechnung_typ: "eingang" oder "ausgang"
- rechnungsdatum: Rechnungsdatum im Format YYYY-MM-DD (wenn erkennbar)
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
- Rechnungsdatum NUR aus expliziten Datumsfeldern lesen (z.B. "Datum", "Rechnungsdatum", "Belegdatum", "Gedruckt am").
- Bei Kassenbons mit mehreren Daten: Bevorzuge das KAUF-/BELEGDATUM in der Zeile mit "Datum" (oft nahe "Uhrzeit"/"Beleg Nr.").
- Ignoriere technische oder nachgelagerte Zeitangaben (z.B. "Startdatum", "Enddatum", "TSE", "Signatur", "Gueltig bis", Kartengueltigkeit).
- Wenn kein eindeutiges Rechnungsdatum sichtbar ist: rechnungsdatum leer lassen.
- NIEMALS das heutige Datum oder Upload-Datum raten, falls es nicht explizit im Beleg steht.
- Für EUR-Belege gilt i.d.R. MwSt 19% oder 7%; gib den explizit gelesenen Satz an.
- Währung nur aus sichtbarem Symbol/Text ableiten (EUR/€ etc.), NICHT raten.
- rechnung_typ aus Perspektive des Nutzers:
  - Einkauf/Kassenbon/Haendlerbeleg (MediaMarkt, Lidl, Amazon etc.) => "eingang" (Ausgabe des Nutzers).
  - Eigene Ausgangsrechnung des Nutzers an Kunden => "ausgang".
  - Wenn unklar, standardmaessig "eingang".

Gib NUR JSON zuruck. Keine Erklarungen.
"""

    vision_model = (
        (api_model or "").strip()
        or ("gpt-5.4-mini" if api_provider == "openai" else "openai/gpt-5.4-mini")
    )
    candidate_models = []
    for m in [
        vision_model,
        ("gpt-5.4-mini" if api_provider == "openai" else "openai/gpt-5.4-mini"),
        ("gpt-5.4-nano" if api_provider == "openai" else "openai/gpt-5.4-nano"),
        ("gpt-4o-mini" if api_provider == "openai" else "openai/gpt-4o-mini"),
    ]:
        if m and m not in candidate_models:
            candidate_models.append(m)

    if api_provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _vision_payload(prompt_text: str, image_b64: str, model_name: str):
        return {
            "model": model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_ROLE},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}", "detail": "high"}},
                    ],
                }
            ],
            "temperature": 0,
            "max_tokens": 700,
        }

    def _vision_extract_date() -> str:
        date_prompt = """
Lies NUR das Rechnungsdatum aus dem Belegbild.
WICHTIG:
- Priorität auf Zeilen mit "Datum", "Rechnungsdatum", "Belegdatum", "Gedruckt am".
- Bei Kassenbons mit mehreren Daten: nimm das Kaufdatum aus der Zeile "Datum" (oft mit "Uhrzeit"/"Beleg Nr.").
- Ignoriere technische TSE-/Start-/Ende-Zeitstempel sowie "Gueltig bis"/Kartengueltigkeit.
- NIEMALS das heutige Datum raten. Nur sichtbares Datum aus dem Beleg liefern.
- Gib genau ein JSON zurück: {"rechnungsdatum":"YYYY-MM-DD"}.
- Wenn nicht sicher erkennbar, gib {"rechnungsdatum":""}.
"""
        if api_provider == "openai":
            d_url = "https://api.openai.com/v1/chat/completions"
            d_headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            d_payload = {
                "model": vision_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_ROLE},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": date_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                        ],
                    }
                ],
                "temperature": 0,
            }
        else:
            d_url = "https://openrouter.ai/api/v1/chat/completions"
            d_headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            d_payload = {
                "model": vision_model,
                "messages": [
                    {"role": "system", "content": SYSTEM_ROLE},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": date_prompt},
                            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
                        ],
                    }
                ],
            }
        try:
            d_resp = requests.post(d_url, headers=d_headers, json=d_payload, timeout=45)
            d_json = d_resp.json()
            if "choices" not in d_json:
                return ""
            d_raw = d_json["choices"][0]["message"]["content"].strip()
            if d_raw.startswith("```"):
                d_raw = d_raw.split("```")[1].replace("json", "", 1).strip()
            parsed = json.loads(d_raw)
            val = str(parsed.get("rechnungsdatum", "") or "").strip()
            if re.match(r"^20\d{2}-\d{2}-\d{2}$", val):
                return val
            return ""
        except Exception:
            return ""

    direct_parse_prompt = f"""
Analysiere dieses Rechnungs-/Belegbild DIREKT und gib NUR JSON im folgenden Schema zurueck:
{{
  "lieferant": "string",
  "rechnung_typ": "eingang|ausgang",
  "rechnungsdatum": "YYYY-MM-DD oder leer",
  "kategorie": "eine aus {list(STANDARDS_KATEGORIEN.keys())}",
  "netto_betrag": "string",
  "mwst_satz": "string",
  "mwst_betrag": "string",
  "brutto_betrag": "string",
  "waehrung": "string",
  "zahlungsart": "string",
  "zahlungsmittel": "string",
  "belegnummer": "string",
  "rechnungsnummer": "string",
  "kundennummer": "string",
  "steuer_id": "string",
  "iban_maskiert": "string",
  "faelligkeitsdatum": "YYYY-MM-DD oder leer",
  "notizen": "string"
}}
Keine Erklaerung, kein Markdown, nur JSON.
WICHTIG:
- Wenn ein Feld nicht lesbar ist, gib leeren String.
- Zahlenwerte exakt aus dem Beleg, keine Schätzung.
- KATEGORIE MUSS nach gekauftem Produkt/Verwendungszweck erfolgen, NICHT nach Lieferantenname.
- Beispiele:
  - Airfryer/Küchengerät/Lebensmittelnahe Ausgaben => "Gastronomie"
  - Auto, Tanken, Parken, Maut, Fahrkarten, Mobilität => "Transport"
  - IT/Elektronik/Software/Lizenzen => "Software & Hardware"
- Rückgabe wie ein erfahrener Buchhalter: relevante Belegdaten vollständig extrahieren.
"""

    def _extract_json_content(raw: str):
        txt = (raw or "").strip()
        if txt.startswith("```"):
            parts = txt.split("```")
            if len(parts) > 1:
                txt = parts[1].replace("json", "", 1).strip()
        return txt

    # Fast path: send image directly and request final JSON in one call.
    # Each model attempt is individually wrapped so a parse/network error on one
    # model does not abort the remaining fallback candidates.
    for model_name in candidate_models:
        try:
            direct_payload = _vision_payload(direct_parse_prompt, encoded, model_name)
            direct_resp = requests.post(url, headers=headers, json=direct_payload, timeout=45)
            direct_json = direct_resp.json()
            if "error" in direct_json:
                err_msg = str(direct_json.get("error", ""))[:300]
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} api_error={err_msg}"
                continue
            if "choices" not in direct_json:
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} no_choices body={str(direct_json)[:450]}"
                continue
            direct_raw = _extract_json_content(direct_json["choices"][0]["message"]["content"])
            try:
                parsed_direct = _standard_response(json.loads(direct_raw))
            except json.JSONDecodeError as json_ex:
                _LAST_VISION_DEBUG = f"model={model_name} json_parse_error={repr(json_ex)} raw={direct_raw[:200]}"
                continue
            parsed_direct = _kategorie_nach_produktlogik(parsed_direct, "")
            if parsed_direct:
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} ok"
                return parsed_direct
        except Exception as ex:
            _LAST_VISION_DEBUG = f"model={model_name} exception={repr(ex)}"
            continue
    return {}


def klassifizieren(text: str, api_key: str = "", datei_pfad: str = "", api_provider: str = "openrouter", api_model: str = "") -> dict:
    """KI analysiert die Rechnung und weist Kategorie zu."""
    def _build_prompt(invoice_text: str) -> str:
        return f"""
Analysiere die folgende Rechnung und gib die folgenden Felder als JSON zuruck.

Felder:
- lieferant: Firmenname
- rechnung_typ: "eingang" oder "ausgang"
- rechnungsdatum: Rechnungsdatum im Format YYYY-MM-DD (wenn erkennbar)
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
- Rechnungsdatum NUR aus expliziten Datumsfeldern lesen (Datum/Rechnungsdatum/Belegdatum/Gedruckt am), niemals raten.
- Bei mehreren Datumsangaben (z.B. TSE Start/Ende/Signatur): nur das Kauf-/Belegdatum verwenden; technische Zeitstempel ignorieren.
- Datumsformat kann auch "13 Oktober 2023" / "13 October 2023" sein; korrekt zu YYYY-MM-DD normalisieren.
- Wenn kein eindeutiges Datum im Beleg sichtbar ist: rechnungsdatum leer lassen, nicht mit heutigem Datum fuellen.
- rechnung_typ aus Perspektive des Nutzers:
  - Lieferantenrechnung, Kassenbon, Zahlungsbeleg fuer Einkauf => "eingang" (Nutzer hat Kosten).
  - Eigene Rechnung des Nutzers an Kunden => "ausgang".
  - Wenn unklar, "eingang".

Gib NUR JSON zuruck. Keine Erklarungen.

Rechnungstext:
{invoice_text}
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
        local = nach_schluesselwort(text)
        if not local.get("rechnung_typ"):
            local["rechnung_typ"] = _typ_heuristik_aus_text(text)
        return _kategorie_nach_produktlogik(_normalize_with_text(local, text), text)

    # Image pipeline (hard rule): direct Vision only, no local OCR.
    is_image = datei_pfad.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")) if datei_pfad else False
    if is_image and datei_pfad:
        # Reliability fix: for image extraction force direct OpenAI path when an OpenAI key exists.
        vision_provider = provider
        vision_key = verwendeter_key
        vision_model = (api_model or "").strip()
        if API_KEY_OPENAI:
            vision_provider = "openai"
            vision_key = API_KEY_OPENAI
            if not vision_model or vision_model.startswith("openai/"):
                vision_model = "gpt-5.4-mini"
        vision_result = _vision_klassifizieren(datei_pfad, vision_key, vision_provider, vision_model)
        if vision_result:
            return vision_result
        return {}

    prompt = _build_prompt(text)

    if provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {verwendeter_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "gpt-5.4-nano",
            "messages": [
                {"role": "system", "content": SYSTEM_ROLE},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0,
        }
    else:
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {verwendeter_key}",
            "Content-Type": "application/json",
        }
        data = {
            "model": api_model or "openai/gpt-5.4-nano",
            "messages": [
                {"role": "system", "content": SYSTEM_ROLE},
                {"role": "user", "content": prompt}
            ],
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
        return _kategorie_nach_produktlogik(_normalize_with_text(ergebnis, text), text)
    except json.JSONDecodeError:
        return _normalize_with_text(nach_schluesselwort(text), text)


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

    rechnungsdatum = ""
    # Unterstützt: 15.05.2026, 15-05-2026, 2026-05-15, 2026/05/15, 15.05.26
    m_de = re.search(r"\b([0-3]?\d)[\./-]([01]?\d)[\./-]((?:20)?\d{2})\b", text or "")
    m_iso = re.search(r"\b(20\d{2})[\./-]([01]?\d)[\./-]([0-3]?\d)\b", text or "")
    if m_iso:
        y, mo, d = m_iso.groups()
        rechnungsdatum = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    elif m_de:
        d, mo, y = m_de.groups()
        if len(y) == 2:
            y = "20" + y
        rechnungsdatum = f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"

    return {
        "lieferant": lieferant,
        "rechnung_typ": _typ_heuristik_aus_text(text),
        "rechnungsdatum": rechnungsdatum,
        "kategorie": gefundene_kategorie,
        "netto_betrag": f"{netto:.2f}" if netto else "0",
        "mwst_satz": mwst_satz,
        "mwst_betrag": f"{mwst_betrag:.2f}" if mwst_betrag else "0",
        "brutto_betrag": f"{brutto:.2f}" if brutto else "0",
        "waehrung": waehrung,
    }
