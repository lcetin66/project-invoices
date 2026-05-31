// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { getUserProfile, getAiSettings, maskApiKey, saveAiSettings, saveUserProfile } from "@/lib/repository";
import type { UserProfile } from "@/lib/types";
import { AI_OPTIONS } from "@/lib/constants";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireRouteSession(request);
    const [profile, ai] = await Promise.all([getUserProfile(session.username), getAiSettings()]);
    return NextResponse.json({
      ok: true,
      profile,
      ai: {
        ...ai,
        masked_api_key: maskApiKey(ai.ai_api_key)
      },
      options: AI_OPTIONS
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.profileLoadFailed }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const body = (await request.json()) as {
      profile?: Partial<UserProfile>;
      service?: string;
      apiKey?: string;
    };

    const incoming = body.profile ?? {};
    const savedProfile = await saveUserProfile({
      username: String(incoming.username ?? "admin"),
      first_name: String(incoming.first_name ?? ""),
      last_name: String(incoming.last_name ?? ""),
      company_name: String(incoming.company_name ?? ""),
      company_address: String(incoming.company_address ?? ""),
      city: String(incoming.city ?? ""),
      postal_code: String(incoming.postal_code ?? ""),
      country: String(incoming.country ?? ""),
      tax_number: String(incoming.tax_number ?? ""),
      vat_id: String(incoming.vat_id ?? "")
    });

    const service = String(body.service ?? "openrouter_openai");
    const apiKey = String(body.apiKey ?? "");
    const ai = await saveAiSettings(service, apiKey);

    return NextResponse.json({
      ok: true,
      message: t.api.profileSaved,
      profile: savedProfile,
      ai: { ...ai, masked_api_key: maskApiKey(ai.ai_api_key) }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.profileSaveFailed }, { status: 500 });
  }
}
