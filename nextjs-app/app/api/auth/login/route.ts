import { NextRequest, NextResponse } from "next/server";
import { applySessionCookie, signSession, verifyCredentials } from "@/lib/auth";
import { t } from "@/lang";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    const username = String(body.username ?? "").trim();
    const password = String(body.password ?? "");

    const user = await verifyCredentials(username, password);
    if (!user) {
      return NextResponse.json({ ok: false, message: t.api.invalidLogin }, { status: 401 });
    }

    const token = await signSession(user);
    const response = NextResponse.json({ ok: true, user });
    applySessionCookie(response, token);
    return response;
  } catch {
    return NextResponse.json({ ok: false, message: t.api.loginFailed }, { status: 500 });
  }
}
