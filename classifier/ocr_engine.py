import pdfplumber
import os
import json
import requests
import base64
import re
import tempfile
from io import BytesIO
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
_LAST_VISION_TRACE = {}


def _normalize_api_model(api_provider: str, api_model: str) -> str:
    provider = (api_provider or "openrouter").strip().lower()
    raw = (api_model or "").strip()
    if not raw:
        return "gpt-4o-mini" if provider == "openai" else "openai/gpt-4o-mini"
    return raw


def get_last_vision_debug() -> str:
    return str(_LAST_VISION_DEBUG or "")


def get_last_vision_trace() -> dict:
    trace = _LAST_VISION_TRACE
    return trace if isinstance(trace, dict) else {}


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
    # Build product signal text from OCR text + model fields EXCLUDING supplier/address.
    # This prevents merchant-name bias in category selection.
    signal_parts = [
        text or "",
        str(ergebnis.get("notizen", "") or ""),
        str(ergebnis.get("beschreibung", "") or ""),
        str(ergebnis.get("positionen", "") or ""),
        str(ergebnis.get("produkt", "") or ""),
        str(ergebnis.get("artikel", "") or ""),
    ]
    full_text = " ".join(signal_parts).lower()

    # Hard override by purchased product / usage intent (not supplier name).
    product_rules = [
        ("Transport", [r"\b(benzin|diesel|tank|tanken|ladestrom|ladevorgang|parken|parkhaus|autobahn|maut|bahn|db|uber|bolt|taxi|fahrkarte|kfz)\b"]),
        (
            "Gastronomie",
            [
                r"\b(airfryer|heissluftfritteuse|küche|kueche|küchengerät|kuechengeraet|kaffeemaschine|wasserkocher|toaster|mikrowelle|ofen)\b",
                r"\b(pfanne|topf|messer|koch|küchenhelfer|kuechenhelfer|spatel|schneidebrett|mix(er)?|blender)\b",
                r"\b(lebensmittel|getränk|getraenk|kaffee|cappuccino|sandwich|fruchtaufstrich|proteinpulver)\b",
            ],
        ),
        ("Software & Hardware", [r"\b(laptop|notebook|pc|monitor|ssd|hdd|router|headset|software|lizenz|abo|saas|app|drucker|tablet|smartphone|grafikkarte)\b"]),
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

    # If we still have no product signal, keep a conservative fallback.
    if not full_text.strip() and kategorie in ("", "Sonstige"):
        ergebnis["kategorie"] = "Sonstige"

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


def _pil_bicubic():
    if Image is None:
        return None
    if hasattr(Image, "Resampling"):
        return Image.Resampling.BICUBIC
    return Image.BICUBIC


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
            img = prepare_invoice_image(raw) if use_crop else raw.convert("RGB")
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
                img = prepare_invoice_image(raw) if use_crop else raw.convert("RGB")
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


def _order_document_points(points):
    pts = np.array(points, dtype="float32").reshape(4, 2)
    sums = pts.sum(axis=1)
    diffs = np.diff(pts, axis=1).reshape(4)
    ordered = np.zeros((4, 2), dtype="float32")
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return ordered


def _perspective_warp_document(src):
    if np is None or cv2 is None:
        return None

    arr = np.array(src.convert("RGB"), dtype=np.uint8)
    h, w = arr.shape[:2]
    if w < 80 or h < 80:
        return None

    max_side = 1600
    scale = min(1.0, max_side / float(max(w, h)))
    if scale < 1.0:
        work = cv2.resize(arr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        work = arr.copy()

    wh, ww = work.shape[:2]
    maxc = work.max(axis=2)
    minc = work.min(axis=2)
    spread = maxc - minc
    gray_raw = cv2.cvtColor(work, cv2.COLOR_RGB2GRAY)

    paper_mask = ((gray_raw > 185) & (spread < 60)).astype(np.uint8) * 255
    kernel = np.ones((9, 9), np.uint8)
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    paper_mask = cv2.morphologyEx(paper_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    contours, _ = cv2.findContours(paper_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    img_area = float(ww * wh)
    if contours:
        best_contour = None
        best_area = 0.0
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < img_area * 0.04:
                continue
            rect = cv2.minAreaRect(contour)
            (rw, rh) = rect[1]
            if rw <= 1 or rh <= 1:
                continue
            rect_area = rw * rh
            fill = area / max(rect_area, 1.0)
            aspect = max(rw, rh) / max(min(rw, rh), 1.0)
            if fill < 0.35 or aspect > 12:
                continue
            if area > best_area:
                best_area = area
                best_contour = contour

        if best_contour is not None:
            rect = cv2.minAreaRect(best_contour)
            box = cv2.boxPoints(rect)
            quad = _order_document_points(box) / max(scale, 1e-6)
            width_top = np.linalg.norm(quad[1] - quad[0])
            width_bottom = np.linalg.norm(quad[2] - quad[3])
            height_right = np.linalg.norm(quad[2] - quad[1])
            height_left = np.linalg.norm(quad[3] - quad[0])
            out_w = int(max(width_top, width_bottom))
            out_h = int(max(height_right, height_left))
            if out_w >= int(w * 0.12) and out_h >= int(h * 0.12):
                dst = np.array(
                    [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
                    dtype="float32",
                )
                matrix = cv2.getPerspectiveTransform(quad.astype("float32"), dst)
                warped = cv2.warpPerspective(arr, matrix, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                return Image.fromarray(warped)

    gray = cv2.GaussianBlur(gray_raw, (5, 5), 0)
    edges = cv2.Canny(gray, 45, 140)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best_quad = None
    best_score = -1.0
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < img_area * 0.08:
            continue
        peri = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.025 * peri, True)
        if len(approx) != 4 or not cv2.isContourConvex(approx):
            continue

        pts = _order_document_points(approx.reshape(4, 2))
        width_top = np.linalg.norm(pts[1] - pts[0])
        width_bottom = np.linalg.norm(pts[2] - pts[3])
        height_right = np.linalg.norm(pts[2] - pts[1])
        height_left = np.linalg.norm(pts[3] - pts[0])
        doc_w = max(width_top, width_bottom)
        doc_h = max(height_right, height_left)
        if doc_w < ww * 0.18 or doc_h < wh * 0.18:
            continue
        aspect = doc_h / max(doc_w, 1.0)
        if aspect < 0.55 or aspect > 8.5:
            continue

        rect_area = doc_w * doc_h
        fill = area / max(rect_area, 1.0)
        if fill < 0.45:
            continue
        center = pts.mean(axis=0)
        center_bonus = 1.0 - min(1.0, abs(center[0] - ww / 2.0) / max(ww / 2.0, 1.0))
        score = area * (0.75 + 0.25 * center_bonus) * min(1.15, fill)
        if score > best_score:
            best_score = score
            best_quad = pts

    if best_quad is None:
        return None

    quad = best_quad / max(scale, 1e-6)
    width_top = np.linalg.norm(quad[1] - quad[0])
    width_bottom = np.linalg.norm(quad[2] - quad[3])
    height_right = np.linalg.norm(quad[2] - quad[1])
    height_left = np.linalg.norm(quad[3] - quad[0])
    out_w = int(max(width_top, width_bottom))
    out_h = int(max(height_right, height_left))
    if out_w < int(w * 0.15) or out_h < int(h * 0.15):
        return None

    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype="float32")
    matrix = cv2.getPerspectiveTransform(quad.astype("float32"), dst)
    warped = cv2.warpPerspective(arr, matrix, (out_w, out_h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return Image.fromarray(warped)


def _enhance_invoice_image(img):
    if Image is None:
        return img
    out = img.convert("RGB")

    if np is not None and cv2 is not None:
        try:
            arr = np.array(out, dtype=np.uint8)
            # Stronger enhancement for difficult receipt photos.
            lab = cv2.cvtColor(arr, cv2.COLOR_RGB2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
            l2 = clahe.apply(l)
            merged = cv2.merge((l2, a, b))
            rgb = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
            rgb = cv2.bilateralFilter(rgb, 5, 22, 22)
            blur = cv2.GaussianBlur(rgb, (0, 0), 0.9)
            sharp = cv2.addWeighted(rgb, 1.18, blur, -0.18, 0)
            return Image.fromarray(sharp)
        except Exception:
            pass

    if ImageOps is not None:
        out = ImageOps.autocontrast(out, cutoff=0.2)
    if ImageEnhance is not None:
        out = ImageEnhance.Contrast(out).enhance(1.14)
        out = ImageEnhance.Sharpness(out).enhance(1.22)
    return out


def _trim_background_edges(img):
    if np is None or cv2 is None:
        return img
    try:
        arr = np.array(img.convert("RGB"), dtype=np.uint8)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape[:2]
        if w < 120 or h < 120:
            return img

        # Find printed content. This catches the real document area even on a light fabric background.
        dark = (gray < 115).astype(np.uint8) * 255
        dark = cv2.morphologyEx(dark, cv2.MORPH_CLOSE, np.ones((5, 17), np.uint8), iterations=1)
        n_labels, _, stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
        boxes = []
        for i in range(1, n_labels):
            x, y, bw, bh, area = stats[i]
            if area < max(12, int(w * h * 0.000015)):
                continue
            if x <= 2 or y <= 2 or x + bw >= w - 2 or y + bh >= h - 2:
                continue
            if bh > h * 0.28 and bw < w * 0.18:
                continue
            if bw > w * 0.45 and bh > h * 0.20:
                continue
            if bw > w * 0.95 and bh > h * 0.95:
                continue
            boxes.append((x, y, x + bw, y + bh, area))
        if not boxes:
            return img

        weighted_x = []
        weighted_y = []
        for bx0, by0, bx1, by1, area in boxes:
            weight = max(1, int(area // 50))
            weighted_x.extend([bx0, bx1] * weight)
            weighted_y.extend([by0, by1] * weight)

        if len(weighted_x) < 8 or len(weighted_y) < 8:
            return img

        x0 = int(np.percentile(weighted_x, 5))
        x1 = int(np.percentile(weighted_x, 95))
        y0 = int(np.percentile(weighted_y, 2))
        y1 = int(np.percentile(weighted_y, 98))

        content_w = x1 - x0
        content_h = y1 - y0
        if content_w < w * 0.08 or content_h < h * 0.10:
            return img

        # Add generous margins so paper edges/blank document areas remain, but wide background is removed.
        pad_x = max(18, int(content_w * 0.08))
        pad_y = max(24, int(content_h * 0.08))
        x0 = max(0, x0 - pad_x)
        x1 = min(w, x1 + pad_x)
        y0 = max(0, y0 - pad_y)
        y1 = min(h, y1 + pad_y)

        cropped_w = x1 - x0
        cropped_h = y1 - y0
        if cropped_w < w * 0.35 or cropped_h < h * 0.35:
            return img

        # Only trim when it actually removes a meaningful background band.
        if cropped_w <= w * 0.92 or cropped_h <= h * 0.92:
            return img.crop((x0, y0, x1, y1))
        return img
    except Exception:
        return img


def _detect_tesseract_rotation_degrees(img) -> tuple[int | None, float]:
    if pytesseract is None:
        return None, 0.0
    try:
        osd = pytesseract.image_to_osd(img.convert("RGB"), config="--psm 0")
    except Exception:
        return None, 0.0
    try:
        match = re.search(r"Rotate:\s*(\d+)", osd or "", re.IGNORECASE)
        if not match:
            return None, 0.0
        degrees = int(match.group(1)) % 360
        conf_match = re.search(r"Orientation confidence:\s*([0-9]+(?:\.[0-9]+)?)", osd or "", re.IGNORECASE)
        confidence = float(conf_match.group(1)) if conf_match else 0.0
        if degrees not in (0, 90, 180, 270):
            return None, confidence
        return degrees, confidence
    except Exception:
        return None, 0.0


def _text_projection_score_for_rotation(img, degrees: int) -> float:
    if np is None or cv2 is None:
        return 0.0
    try:
        candidate = img.rotate(degrees, expand=True)
        arr = np.array(candidate.convert("RGB"), dtype=np.uint8)
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
        h, w = gray.shape[:2]
        if w < 80 or h < 80:
            return 0.0
        dark = (gray < 150).astype(np.uint8)
        dark_ratio = float(dark.mean())
        if dark_ratio < 0.002:
            return 0.0

        row_counts = dark.sum(axis=1).astype(np.float32)
        col_counts = dark.sum(axis=0).astype(np.float32)
        row_signal = float(np.percentile(row_counts, 95) - np.percentile(row_counts, 45)) / max(w, 1)
        col_signal = float(np.percentile(col_counts, 95) - np.percentile(col_counts, 45)) / max(h, 1)
        portrait_bonus = 0.22 if h >= w else -0.10
        top_dark = float(dark[: max(1, h // 5), :].mean())
        bottom_dark = float(dark[-max(1, h // 5) :, :].mean())
        header_bonus = 0.05 if top_dark >= bottom_dark * 0.65 else -0.04
        return row_signal - col_signal + portrait_bonus + header_bonus
    except Exception:
        return 0.0


def _ocr_readability_score_for_rotation(img, degrees: int) -> float:
    if pytesseract is None:
        return 0.0
    try:
        candidate = img.rotate(degrees, expand=True).convert("RGB")
        w, h = candidate.size
        max_side = 1200
        if max(w, h) > max_side:
            scale = max_side / float(max(w, h))
            resample = _pil_lanczos()
            if resample is not None:
                candidate = candidate.resize((max(1, int(w * scale)), max(1, int(h * scale))), resample=resample)

        data = pytesseract.image_to_data(
            candidate,
            lang="deu+eng",
            config="--oem 3 --psm 6",
            output_type=pytesseract.Output.DICT,
            timeout=6,
        )
        words = []
        confidences = []
        for text, conf in zip(data.get("text", []), data.get("conf", [])):
            token = str(text or "").strip()
            if len(token) < 2:
                continue
            try:
                c = float(conf)
            except Exception:
                c = -1.0
            if c < 0:
                continue
            words.append(token)
            confidences.append(c)
        if not words:
            return 0.0

        joined = " ".join(words).lower()
        alpha_words = sum(1 for token in words if re.search(r"[a-zA-ZÄÖÜäöüß]{3,}", token))
        number_words = sum(1 for token in words if re.search(r"\d", token))
        keyword_hits = sum(
            1
            for kw in (
                "rechnung",
                "reserved",
                "summe",
                "total",
                "betrag",
                "mwst",
                "ust",
                "kasse",
                "beleg",
                "datum",
                "steuer",
                "karte",
                "eur",
            )
            if kw in joined
        )
        avg_conf = sum(confidences) / max(len(confidences), 1)
        density = min(len(words), 80) / 80.0
        return (avg_conf / 100.0) + (alpha_words * 0.025) + (number_words * 0.01) + (keyword_hits * 0.12) + density * 0.2
    except Exception:
        return 0.0


def _choose_rotation_by_ocr(img, degrees_candidates):
    scores = [(degrees, _ocr_readability_score_for_rotation(img, degrees)) for degrees in degrees_candidates]
    scores.sort(key=lambda item: item[1], reverse=True)
    if not scores or scores[0][1] <= 0.20:
        return None
    second = scores[1][1] if len(scores) > 1 else 0.0
    if scores[0][1] >= second + 0.10:
        return scores[0][0], scores[0][1]
    return None


def _refine_upside_down_portrait(img):
    """If a portrait candidate is upside-down, flip it by 180 using OCR readability."""
    try:
        w, h = img.size
        if h < w:
            return img, "no_refine_landscape"
        s0 = _ocr_readability_score_for_rotation(img, 0)
        s180 = _ocr_readability_score_for_rotation(img, 180)
        if s180 > s0 + 0.06:
            return img.rotate(180, expand=True), f"portrait_refine_180_{s0:.2f}_{s180:.2f}"
        return img, f"portrait_refine_keep_{s0:.2f}_{s180:.2f}"
    except Exception:
        return img, "portrait_refine_failed"


def _orient_invoice_upright(img):
    """Rotate cropped documents so printed text is horizontal and the receipt top is at 12 o'clock."""
    try:
        out = img.convert("RGB")
        w, h = out.size
        osd_degrees, osd_conf = _detect_tesseract_rotation_degrees(out)
        # OCR is used only for orientation (OSD), never for extracted text forwarding.
        # Apply rotation only when confidence is sufficiently high.
        min_conf = 8.0
        if osd_degrees in (90, 180, 270) and osd_conf >= min_conf:
            rotated = out.rotate(360 - osd_degrees, expand=True)
            refined, reason = _refine_upside_down_portrait(rotated)
            return refined, f"tesseract_osd_{osd_degrees}_c{osd_conf:.1f}|{reason}"
        if osd_degrees in (90, 180, 270):
            # Keep note and continue with a conservative landscape fallback below.
            pass

        # Conservative fallback for very wide receipts:
        # choose between 90/270 only when readability gain is clear.
        if w > h * 1.35:
            ocr_choice = _choose_rotation_by_ocr(out, (90, 270))
            if ocr_choice is not None:
                best_degrees, best_score = ocr_choice
                rotated = out.rotate(best_degrees, expand=True)
                refined, reason = _refine_upside_down_portrait(rotated)
                return refined, f"ocr_landscape_{best_degrees}_s{best_score:.2f}|{reason}"
            c90 = _text_projection_score_for_rotation(out, 90)
            c270 = _text_projection_score_for_rotation(out, 270)
            if abs(c90 - c270) >= 0.08:
                best_degrees = 90 if c90 > c270 else 270
                rotated = out.rotate(best_degrees, expand=True)
                refined, reason = _refine_upside_down_portrait(rotated)
                return refined, f"proj_landscape_{best_degrees}_{c90:.2f}_{c270:.2f}|{reason}"

        if osd_degrees in (90, 180, 270):
            return out, f"tesseract_osd_lowconf_{osd_degrees}_c{osd_conf:.1f}"
        refined, reason = _refine_upside_down_portrait(out)
        return refined, f"keep_original|{reason}"
    except Exception:
        return img, "orientation_failed"


def prepare_invoice_image(img, orientation_locked: bool = False):
    """Return a cropped, deskewed, contrast-enhanced invoice image for OCR/vision."""
    if Image is None:
        return img
    try:
        src = ImageOps.exif_transpose(img) if ImageOps is not None else img
        src = src.convert("RGB")

        # Baseline orientation:
        # - normal flow: auto-orient
        # - editor-locked flow: keep user's manual orientation
        if orientation_locked:
            base_oriented = src
        else:
            base_oriented, _ = _orient_invoice_upright(src)
        base_score = _ocr_readability_score_for_rotation(base_oriented, 0)
        out = _enhance_invoice_image(base_oriented)

        # Optional crop/warp candidates must clearly beat baseline.
        warped = _perspective_warp_document(src)
        cropped = _crop_rechnung_region(src)
        best_score = base_score
        best_img = out
        for cand in (warped, cropped):
            if cand is None:
                continue
            candidate = _enhance_invoice_image(cand)
            candidate = _trim_background_edges(candidate)
            if orientation_locked:
                candidate_oriented = candidate
            else:
                candidate_oriented, _ = _orient_invoice_upright(candidate)
            score = _ocr_readability_score_for_rotation(candidate_oriented, 0)
            # Accept only if meaningfully better to avoid floor/background false positives.
            if score >= max(0.18, best_score + 0.12):
                best_score = score
                best_img = candidate_oriented

        out = best_img

        w, h = out.size
        max_side = 2600
        if max(w, h) > max_side:
            scale = max_side / float(max(w, h))
            resample = _pil_lanczos()
            if resample is not None:
                out = out.resize((max(1, int(w * scale)), max(1, int(h * scale))), resample=resample)
        return out
    except Exception:
        return img


def prepare_invoice_image_file_inplace(datei_pfad: str, orientation_locked: bool = False) -> dict:
    """
    Kırpma/düzeltmeyi upload edilen resme uygular.
    Güvenli değilse dosyayı değiştirmez; sonuç debug için kısa meta döndürür.
    """
    result = {"applied": False, "reason": "", "original_size": None, "processed_size": None}
    if Image is None or not os.path.isfile(datei_pfad):
        result["reason"] = "image_library_or_file_missing"
        return result
    try:
        ext = os.path.splitext(datei_pfad)[1].lower()
        if ext in (".heic", ".heif"):
            result["reason"] = "heic_left_original_runtime_preprocess"
            return result
        with Image.open(datei_pfad) as raw:
            original = ImageOps.exif_transpose(raw) if ImageOps is not None else raw
            original = original.convert("RGB")
            ow, oh = original.size
            result["original_size"] = [ow, oh]
            processed = prepare_invoice_image(original, orientation_locked=orientation_locked)
            pw, ph = processed.size
            result["processed_size"] = [pw, ph]

            if pw < max(120, int(ow * 0.12)) or ph < max(120, int(oh * 0.12)):
                result["reason"] = "processed_image_too_small"
                return result

            out = BytesIO()
            if ext == ".png":
                processed.save(out, format="PNG", optimize=True)
            elif ext == ".webp":
                processed.save(out, format="WEBP", quality=95, method=6)
            else:
                processed.save(out, format="JPEG", quality=95, optimize=True)

        with open(datei_pfad, "wb") as f:
            f.write(out.getvalue())
        result["applied"] = True
        result["reason"] = "ok_editor_locked" if orientation_locked else "ok"
        return result
    except Exception as ex:
        result["reason"] = f"exception:{type(ex).__name__}"
        return result


def _normalize_rate_string(raw) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s = s.replace("%", "").replace(" ", "").replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", s)
    if not match:
        return ""
    try:
        value = float(match.group(0))
    except Exception:
        return ""
    if abs(value - round(value)) < 1e-9:
        return str(int(round(value)))
    return str(round(value, 2)).replace(".", ",")


def _standard_response(ergebnis: dict) -> dict:
    typ = str(ergebnis.get("rechnung_typ", "eingang") or "eingang").strip().lower()
    if typ not in ("eingang", "ausgang"):
        typ = "eingang"
    mwst_satz = _normalize_rate_string(ergebnis.get("mwst_satz", ""))
    mwst_satz_1 = _normalize_rate_string(ergebnis.get("mwst_satz_1", ergebnis.get("mwst_satz", "")))
    mwst_satz_2 = _normalize_rate_string(ergebnis.get("mwst_satz_2", ""))
    return {
        "lieferant": ergebnis.get("lieferant", "Unbekannt"),
        "adresse": ergebnis.get("adresse", ergebnis.get("anschrift", "")),
        "rechnung_typ": typ,
        "rechnungsdatum": ergebnis.get("rechnungsdatum", ""),
        "uhrzeit": ergebnis.get("uhrzeit", ""),
        "kategorie": ergebnis.get("kategorie", "Sonstige"),
        "netto_betrag": ergebnis.get("netto_betrag", "0"),
        "mwst_satz": mwst_satz,
        "mwst_betrag": ergebnis.get("mwst_betrag", "0"),
        "brutto_betrag": ergebnis.get("brutto_betrag", "0"),
        "gesamt_betrag": ergebnis.get("gesamt_betrag", ergebnis.get("brutto_betrag", "0")),
        "waehrung": ergebnis.get("waehrung", "EUR"),
        "zahlungsart": ergebnis.get("zahlungsart", ""),
        "zahlungsmittel": ergebnis.get("zahlungsmittel", ""),
        "karten_nr": ergebnis.get("karten_nr", ergebnis.get("kartennr", "")),
        "t_id": ergebnis.get("t_id", ergebnis.get("tid", "")),
        "beleg_nr": ergebnis.get("beleg_nr", ergebnis.get("belegnummer", "")),
        "vu_nummer": ergebnis.get("vu_nummer", ergebnis.get("vu_nummer", "")),
        "ust_id_nr": ergebnis.get("ust_id_nr", ergebnis.get("steuer_id", "")),
        "belegnummer": ergebnis.get("belegnummer", ""),
        "rechnungsnummer": ergebnis.get("rechnungsnummer", ""),
        "kundennummer": ergebnis.get("kundennummer", ""),
        "steuer_id": ergebnis.get("steuer_id", ""),
        "iban_maskiert": ergebnis.get("iban_maskiert", ""),
        "faelligkeitsdatum": ergebnis.get("faelligkeitsdatum", ""),
        "notizen": ergebnis.get("notizen", ""),
        "mwst_satz_1": mwst_satz_1,
        "mwst_betrag_1": ergebnis.get("mwst_betrag_1", ergebnis.get("mwst_betrag", "")),
        "netto_betrag_1": ergebnis.get("netto_betrag_1", ergebnis.get("netto_betrag", "")),
        "mwst_satz_2": mwst_satz_2,
        "mwst_betrag_2": ergebnis.get("mwst_betrag_2", ""),
        "netto_betrag_2": ergebnis.get("netto_betrag_2", ""),
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


def _sanitize_noisy_id_fields(ergebnis: dict) -> dict:
    out = dict(ergebnis)
    fields = [
        "beleg_nr", "belegnummer", "rechnungsnummer", "kundennummer",
        "steuer_id", "iban_maskiert", "ust_id_nr", "vu_nummer"
    ]
    for key in fields:
        raw = str(out.get(key, "") or "").strip()
        if not raw:
            out[key] = ""
            continue
        lowered = raw.lower()
        if lowered in ("n/a", "na", "unknown", "unbekannt"):
            out[key] = ""
            continue
        if len(raw) > 40 or raw.count("#") >= 3:
            out[key] = ""
    return out


def _to_de_money(raw) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    s = s.replace(" ", "").replace(".", "").replace(",", ".")
    try:
        n = float(s)
    except Exception:
        return ""
    return f"{n:.2f}".replace(".", ",")


def _to_de_rate(raw) -> str:
    return _normalize_rate_string(raw)


def _to_float_de(raw) -> float:
    s = str(raw or "").strip().replace("%", "").strip()
    if not s:
        return 0.0
    if "." in s and "," in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except Exception:
        return 0.0


def _tax_buckets_plausible(buckets: dict, gross_raw) -> bool:
    gross = _to_float_de(gross_raw)
    if gross <= 0:
        return False

    n1 = _to_float_de(buckets.get("netto_betrag_1"))
    m1 = _to_float_de(buckets.get("mwst_betrag_1"))
    r1 = _to_float_de(buckets.get("mwst_satz_1"))
    n2 = _to_float_de(buckets.get("netto_betrag_2"))
    m2 = _to_float_de(buckets.get("mwst_betrag_2"))
    r2 = _to_float_de(buckets.get("mwst_satz_2"))

    has2 = n2 > 0 and m2 > 0 and r2 > 0
    if has2:
        total = n1 + m1 + n2 + m2
        if abs(total - gross) > 15.0:
            return False
        if r1 > 0 and abs((n1 * (r1 / 100.0)) - m1) > 0.25:
            return False
        if r2 > 0 and abs((n2 * (r2 / 100.0)) - m2) > 0.25:
            return False
        return True

    # single bucket mode
    if n1 <= 0 or m1 < 0 or r1 <= 0:
        return False
    if abs((n1 + m1) - gross) > 15.0:
        return False
    if abs((n1 * (r1 / 100.0)) - m1) > 0.25:
        return False
    return True


def _repair_tax_bucket_amount_order(buckets: dict) -> dict:
    out = dict(buckets)
    for suffix in ("1", "2"):
        rate = _to_float_de(out.get(f"mwst_satz_{suffix}"))
        net = _to_float_de(out.get(f"netto_betrag_{suffix}"))
        vat = _to_float_de(out.get(f"mwst_betrag_{suffix}"))
        if rate <= 0 or net <= 0 or vat <= 0:
            continue

        current_delta = abs((net * (rate / 100.0)) - vat)
        swapped_delta = abs((vat * (rate / 100.0)) - net)
        if swapped_delta + 0.05 < current_delta:
            out[f"netto_betrag_{suffix}"], out[f"mwst_betrag_{suffix}"] = (
                out.get(f"mwst_betrag_{suffix}", ""),
                out.get(f"netto_betrag_{suffix}", ""),
            )
    return out


def _merge_tax_buckets(base: dict, buckets: dict) -> dict:
    out = dict(base)
    buckets = _repair_tax_bucket_amount_order(buckets)
    if not _tax_buckets_plausible(buckets, base.get("brutto_betrag", "")):
        return out

    m1 = _to_de_money(buckets.get("mwst_betrag_1"))
    r1 = _to_de_rate(buckets.get("mwst_satz_1"))
    n1 = _to_de_money(buckets.get("netto_betrag_1"))
    m2 = _to_de_money(buckets.get("mwst_betrag_2"))
    r2 = _to_de_rate(buckets.get("mwst_satz_2"))
    n2 = _to_de_money(buckets.get("netto_betrag_2"))

    out["mwst_betrag_1"] = m1
    out["mwst_satz_1"] = r1
    out["netto_betrag_1"] = n1
    # If second bucket is incomplete or duplicated, force it empty.
    has_any_2 = bool(m2 or r2 or n2)
    has_all_2 = bool(m2 and r2 and n2)
    duplicated_2 = bool(has_all_2 and r1 == r2 and m1 == m2 and n1 == n2)
    if (not has_all_2 and has_any_2) or duplicated_2:
        m2 = ""
        r2 = ""
        n2 = ""

    out["mwst_betrag_2"] = m2
    out["mwst_satz_2"] = r2
    out["netto_betrag_2"] = n2

    # Keep primary legacy fields aligned with bucket-1.
    if m1:
        out["mwst_betrag"] = m1
    if r1:
        out["mwst_satz"] = r1
    if n1:
        out["netto_betrag"] = n1
    return out


def _vision_klassifizieren(datei_pfad: str, api_key: str, api_provider: str = "openrouter", api_model: str = "") -> dict:
    global _LAST_VISION_DEBUG, _LAST_VISION_TRACE
    _LAST_VISION_DEBUG = ""
    _LAST_VISION_TRACE = {}
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

    # Focus and straighten receipt/invoice region before sending to vision model.
    encoded = base64.b64encode(raw_bytes).decode("ascii")
    encoded_chunks = [encoded]
    if Image is not None:
        try:
            with Image.open(BytesIO(raw_bytes)) as img:
                cropped = prepare_invoice_image(img)
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
- Lieferantenname darf die Kategorie NICHT beeinflussen (z.B. MediaMarkt kann je nach gekauftem Produkt auch "Gastronomie" sein).
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

    selected_model = _normalize_api_model(api_provider, api_model)
    is_4o = any(x in selected_model.lower() for x in ["gpt-4o", "gpt-4-o"])
    
    candidate_models = []
    if selected_model:
        if "5.4" in selected_model or "gpt-5" in selected_model:
            pass
        else:
            candidate_models.append(selected_model)

    if api_provider == "openai":
        for fb in ["gpt-4o-mini", "gpt-4o"]:
            if fb not in candidate_models:
                candidate_models.append(fb)
    else:
        for fb in ["openai/gpt-4o-mini", "openai/gpt-4o"]:
            if fb not in candidate_models:
                candidate_models.append(fb)
        
    vision_model = candidate_models[0]

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
            "max_tokens": 2000,
            "response_format": {"type": "json_object"},
        }

    def _vision_tax_payload(prompt_text: str, image_b64: str, model_name: str):
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
            "max_tokens": 400,
            "response_format": {"type": "json_object"},
        }

    def _payload_debug_summary(payload: dict) -> dict:
        try:
            msgs = payload.get("messages", [])
            roles = [m.get("role", "") for m in msgs if isinstance(m, dict)]
            image_detail = ""
            for m in msgs:
                if not isinstance(m, dict):
                    continue
                content = m.get("content")
                if isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "image_url":
                            image_detail = str(((part.get("image_url") or {}) if isinstance(part.get("image_url"), dict) else {}).get("detail", ""))
                            break
            return {
                "model": payload.get("model", ""),
                "temperature": payload.get("temperature", 0),
                "max_tokens": payload.get("max_tokens", 0),
                "response_format": payload.get("response_format", {}),
                "roles": roles,
                "system_role": SYSTEM_ROLE,
                "image_detail": image_detail,
            }
        except Exception:
            return {}

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
Analysiere dieses Belegbild DIREKT und gib NUR JSON im folgenden Schema zurueck:
{{
  "lieferant": "string",
  "adresse": "string",
  "rechnung_typ": "eingang|ausgang",
  "rechnungsdatum": "YYYY-MM-DD oder leer",
  "uhrzeit": "HH:MM oder leer",
  "kategorie": "eine aus {list(STANDARDS_KATEGORIEN.keys())}",
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
Keine Erklaerung, kein Markdown, nur JSON.
WICHTIG:
- KEINE HALLUZINATION: Nur Werte zurückgeben, die im Bild klar lesbar sind.
- Wenn du nicht sicher bist oder ein Wert nicht eindeutig lesbar ist: leerer String.
- Nichts raten, nichts ergänzen, nichts aus Kontext ableiten.
- Wenn ein Feld nicht lesbar ist, gib leeren String.
- Zahlenwerte exakt aus dem Beleg, keine Schätzung.
- KEINE Fantasie-/Platzhalterwerte wie "N/A", "unknown", "###", "H#H#...". In solchen Fällen: leerer String.
- `beleg_nr`, `belegnummer`, `rechnungsnummer`, `kundennummer`, `steuer_id`, `iban_maskiert`, `ust_id_nr`, `vu_nummer`:
  - nur kurze, echte Werte übernehmen;
  - wenn der Wert unklar, verrauscht oder sehr lang ist (z.B. > 40 Zeichen), leerer String zurückgeben.
- Wenn mehrere Steuerzeilen vorhanden sind:
  - Zeile mit 19% (oder dem höheren Satz) in *_1.
  - Zeile mit 7% (oder dem niedrigeren Satz) in *_2.
- WICHTIG (Netto vs. MwSt Spalten):
  - Der Netto-Betrag ist IMMER wesentlich größer als der MwSt-Betrag (ca. 5-mal so groß bei 19% und ca. 14-mal so groß bei 7%).
  - Wenn du z.B. die Zahlen "100,82" und "19,16" für 19% siehst, dann ist "100,82" der Netto-Betrag (netto_betrag_1) und "19,16" der MwSt-Betrag (mwst_betrag_1).
  - Wenn du z.B. die Zahlen "12,87" und "0,90" für 7% siehst, dann ist "12,87" der Netto-Betrag (netto_betrag_2) und "0,90" der MwSt-Betrag (mwst_betrag_2).
  - Vertausche Netto und MwSt NIEMALS!
- KATEGORIE MUSS nach gekauftem Produkt/Verwendungszweck erfolgen, NICHT nach Lieferantenname.
- Lieferantenname/Haendler/Marke darf die Kategorie NICHT steuern.
- Beispiele:
  - Airfryer/Küchengerät/Lebensmittelnahe Ausgaben => "Gastronomie"
  - Lebensmittel, Getränke, Kaffee, Cappuccino, Sandwich, Fruchtaufstrich, Proteinpulver => "Gastronomie"
  - Auto, Tanken, Parken, Maut, Fahrkarten, Mobilität => "Transport"
  - IT/Elektronik/Software/Lizenzen => "Software & Hardware"
- Rückgabe wie ein erfahrener Buchhalter: relevante Belegdaten vollständig extrahieren.
"""

    tax_only_prompt = """
Lies NUR die MwSt-Aufteilung im Summenbereich des Belegs.
Nutze ausschließlich Zeilen, die Steuern ausweisen (z.B. "19%" / "7%" oder "A" / "B").

Gib NUR dieses JSON zurück:
{
  "mwst_betrag_1": "string",
  "mwst_satz_1": "string",
  "netto_betrag_1": "string",
  "mwst_betrag_2": "string",
  "mwst_satz_2": "string",
  "netto_betrag_2": "string"
}

Regeln:
- KEINE HALLUZINATION: Nur Zahlen zurückgeben, die exakt im Bild sichtbar sind.
- Wenn ein Wert nicht eindeutig lesbar ist: leerer String.
- Wenn 2 Steuerzeilen vorhanden sind: _1 ist die 19%-Zeile (oder der höhere Satz), _2 ist die 7%-Zeile (oder der niedrigere Satz).
- WICHTIG (Spaltenerkennung Netto vs. MwSt):
  - Der Netto-Betrag ist mathematisch immer wesentlich GRÖSSER als der MwSt-Betrag.
  - Bei 19%: Netto ist ca. 5x größer als MwSt (z.B. Netto 100,82 und MwSt 19,16. Also netto_betrag_1="100,82" und mwst_betrag_1="19,16").
  - Bei 7%: Netto is ca. 14x größer als MwSt (z.B. Netto 12,87 und MwSt 0,90. Also netto_betrag_2="12,87" und mwst_betrag_2="0,90").
  - Vertausche Netto-Betrag und MwSt-Betrag NIEMALS!
- Zahlen exakt vom Beleg übernehmen, Format mit Komma (z.B. 19,16).
- Wenn ein Feld wirklich nicht lesbar ist, leerer String.
- Keine weiteren Keys, keine Erklärungen.
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
            _LAST_VISION_TRACE = {
                "provider": api_provider,
                "model": model_name,
                "status_code": direct_resp.status_code,
                "response_json": direct_json,
                "request_main": _payload_debug_summary(direct_payload),
            }
            if "error" in direct_json:
                err_msg = str(direct_json.get("error", ""))[:300]
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} api_error={err_msg}"
                _LAST_VISION_TRACE["error"] = err_msg
                continue
            if "choices" not in direct_json:
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} no_choices body={str(direct_json)[:450]}"
                _LAST_VISION_TRACE["error"] = "no_choices"
                continue
            direct_raw = _extract_json_content(direct_json["choices"][0]["message"]["content"])
            _LAST_VISION_TRACE["raw_message_content"] = direct_json["choices"][0]["message"]["content"]
            _LAST_VISION_TRACE["raw_json_text"] = direct_raw
            try:
                parsed_raw = json.loads(direct_raw)
                _LAST_VISION_TRACE["parsed_raw_json"] = parsed_raw
                parsed_direct = _standard_response(parsed_raw)
                parsed_direct = _sanitize_noisy_id_fields(parsed_direct)
                _LAST_VISION_TRACE["parsed_standardized_json"] = parsed_direct
            except json.JSONDecodeError as json_ex:
                _LAST_VISION_DEBUG = f"model={model_name} json_parse_error={repr(json_ex)} raw={direct_raw[:200]}"
                _LAST_VISION_TRACE["error"] = f"json_parse_error: {repr(json_ex)}"
                continue
            parsed_direct = _kategorie_nach_produktlogik(parsed_direct, "")
            # Hard requirement: extract VAT buckets in a dedicated, minimal pass.
            tax_payload = _vision_tax_payload(tax_only_prompt, encoded, model_name)
            _LAST_VISION_TRACE["request_tax"] = _payload_debug_summary(tax_payload)
            tax_resp = requests.post(url, headers=headers, json=tax_payload, timeout=35)
            tax_json = tax_resp.json()
            if "choices" in tax_json:
                tax_raw = _extract_json_content(tax_json["choices"][0]["message"]["content"])
                try:
                    tax_parsed = json.loads(tax_raw)
                    parsed_direct = _merge_tax_buckets(parsed_direct, tax_parsed)
                    _LAST_VISION_TRACE["tax_raw_json_text"] = tax_raw
                    _LAST_VISION_TRACE["tax_parsed_json"] = tax_parsed
                except Exception:
                    _LAST_VISION_TRACE["tax_raw_json_text"] = tax_raw
            _LAST_VISION_TRACE["parsed_final_json"] = parsed_direct
            if parsed_direct:
                _LAST_VISION_DEBUG = f"model={model_name} status={direct_resp.status_code} ok"
                return parsed_direct
        except Exception as ex:
            _LAST_VISION_DEBUG = f"model={model_name} exception={repr(ex)}"
            _LAST_VISION_TRACE = {
                "provider": api_provider,
                "model": model_name,
                "error": f"exception: {repr(ex)}",
            }
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
- Lieferantenname darf die Kategorie NICHT beeinflussen (z.B. MediaMarkt + Airfryer => "Gastronomie").
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
        vision_model = _normalize_api_model(vision_provider, api_model)
        if API_KEY_OPENAI:
            vision_provider = "openai"
            vision_key = API_KEY_OPENAI
            vision_model = _normalize_api_model(vision_provider, vision_model)
            if vision_model.startswith("openai/"):
                vision_model = vision_model.removeprefix("openai/")
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
            "model": _normalize_api_model(provider, api_model) if api_model else "gpt-4o-mini",
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
            "model": _normalize_api_model(provider, api_model) if api_model else "openai/gpt-4o-mini",
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
