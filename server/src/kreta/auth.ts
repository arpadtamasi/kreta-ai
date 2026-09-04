/**
 * KRÉTA authentication: OAuth 2.0 Authorization Code + PKCE against
 * idp.e-kreta.hu.
 *
 * The password is a parameter of `login()` and nothing else. It is never
 * returned, never logged, never sealed into a token, and never written
 * anywhere — it exists for the duration of one POST to the IDP and is then
 * unreachable. Everything downstream of this module works from the encrypted
 * access/refresh token pair stored on the parent-owned child connection.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  AUTHORIZE_URL,
  CLIENT_ID,
  HTTP_TIMEOUT_MS,
  IDP_BASE_URL,
  REDIRECT_URI,
  REVOCATION_URL,
  SCOPE,
  TOKEN_URL,
  WEB_USER_AGENT,
} from "./constants.js";
import { KretaError } from "./institute.js";
import { parseLoginForm } from "./loginForm.js";
import { HttpSession } from "./session.js";

export interface KretaTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds the access token is valid for, as reported by the IDP. */
  expiresIn: number;
  /**
   * Whether the IDP handed back a *different* refresh token than the one
   * presented. Rotations are surfaced for diagnostics and every successful
   * refresh is persisted with a profile-version check.
   */
  rotated: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
  instituteCode: string;
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function trustedIdpUrl(value: string, base: string): string {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new KretaError("A KRÉTA bejelentkezési oldal érvénytelen címet adott vissza.");
  }
  if (url.origin !== IDP_BASE_URL || url.username || url.password) {
    throw new KretaError("A KRÉTA bejelentkezési oldal nem megbízható címet adott vissza.");
  }
  return url.toString();
}

function findCode(location: string | null, base: string, expectedState: string): string | null {
  if (!location) return null;
  let query: URLSearchParams;
  try {
    query = new URL(location, base).searchParams;
  } catch {
    return null;
  }
  const code = query.get("code");
  if (!code) return null;
  if (query.get("state") !== expectedState) {
    throw new KretaError("A bejelentkezési válasz state értéke nem egyezik.");
  }
  return code;
}

function readTokens(payload: unknown, presentedRefreshToken?: string): KretaTokens {
  const token = payload as Record<string, unknown>;
  const accessToken = typeof token.access_token === "string" ? token.access_token : "";
  if (!accessToken) {
    throw new KretaError("A KRÉTA válaszából hiányzik a hozzáférési token.");
  }
  // A refresh response may legitimately omit refresh_token, meaning "keep
  // using the one you presented" — that is the non-rotating case.
  const returned = typeof token.refresh_token === "string" ? token.refresh_token : "";
  const refreshToken = returned || presentedRefreshToken || "";
  if (!refreshToken) {
    throw new KretaError("A KRÉTA válaszából hiányzik a frissítő token.");
  }
  const rawExpiry = Number(token.expires_in);
  const expiresIn = Number.isFinite(rawExpiry) && rawExpiry > 0 ? Math.floor(rawExpiry) : 300;
  return {
    accessToken,
    refreshToken,
    expiresIn,
    rotated: Boolean(returned) && Boolean(presentedRefreshToken) && returned !== presentedRefreshToken,
  };
}

/**
 * Signs in with a username/password/institute code and returns tokens.
 *
 * KRÉTA publishes no third-party client registration, so this drives the
 * official mobile client's authorization request and submits the IDP's own
 * login form on the user's behalf. The parent explicitly trusts this server
 * for the seconds the credential is in flight.
 */
export async function login(
  credentials: LoginCredentials,
  session: HttpSession = new HttpSession(),
): Promise<KretaTokens> {
  const codeVerifier = randomBytes(48).toString("base64url");
  const state = randomBytes(24).toString("base64url");
  const params = new URLSearchParams({
    prompt: "login",
    nonce: randomBytes(24).toString("base64url"),
    response_type: "code",
    code_challenge_method: "S256",
    scope: SCOPE,
    code_challenge: base64UrlSha256(codeVerifier),
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    state,
    suppressed_prompt: "login",
  });

  let loginPage;
  try {
    loginPage = await session.follow(`${AUTHORIZE_URL}?${params.toString()}`, {
      headers: { "user-agent": WEB_USER_AGENT },
    }, (url) => {
      trustedIdpUrl(url, IDP_BASE_URL);
      return true;
    });
  } catch {
    throw new KretaError("A KRÉTA bejelentkezési oldal nem érhető el.");
  }
  if (loginPage.status >= 400) {
    throw new KretaError("A KRÉTA bejelentkezési oldal nem érhető el.");
  }

  const form = parseLoginForm(loginPage.body);
  if (!form) {
    throw new KretaError("A KRÉTA bejelentkezési űrlapja nem ismerhető fel.");
  }

  const payload = new URLSearchParams(form.fields);
  payload.set("UserName", credentials.username);
  payload.set("Password", credentials.password);
  payload.set("InstituteCode", credentials.instituteCode);
  payload.set("IsTemporaryLogin", "False");
  payload.set("loginType", "InstituteLogin");

  const formAction = trustedIdpUrl(form.action, loginPage.url);
  let submitted;
  try {
    submitted = await session.request(formAction, {
      method: "POST",
      headers: {
        "user-agent": WEB_USER_AGENT,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });
  } catch {
    throw new KretaError("A KRÉTA elutasította a bejelentkezési kérést.");
  }
  if (submitted.status >= 400) {
    throw new KretaError("A KRÉTA elutasította a bejelentkezési kérést.");
  }

  let code = findCode(submitted.headers.get("location"), submitted.url, state);
  if (code === null) {
    const returnUrl = form.fields["ReturnUrl"] ?? "";
    if (!returnUrl) {
      throw new KretaError(
        "Sikertelen bejelentkezés. Ellenőrizd az azonosítót, a jelszót és az intézmény kódját.",
      );
    }
    const callback = await session.request(trustedIdpUrl(returnUrl, IDP_BASE_URL), {
      headers: { "user-agent": WEB_USER_AGENT },
    });
    code = findCode(callback.headers.get("location"), callback.url, state);
  }

  if (code === null) {
    throw new KretaError(
      "Sikertelen bejelentkezés. Ellenőrizd az azonosítót, a jelszót és az intézmény kódját.",
    );
  }

  return readTokens(
    await postToken(
      new URLSearchParams({
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
      }),
      "A KRÉTA nem adott használható hozzáférési tokent.",
    ),
  );
}

/** Exchanges a refresh token for a fresh access token. */
export async function refresh(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KretaTokens> {
  const payload = await postToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
    "A KRÉTA hozzáférési token frissítése sikertelen.",
    fetchImpl,
  );
  return readTokens(payload, refreshToken);
}

/** Best-effort revocation; a failure is reported, never thrown at a caller mid-teardown. */
export async function revokeRefreshToken(
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(REVOCATION_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: CLIENT_ID,
        token_type_hint: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function postToken(
  body: URLSearchParams,
  failureMessage: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch {
    throw new KretaError(failureMessage);
  }
  if (!response.ok) {
    throw new KretaError(failureMessage);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new KretaError(failureMessage);
  }
}
