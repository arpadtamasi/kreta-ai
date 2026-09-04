import { createHash } from "node:crypto";

export const CLASSROOM_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.me.readonly",
  "https://www.googleapis.com/auth/classroom.announcements.readonly",
  "https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly",
] as const;

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export class ClassroomAuthError extends Error {
  constructor(readonly code: "denied" | "blocked" | "invalid" | "unavailable", message: string) {
    super(message);
    this.name = "ClassroomAuthError";
  }
}

export interface ClassroomOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface ClassroomTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scopes: string[];
}

interface GoogleTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

function parseTokenResponse(value: GoogleTokenResponse, requireRefreshToken: boolean): ClassroomTokens {
  if (
    typeof value.access_token !== "string" ||
    (requireRefreshToken && typeof value.refresh_token !== "string") ||
    typeof value.expires_in !== "number"
  ) {
    throw new ClassroomAuthError(
      "invalid",
      requireRefreshToken
        ? "A Google nem adott tartós Classroom-hozzáférést. Próbáld meg újra engedélyezni."
        : "A Classroom-kapcsolat lejárt. Kapcsold össze újra a gyerek Google-fiókját.",
    );
  }
  return {
    accessToken: value.access_token,
    ...(typeof value.refresh_token === "string" ? { refreshToken: value.refresh_token } : {}),
    expiresIn: value.expires_in,
    scopes: typeof value.scope === "string" ? value.scope.split(/\s+/u).filter(Boolean) : [],
  };
}

async function tokenRequest(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  requireRefreshToken: boolean,
): Promise<ClassroomTokens> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch {
    throw new ClassroomAuthError("unavailable", "A Google Classroom most nem érhető el. Próbáld újra később.");
  }
  const data = await response.json().catch(() => ({})) as GoogleTokenResponse;
  if (!response.ok) {
    const code = data.error === "access_denied" ? "denied" : data.error === "admin_policy_enforced" ? "blocked" : "invalid";
    throw new ClassroomAuthError(
      code,
      code === "blocked"
        ? "Az iskola Google-rendszergazdája nem engedélyezi ezt az alkalmazást."
        : "A Google Classroom engedélyezése nem sikerült. Próbáld meg újra.",
    );
  }
  return parseTokenResponse(data, requireRefreshToken);
}

export function buildClassroomAuthorizationUrl(
  client: ClassroomOAuthClient,
  state: string,
  codeVerifier: string,
): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    scope: CLASSROOM_SCOPES.join(" "),
    state,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export function exchangeClassroomCode(
  client: ClassroomOAuthClient,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassroomTokens> {
  return tokenRequest(new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
  }), fetchImpl, true);
}

export function refreshClassroomAccessToken(
  client: Pick<ClassroomOAuthClient, "clientId" | "clientSecret">,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassroomTokens> {
  return tokenRequest(new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), fetchImpl, false);
}

export async function fetchClassroomEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_USERINFO_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ClassroomAuthError("unavailable", "A Google-fiókot most nem sikerült ellenőrizni.");
  }
  const data = await response.json().catch(() => ({})) as { email?: unknown; email_verified?: unknown };
  if (!response.ok || typeof data.email !== "string" || data.email_verified === false) {
    throw new ClassroomAuthError("invalid", "A Google-fiók e-mail-címét nem sikerült ellenőrizni.");
  }
  return data.email;
}

export async function revokeClassroomToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await fetchImpl(GOOGLE_REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  });
}
