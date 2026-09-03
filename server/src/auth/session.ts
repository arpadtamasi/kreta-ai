import type { Request } from "express";

export const SESSION_COOKIE_NAME = "__session";
export const SESSION_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export function readSessionCookie(req: Pick<Request, "get">): string | undefined {
  const header = req.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName !== SESSION_COOKIE_NAME || rawValue.length === 0) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sessionCookieHeader(cookie: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearedSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
