// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { createCategory, listCategories } from "@/lib/repository";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const url = new URL(request.url);
    const activeOnly = url.searchParams.get("activeOnly") === "1";
    const categories = await listCategories(activeOnly);
    return NextResponse.json({ ok: true, categories });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.categoriesLoadFailed }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const body = (await request.json()) as { name?: string; beschreibung?: string; farbe?: string };

    const name = String(body.name ?? "").trim();
    const beschreibung = String(body.beschreibung ?? "").trim();
    const farbe = String(body.farbe ?? "#6366F1").trim() || "#6366F1";

    if (!name) {
      return NextResponse.json({ ok: false, message: t.api.categoryNameRequired }, { status: 400 });
    }

    await createCategory(name, beschreibung, farbe);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.admin.createFailed }, { status: 500 });
  }
}
