import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { listBudgets, upsertBudget } from "@/lib/repository";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const budgets = await listBudgets();
    return NextResponse.json({ ok: true, budgets });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.budgetsLoadFailed }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const body = (await request.json()) as { categoryId?: number; monthlyBudget?: number };

    const categoryId = Number(body.categoryId ?? 0);
    const monthlyBudget = Number(body.monthlyBudget ?? 0);

    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, message: t.api.invalidCategoryId }, { status: 400 });
    }

    if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
      return NextResponse.json({ ok: false, message: t.api.invalidBudget }, { status: 400 });
    }

    await upsertBudget(categoryId, monthlyBudget);
    return NextResponse.json({ ok: true, message: t.api.monthlyBudgetSaved });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.budgetSaveFailed }, { status: 500 });
  }
}
