// Project owner: Levent Cetin
import { NextRequest, NextResponse } from "next/server";
import { applySessionCookie, signSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const nextPath = request.nextUrl.searchParams.get("next") || "/dashboard";
  const redirectUrl = new URL(nextPath, request.url);
  const token = await signSession({ id: 1, username: "admin" });
  const response = NextResponse.redirect(redirectUrl);
  applySessionCookie(response, token);
  return response;
}
