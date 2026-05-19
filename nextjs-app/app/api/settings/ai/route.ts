import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { AI_OPTIONS } from "@/lib/constants";
import { getAiSettings, maskApiKey, saveAiSettings } from "@/lib/repository";

export const runtime = "nodejs";

async function testApiKey(provider: string, model: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  if (!apiKey.trim()) {
    return { ok: false, message: "API-Key fehlt." };
  }

  const isOpenAI = provider === "openai";
  const url = isOpenAI ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
        temperature: 0
      })
    });

    if (response.ok) {
      return { ok: true, message: "API-Key ist gültig." };
    }

    return {
      ok: false,
      message: `API-Test fehlgeschlagen (HTTP ${response.status}).`
    };
  } catch {
    return { ok: false, message: "API-Test fehlgeschlagen (Netzwerk)." };
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const settings = await getAiSettings();
    return NextResponse.json({
      ok: true,
      settings: {
        ...settings,
        masked_api_key: maskApiKey(settings.ai_api_key)
      },
      options: AI_OPTIONS
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "AI-Einstellungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const body = (await request.json()) as { service?: string; apiKey?: string };

    const service = String(body.service ?? "openrouter_openai");
    const apiKey = String(body.apiKey ?? "").trim();

    const saved = await saveAiSettings(service, apiKey);
    const test = await testApiKey(saved.ai_provider, saved.ai_model, saved.ai_api_key);

    return NextResponse.json({
      ok: test.ok,
      message: test.ok
        ? `API-Einstellungen gespeichert. ${test.message}`
        : `API-Einstellungen gespeichert. ${test.message}`,
      settings: {
        ...saved,
        masked_api_key: maskApiKey(saved.ai_api_key)
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "AI-Einstellungen konnten nicht gespeichert werden." }, { status: 500 });
  }
}
