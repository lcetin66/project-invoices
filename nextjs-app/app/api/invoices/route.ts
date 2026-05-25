import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/constants";
import { classifyWithPython, ClassifierApiError, type ClassifierResponse } from "@/lib/python-api";
import { findDuplicateInvoice, getAiSettings, insertInvoice, listCategories, listInvoices } from "@/lib/repository";
import { ensureUploadDir, sanitizeFilename } from "@/lib/utils";
import { t } from "@/lang";

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

function normalizeBaseStem(fileName: string): string {
  const base = path.basename(String(fileName || ""));
  const withoutUuid = base.replace(/^[0-9a-f]{32}_/i, "");
  const withoutEditor = withoutUuid.replace(/^editor-/i, "");
  const stem = withoutEditor.replace(/\.[^.]+$/, "");
  return stem.toLowerCase().trim();
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

function normalizeTaxDetails(value: unknown): string {
  let raw = String(value ?? "").trim();
  if (!raw) return "";
  // Force line breaks before each new VAT rate block if model returns merged text
  // like "... MwSt 0,9019% Netto ..."
  raw = raw.replace(/(?<!^)(?=(?:\d{1,2}(?:[.,]\d{1,2})?\s*%))/g, "\n");
  return raw
    .split(/\r?\n|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

type TaxLine = {
  rate: number;
  netto: number | null;
  tax: number | null;
};

function parseTaxDetailsLines(value: string): TaxLine[] {
  const out: TaxLine[] = [];
  if (!value.trim()) return out;

  const rowPattern =
    /(\d{1,2}(?:[.,]\d{1,2})?)\s*%.*?netto\s*([0-9]+(?:[.,][0-9]{1,2})?).*?(?:mwst|ust|vat|steuer)\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi;
  let match = rowPattern.exec(value);
  while (match) {
    const rate = parseLocaleNumber(match[1]);
    const netto = parseLocaleNumber(match[2]);
    const tax = parseLocaleNumber(match[3]);
    if (rate != null && rate >= 0) {
      out.push({ rate, netto, tax });
    }
    match = rowPattern.exec(value);
  }
  return out;
}

function formatMoney(value: number | null, currency = "EUR"): string {
  if (value == null) return "";
  const fixed = value.toFixed(2).replace(".", ",");
  return `${fixed} ${currency}`.trim();
}

function buildReceiptSummary(result: Record<string, unknown>, taxLines: TaxLine[], currency: string): string {
  const s = (v: unknown): string => String(v ?? "").trim();
  const lines: string[] = [];

  const supplier = s(result.lieferant);
  const address = s(result.adresse);
  const date = s(result.rechnungsdatum);
  const time = s(result.uhrzeit);
  const payment = [s(result.zahlungsart), s(result.zahlungsmittel)].filter(Boolean).join(", ");
  const cardNo = s(result.karten_nr);
  const tid = s(result.t_id);
  const belegNr = s(result.beleg_nr || result.belegnummer);
  const vu = s(result.vu_nummer);
  const ust = s(result.ust_id_nr || result.steuer_id);

  if (supplier) lines.push(`${t.api.receiptSupplier}: ${supplier}`);
  if (address) lines.push(`${t.api.receiptAddress}: ${address}`);
  if (date) lines.push(`${t.api.receiptDate}: ${date}`);
  if (time) lines.push(`${t.api.receiptTime}: ${time}`);

  const gross = parseLocaleNumber(result.gesamt_betrag ?? result.brutto_betrag);
  if (gross != null) lines.push(`${t.api.receiptAmount}: ${formatMoney(gross, currency)}`);

  if (payment) lines.push(`${t.api.receiptPayment}: ${payment}`);
  if (cardNo) lines.push(`${t.api.receiptCardNumber}: ${cardNo}`);
  if (tid) lines.push(`${t.api.receiptTransactionId}: ${tid}`);
  if (belegNr) lines.push(`${t.api.receiptDocumentNumber}: ${belegNr}`);
  if (vu) lines.push(`${t.api.receiptVuNumber}: ${vu}`);
  if (ust) lines.push(`${t.api.receiptVatId}: ${ust}`);

  if (taxLines.length > 0) {
    lines.push(`${t.api.receiptTaxBreakdown}:`);
    for (const line of taxLines) {
      const rate = Number.isFinite(line.rate) ? String(line.rate).replace(".", ",") : "";
      const netto = line.netto == null ? "" : String(line.netto.toFixed(2)).replace(".", ",");
      const tax = line.tax == null ? "" : String(line.tax.toFixed(2)).replace(".", ",");
      lines.push(`${rate}% -> ${t.api.receiptNet} ${netto} -> ${t.api.receiptVat} ${tax}`);
    }
  }

  return lines.join("\n");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const url = new URL(request.url);

    const typRaw = url.searchParams.get("typ");
    const typ = typRaw === "ausgang" ? "ausgang" : typRaw === "eingang" ? "eingang" : undefined;
    const category = url.searchParams.get("category")?.trim() || undefined;
    const search = url.searchParams.get("search")?.trim() || undefined;

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const invoices = await listInvoices({
      typ,
      category,
      search,
      limit: Number.isFinite(limit) && (limit ?? 0) > 0 ? limit : undefined
    });

    return NextResponse.json({ ok: true, invoices });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.invoicesLoadFailed }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const checkDuplicateOnly = new URL(request.url).searchParams.get("check_duplicate") === "1";

    const form = await request.formData();
    const fileEntry = form.get("file") ?? form.get("rechnung_datei");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, message: t.api.missingFile }, { status: 400 });
    }

    const file = fileEntry;
    const extension = path.extname(file.name).toLowerCase().replace(".", "");
    const typeAllowed = ALLOWED_MIME_TYPES.has(file.type.toLowerCase());
    const extAllowed = ALLOWED_EXTENSIONS.has(extension);

    if (!typeAllowed && !extAllowed) {
      return NextResponse.json({ ok: false, message: t.api.invalidFileType }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ ok: false, message: t.api.fileTooLarge }, { status: 400 });
    }

    // Exact duplicate guard before AI call: same binary => immediate duplicate warning.
    const incomingBuffer = Buffer.from(await file.arrayBuffer());
    const incomingSize = incomingBuffer.byteLength;
    const incomingHash = createHash("sha256").update(incomingBuffer).digest("hex");
    const incomingStem = normalizeBaseStem(file.name);
    const uploadDirForDuplicate = await ensureUploadDir();
    const existingInvoicesForDuplicate = await listInvoices();

    for (const existing of existingInvoicesForDuplicate) {
      const existingName = sanitizeFilename(String(existing.dateiname || ""));
      if (!existingName) continue;
      const existingStem = normalizeBaseStem(existingName);
      if (incomingStem && existingStem && incomingStem === existingStem) {
        return NextResponse.json(
          {
            ok: false,
            duplicate: true,
            message: t.api.duplicateInvoiceProcessed,
            previousInvoice: {
              id: existing.id,
              dateiname: existing.dateiname,
              dateityp: existing.dateityp,
              lieferant: existing.lieferant,
              brutto_betrag: existing.brutto_betrag,
              rechnungsdatum: existing.rechnungsdatum
            },
            duplicate_meta: { reason: "name_stem_match", incoming_stem: incomingStem, existing_stem: existingStem }
          },
          { status: 409 }
        );
      }
      const existingPath = path.join(uploadDirForDuplicate, existingName);
      if (!fs.existsSync(existingPath)) continue;
      try {
        const stat = await fsp.stat(existingPath);
        if (stat.size !== incomingSize) continue;
        const existingBytes = await fsp.readFile(existingPath);
        const existingHash = createHash("sha256").update(existingBytes).digest("hex");
        if (existingHash !== incomingHash) continue;
        return NextResponse.json(
          {
            ok: false,
            duplicate: true,
            message: t.api.duplicateInvoiceProcessed,
            previousInvoice: {
              id: existing.id,
              dateiname: existing.dateiname,
              dateityp: existing.dateityp,
              lieferant: existing.lieferant,
              brutto_betrag: existing.brutto_betrag,
              rechnungsdatum: existing.rechnungsdatum
            }
          },
          { status: 409 }
        );
      } catch {
        // Ignore unreadable files and continue duplicate scan.
      }
    }

    if (checkDuplicateOnly) {
      return NextResponse.json({ ok: true, duplicate: false });
    }

    const ai = await getAiSettings();
    let classifier: ClassifierResponse;
    try {
      classifier = await classifyWithPython(file, ai);
    } catch (error) {
      if (error instanceof ClassifierApiError && error.status === 409) {
        const duplicate = Boolean(error.payload.duplicate);
        const duplicateMeta = (error.payload.duplicate_meta ?? {}) as Record<string, unknown>;
        if (duplicate) {
          const matchedName = String(duplicateMeta.matched_file ?? "");
          const isPdf = matchedName.toLowerCase().endsWith(".pdf");
          return NextResponse.json(
            {
              ok: false,
              duplicate: true,
              message: t.api.duplicateInvoiceProcessed,
              previousInvoice: {
                dateiname: matchedName,
                dateityp: isPdf ? "application/pdf" : "image/*",
                lieferant: t.common.unknown,
                brutto_betrag: null,
                rechnungsdatum: null
              },
              duplicate_meta: duplicateMeta
            },
            { status: 409 }
          );
        }
      }
      throw error;
    }
    const result = classifier.ergebnis;

    const supplier = safeString(result.lieferant ?? result.vendor);
    const grossAmount = parseLocaleNumber(result.brutto_betrag ?? result.total) ?? 0;
    let netAmount = parseLocaleNumber(result.netto_betrag_1 ?? result.netto_betrag);
    let vatAmount = parseLocaleNumber(result.mwst_betrag_1 ?? result.mwst_betrag);
    let vatRate = parseLocaleNumber(result.mwst_satz_1 ?? result.mwst_satz);
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
          message: t.api.unsafeImage
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
    const forceDuplicate = String(form.get("force_duplicate") ?? "").trim().toLowerCase() === "1";
    const manualDescription = safeString(form.get("beschreibung"));
    const taxDetails = normalizeTaxDetails(result.steuerdetails);
    const taxLines = parseTaxDetailsLines(taxDetails);

    if (taxLines.length === 0) {
      const r1 = parseLocaleNumber(result.mwst_satz_1 ?? result.mwst_satz);
      const n1 = parseLocaleNumber(result.netto_betrag_1 ?? result.netto_betrag);
      const t1 = parseLocaleNumber(result.mwst_betrag_1 ?? result.mwst_betrag);
      if (r1 != null && r1 >= 0) {
        taxLines.push({ rate: r1, netto: n1, tax: t1 });
      }

      const r2 = parseLocaleNumber(result.mwst_satz_2);
      const n2 = parseLocaleNumber(result.netto_betrag_2);
      const t2 = parseLocaleNumber(result.mwst_betrag_2);
      if (r2 != null && r2 >= 0 && (n2 != null || t2 != null)) {
        taxLines.push({ rate: r2, netto: n2, tax: t2 });
      }
    }

    if (taxLines.length > 0 && (vatRate == null || netAmount == null || vatAmount == null)) {
      // Prefer the dominant VAT bucket for primary fields (usually 19% or highest netto).
      const dominant = [...taxLines].sort((a, b) => {
        const aNetto = a.netto ?? 0;
        const bNetto = b.netto ?? 0;
        if (bNetto !== aNetto) return bNetto - aNetto;
        return b.rate - a.rate;
      })[0];
      vatRate = dominant.rate;
      if (dominant.tax != null) vatAmount = dominant.tax;
      if (dominant.netto != null) netAmount = dominant.netto;
    }

    // Hard guard: net cannot be identical to gross when VAT exists.
    if (grossAmount > 0 && netAmount != null && vatAmount != null && vatAmount > 0 && netAmount >= grossAmount) {
      netAmount = Number((grossAmount - vatAmount).toFixed(2));
    }

    const receiptSummary = buildReceiptSummary(result as Record<string, unknown>, taxLines, currency);
    const mergedDescription = [manualDescription, receiptSummary]
      .filter(Boolean)
      .join("\n\n") || null;

    if (!forceDuplicate) {
      const duplicate = await findDuplicateInvoice({
        lieferant: supplier,
        bruttoBetrag: grossAmount,
        rechnungsdatum: invoiceDate
      });
      if (duplicate) {
        const duplicateName = sanitizeFilename(String(classifier.datei_name || file.name));
        const duplicatePath = path.join(await ensureUploadDir(), duplicateName);
        try {
          await fsp.unlink(duplicatePath);
        } catch {
          // Best effort cleanup for duplicate uploads.
        }
        return NextResponse.json(
          {
            ok: false,
            duplicate: true,
            message: t.api.duplicateInvoiceProcessed,
            previousInvoice: {
              id: duplicate.id,
              dateiname: duplicate.dateiname,
              dateityp: duplicate.dateityp,
              lieferant: duplicate.lieferant,
              brutto_betrag: duplicate.brutto_betrag,
              rechnungsdatum: duplicate.rechnungsdatum
            }
          },
          { status: 409 }
        );
      }
    }

    const safeApiFilename = sanitizeFilename(String(classifier.datei_name || file.name));
    const uploadDir = await ensureUploadDir();
    const filePath = path.join(uploadDir, safeApiFilename);

    // Keep Python-cropped file if it already exists; create local copy only when missing.
    if (!fs.existsSync(filePath)) {
      await fsp.writeFile(filePath, incomingBuffer);
    }

    const invoiceId = await insertInvoice({
      dateiname: safeApiFilename,
      originalDateiname: sanitizeFilename(file.name),
      dateityp: file.type || "application/octet-stream",
      rechnungTyp: finalInvoiceType,
      rechnungsdatum: invoiceDate,
      beschreibung: mergedDescription,
      lieferant: supplier || t.common.unknown,
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
          ? t.api.imagePartialWarning
          : t.api.invoicePartialWarning
        : null,
      debug: classifier.debug ?? null,
      invoiceId,
      datei_name: safeApiFilename,
      ergebnis: {
        ...result,
        beleg_auszug: receiptSummary,
        kategorie: finalCategoryName,
        rechnung_typ: finalInvoiceType,
        rechnungsdatum: invoiceDate
      },
      qualitaet_score: Number(classifier.qualitaet_score ?? 0)
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : t.api.uploadFailed;
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
