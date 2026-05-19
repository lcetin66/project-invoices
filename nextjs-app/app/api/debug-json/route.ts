import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { classifyWithPython } from "@/lib/python-api";
import { getAiSettings } from "@/lib/repository";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const form = await request.formData();
    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, message: "Keine Datei gefunden." }, { status: 400 });
    }

    const ai = await getAiSettings();
    const classifier = await classifyWithPython(fileEntry, ai);

    return NextResponse.json({
      ok: true,
      sent_json: {
        api_provider: ai.ai_provider,
        api_model: ai.ai_model,
        has_api_key: Boolean(ai.ai_api_key),
        file_name: fileEntry.name,
        file_type: fileEntry.type,
        file_size: fileEntry.size
      },
      response_json: classifier
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Debug fehlgeschlagen."
      },
      { status: 500 }
    );
  }
}

