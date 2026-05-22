import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { normalizeModel } from "@/lib/python-api";

export const runtime = "nodejs";

function getClassifierBase(): string {
  const raw = (process.env.CLASSIFIER_API_URL ?? "http://127.0.0.1:8000").trim();
  return raw.replace(/\/api\/klassifizieren\/?$/, "").replace(/\/$/, "");
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const form = await request.formData();
    const fileEntry = form.get("file");

    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, message: "Duzeltilmis resim bulunamadi." }, { status: 400 });
    }

    const classifierForm = new FormData();
    classifierForm.append("datei", fileEntry, fileEntry.name || "duzeltilmis-resim.png");
    classifierForm.append("api_key", "");
    classifierForm.append("api_provider", process.env.AI_PROVIDER ?? "openai");
    classifierForm.append("api_model", normalizeModel(process.env.AI_MODEL ?? "gpt-4o-mini", process.env.AI_PROVIDER ?? "openai"));

    const response = await fetch(`${getClassifierBase()}/api/klassifizieren`, {
      method: "POST",
      body: classifierForm,
      cache: "no-store"
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return NextResponse.json(
        { ok: false, message: `Classifier API error (${response.status})`, debug: data },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      datei_name: data.datei_name ?? "",
      ergebnis: data.ergebnis ?? {},
      qualitaet_score: Number(data.qualitaet_score ?? 0),
      debug: data.debug ?? null
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert" }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Editor-Klassifizierung fehlgeschlagen.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
