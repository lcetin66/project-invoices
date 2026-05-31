// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { classifyWithPython, normalizeModel } from "@/lib/python-api";
import { getAiSettings } from "@/lib/repository";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const form = await request.formData();
    const fileEntry = form.get("file");
    if (!(fileEntry instanceof File)) {
      return NextResponse.json({ ok: false, message: t.api.missingFile }, { status: 400 });
    }

    const ai = await getAiSettings();
    const effectiveModel = normalizeModel(ai.ai_model, ai.ai_provider);
    const classifier = await classifyWithPython(fileEntry, ai);
    const debugPayload = (classifier.debug ?? {}) as Record<string, unknown>;
    const visionTrace = (debugPayload.vision_trace ?? null) as Record<string, unknown> | null;
    const requestMain = (visionTrace?.request_main ?? null) as Record<string, unknown> | null;
    const requestTax = (visionTrace?.request_tax ?? null) as Record<string, unknown> | null;

    return NextResponse.json({
      ok: true,
      sent_json: {
        api_provider: ai.ai_provider,
        api_model: effectiveModel,
        has_api_key: Boolean(ai.ai_api_key),
        file_name: fileEntry.name,
        file_type: fileEntry.type,
        file_size: fileEntry.size,
        request_params: {
          main: requestMain,
          tax: requestTax
        }
      },
      response_json: classifier,
      openai_trace: visionTrace
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : t.api.debugFailed
      },
      { status: 500 }
    );
  }
}
