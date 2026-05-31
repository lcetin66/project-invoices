// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";
import { requireRouteSession } from "@/lib/auth";
import { deactivateCategory, deleteCategory } from "@/lib/repository";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const { id } = await context.params;
    const categoryId = Number(id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, message: t.api.invalidCategoryId }, { status: 400 });
    }

    const body = (await request.json()) as { action?: string };
    const action = body.action ?? "deactivate";

    if (action === "deactivate") {
      await deactivateCategory(categoryId);
      return NextResponse.json({ ok: true, message: t.admin.deactivated });
    }

    return NextResponse.json({ ok: false, message: t.api.invalidAction }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.categoryUpdateFailed }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireRouteSession(request);
    const { id } = await context.params;
    const categoryId = Number(id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      return NextResponse.json({ ok: false, message: t.api.invalidCategoryId }, { status: 400 });
    }

    const result = await deleteCategory(categoryId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, message: result.message });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, message: t.api.unauthorized }, { status: 401 });
    }
    return NextResponse.json({ ok: false, message: t.api.categoryDeleteFailed }, { status: 500 });
  }
}
