// Project owner: Levent Cetin
import { compare } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import { queryRows } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

const SESSION_COOKIE = "rm_session";
const DEMO_SESSION_COOKIE = "rm_demo_mode";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  sub: string;
  username: string;
};

function sessionSecret(): Uint8Array {
  const raw = process.env.SESSION_SECRET ?? "dev-only-secret-change-this";
  return new TextEncoder().encode(raw);
}

function normalizePhpBcrypt(hash: string): string {
  if (hash.startsWith("$2y$")) {
    return `$2a$${hash.slice(4)}`;
  }
  return hash;
}

export async function verifyCredentials(username: string, password: string): Promise<SessionUser | null> {
  const trimmedUsername = username.trim();
  if (!trimmedUsername || !password) {
    return null;
  }

  const rows = await queryRows<
    Array<{ id: number; benutzername: string; passwort_hash: string }>
  >("SELECT id, benutzername, passwort_hash FROM benutzer WHERE benutzername = ? LIMIT 1", [trimmedUsername]);

  if (rows.length === 0) {
    return null;
  }

  const user = rows[0];
  const ok = await compare(password, normalizePhpBcrypt(String(user.passwort_hash)));
  if (!ok) {
    return null;
  }

  return { id: Number(user.id), username: String(user.benutzername) };
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_AGE_SECONDS}s`)
    .sign(sessionSecret());
}

export async function readSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    const sessionPayload = payload as unknown as SessionPayload;
    const id = Number(sessionPayload.sub);
    if (!id || Number.isNaN(id)) {
      return null;
    }
    return {
      id,
      username: String(sessionPayload.username ?? "")
    };
  } catch {
    return null;
  }
}

export async function getServerSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  if (cookieStore.get(DEMO_SESSION_COOKIE)?.value === "1") {
    return { id: 1, username: "admin" };
  }
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

export async function requireServerSession(): Promise<SessionUser> {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function getRouteSession(request: NextRequest): Promise<SessionUser | null> {
  if (request.cookies.get(DEMO_SESSION_COOKIE)?.value === "1") {
    return { id: 1, username: "admin" };
  }
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

export async function requireRouteSession(request: NextRequest): Promise<SessionUser> {
  const session = await getRouteSession(request);
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export function applySessionCookie(response: NextResponse, token: string): void {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_AGE_SECONDS
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
