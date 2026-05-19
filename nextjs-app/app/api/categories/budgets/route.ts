import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { listBudgets, upsertBudget } from "@/lib/repository";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const budgets = await listBudgets();
    return NextResponse.json({ ok: true, budgets });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "Budgets konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const body = (await request.json()) as { categoryId?: number; monthlyBudget?: number };

    const categoryId = Number(body.categoryId ?? 0);
    const monthlyBudget = Number(body.monthlyBudget ?? 0);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, message: "Ungültige Kategorie-ID." }, { status: 400 });
    }

    if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
      return NextResponse.json({ ok: false, message: "Ungültiges Budget." }, { status: 400 });
    }

    await upsertBudget(categoryId, monthlyBudget);
    return NextResponse.json({ ok: true, message: "Monatsbudget wurde gespeichert." });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: "Nicht autorisiert." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: "Budget konnte nicht gespeichert werden." }, { status: 500 });
  }
}
