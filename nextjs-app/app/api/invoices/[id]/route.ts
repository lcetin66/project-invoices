import fs from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { deletePythonUpload } from "@/lib/python-api";
import { deleteInvoice, getCategoryNameById, updateInvoice } from "@/lib/repository";
import { getUploadAbsoluteDir } from "@/lib/utils";

export const runtime = "nodejs";

function toNullableDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const { id } = await context.params;
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ ok: false, message: "Ungültige Rechnungs-ID." }, { status: 400 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const categoryIdRaw = Number(body.kategorie_id ?? 0);
    const categoryId = Number.isFinite(categoryIdRaw) && categoryIdRaw > 0 ? categoryIdRaw : null;
    const categoryName = await getCategoryNameById(categoryId);

    const rechnungTyp = body.rechnung_typ === "ausgang" ? "ausgang" : "eingang";
    const waehrung = typeof body.waehrung === "string" && body.waehrung.trim() ? body.waehrung.trim().toUpperCase() : "EUR";

    await updateInvoice(invoiceId, {
      lieferant: toNullableString(body.lieferant),
      kategorieId: categoryId,
      kategorieName: categoryName,
      rechnungTyp,
      faelligkeitsdatum: toNullableDate(body.faelligkeitsdatum),
      rechnungsdatum: toNullableDate(body.rechnungsdatum),
      nettoBetrag: toNullableNumber(body.netto_betrag),
      mwstSatz: toNullableString(body.mwst_satz),
      mwstBetrag: toNullableNumber(body.mwst_betrag),
      bruttoBetrag: toNullableNumber(body.brutto_betrag),
      waehrung,
      beschreibung: toNullableString(body.beschreibung)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "Rechnung konnte nicht aktualisiert werden." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const { id } = await context.params;
    const invoiceId = Number(id);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return NextResponse.json({ ok: false, message: "Ungültige Rechnungs-ID." }, { status: 400 });
    }

    const { names } = await deleteInvoice(invoiceId);
    const uploadDir = getUploadAbsoluteDir();

    await Promise.all(
      names.map(async (name) => {
        const localPath = path.join(uploadDir, path.basename(name));
        try {
          await fs.unlink(localPath);
        } catch {
          // ignore missing local file
        }
        await deletePythonUpload(path.basename(name));
      })
    );

    return NextResponse.json({ ok: true, deletedFiles: names });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "Rechnung konnte nicht gelöscht werden." }, { status: 500 });
  }
}
