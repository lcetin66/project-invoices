import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/constants";
import { classifyWithPython } from "@/lib/python-api";
import { getAiSettings, insertInvoice, listCategories, listInvoices } from "@/lib/repository";
import { ensureUploadDir, sanitizeFilename } from "@/lib/utils";

export const runtime = "nodejs";

function plausibleInvoiceDate(input: string | null): string | null {
  if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return null;
  }
  const parsed = new Date(`${input}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const min = new Date(today);
  min.setFullYear(min.getFullYear() - 10);
  const max = new Date(today);
  max.setDate(max.getDate() + 30);

  if (parsed < min || parsed > max) {
    return null;
  }

  return input;
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseLocaleNumber(value: unknown): number | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let cleaned = raw
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.\-\s]/g, "")
    .replace(/\s+/g, "");
  if (!cleaned) return null;

  if (cleaned.includes(",") && cleaned.includes(".")) {
    if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
      cleaned = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      cleaned = cleaned.replace(/,/g, "");
    }
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(",", ".");
  }

  const parsed = Number(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const url = new URL(request.url);

    const typRaw = url.searchParams.get("typ");
    const typ = typRaw === "ausgang" ? "ausgang" : typRaw === "eingang" ? "eingang" : undefined;
    const category = url.searchParams.get("category")?.trim() || undefined;

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const invoices = await listInvoices({
      typ,
      category,
      limit: Number.isFinite(limit) && (limit ?? 0) > 0 ? limit : undefined
    });

    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "Rechnungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);

    const form = await request.formData();
    const fileEntry = form.get("file") ?? form.get("rechnung_datei");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, message: "Keine Datei gefunden." }, { status: 400 });
    }

    const file = fileEntry;
    const extension = path.extname(file.name).toLowerCase().replace(".", "");
    const typeAllowed = ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
    const extAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!typeAllowed && !extAllowed) {
      return NextResponse.json({ ok: false, message: "Nur PDF- und Bilddateien sind erlaubt." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ ok: false, message: "Datei ist zu groß (max. 10 MB)." }, { status: 400 });
    }

    const ai = await getAiSettings();
    const classifier = await classifyWithPython(file, ai);
    const result = classifier.ergebnis;

    const supplier = safeString(result.lieferant ?? result.vendor);
    const grossAmount = parseLocaleNumber(result.brutto_betrag ?? result.total) ?? 0;
    let netAmount = parseLocaleNumber(result.netto_betrag);
    let vatAmount = parseLocaleNumber(result.mwst_betrag);
    let vatRate = parseLocaleNumber(result.mwst_satz);
    const currency = safeString(result.waehrung) || "EUR";

    // If vision found gross but omitted tax/net fields, derive sensible defaults for edit form.
    if (grossAmount > 0 && (netAmount == null || vatAmount == null)) {
      if (vatRate == null && currency === "EUR") {
        vatRate = 19;
      }
      if (vatRate != null && vatRate > 0) {
        const calculatedNet = Number((grossAmount / (1 + vatRate / 100)).toFixed(2));
        const calculatedVat = Number((grossAmount - calculatedNet).toFixed(2));
        if (netAmount == null) netAmount = calculatedNet;
        if (vatAmount == null) vatAmount = calculatedVat;
      }
    }
    const imageExtensions = new Set(["jpg", "jpeg", "png", "gif", "tif", "tiff", "webp", "heic", "heif"]);
    const isImage = file.type.toLowerCase().startsWith("image/") || imageExtensions.has(extension);
    const looksLikePlaceholderSupplier = /\b(beispiel|muster|dummy|testfirma)\b/i.test(supplier);
    const looksLikeKnownFakeTuple =
      Math.abs(grossAmount - 119) < 0.001 &&
      Math.abs((netAmount ?? 0) - 100) < 0.001 &&
      (Math.abs((vatAmount ?? 0) - 19) < 0.001 || Math.abs((vatRate ?? 0) - 19) < 0.001);

    if (isImage && (looksLikePlaceholderSupplier || looksLikeKnownFakeTuple)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Bildrechnung wurde unsicher erkannt (Platzhalterwerte). Bitte erneut hochladen oder API-Einstellungen prüfen."
        },
        { status: 422 }
      );
    }

    const weakExtraction = (supplier === "" || supplier.toLowerCase() === "unbekannt") && grossAmount <= 0;

    const selectedType = String(form.get("rechnung_typ") ?? "auto");
    const finalInvoiceType = selectedType === "ausgang" ? "ausgang" : "eingang";

    const manualInvoiceDate = plausibleInvoiceDate(String(form.get("rechnungsdatum") ?? "") || null);
    const aiInvoiceDate = plausibleInvoiceDate(safeString(result.rechnungsdatum) || null);
    const invoiceDate = manualInvoiceDate ?? aiInvoiceDate;
    const detectedCategoryName = safeString(result.kategorie) || "Sonstige";

    const categories = await listCategories(true);
    const normalizedDetectedCategory = detectedCategoryName.toLowerCase();
    let matchedCategory = categories.find((cat) => cat.name.toLowerCase() === normalizedDetectedCategory);
    if (!matchedCategory && normalizedDetectedCategory === "keine kategorie") {
      matchedCategory = categories.find((cat) => cat.name.toLowerCase() === "sonstige");
    }
    if (!matchedCategory) {
      matchedCategory = categories.find((cat) => cat.name.toLowerCase() === "sonstige");
    }
    const finalCategoryName = matchedCategory?.name ?? detectedCategoryName;
    const finalCategoryId = matchedCategory?.id ?? null;

    const dueDateRaw = String(form.get("faelligkeitsdatum") ?? "").trim();
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw) ? dueDateRaw : null;

    const safeApiFilename = sanitizeFilename(String(classifier.datei_name || file.name));
    const uploadDir = await ensureUploadDir();
    const filePath = path.join(uploadDir, safeApiFilename);

    // Keep Python-cropped file if it already exists; create local copy only when missing.
    if (!fs.existsSync(filePath)) {
      const buffer = Buffer.from(await file.arrayBuffer());
      await fsp.writeFile(filePath, buffer);
    }

    const invoiceId = await insertInvoice({
      dateiname: safeApiFilename,
      dateityp: file.type || "application/octet-stream",
      rechnungTyp: finalInvoiceType,
      rechnungsdatum: invoiceDate,
      beschreibung: safeString(form.get("beschreibung")) || null,
      lieferant: supplier || "Unbekannt",
      kategorieId: finalCategoryId,
      kategorieName: finalCategoryName,
      nettoBetrag: netAmount,
      mwstSatz: vatRate == null ? null : String(vatRate),
      mwstBetrag: vatAmount,
      bruttoBetrag: grossAmount,
      waehrung: currency,
      qualitaetScore: Number(classifier.qualitaet_score ?? 0),
      faelligkeitsdatum: dueDate
    });

    return NextResponse.json({
      ok: true,
      warning: weakExtraction
        ? isImage
          ? "Bildrechnung wurde nur teilweise erkannt. Bitte Felder prüfen und ggf. manuell korrigieren."
          : "Rechnungsdaten wurden nur teilweise erkannt. Bitte Felder prüfen."
        : null,
      debug: classifier.debug ?? null,
      invoiceId,
      datei_name: safeApiFilename,
      ergebnis: {
        ...result,
        kategorie: finalCategoryName,
        rechnung_typ: finalInvoiceType,
        rechnungsdatum: invoiceDate
      },
      qualitaet_score: Number(classifier.qualitaet_score ?? 0)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Upload fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
