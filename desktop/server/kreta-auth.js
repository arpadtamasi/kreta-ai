/**
 * KRÉTA OAuth 2.0 Authorization Code + PKCE bejelentkezés.
 *
 * A kreta_smoke_test.py login-folyamatának portja. A Node beépített
 * fetch-e nem kezel cookie-kat és a bejelentkezéshez saját kézben kell
 * tartani az átirányításokat, ezért itt egy minimális, host-onkénti
 * cookie-tár van — a folyamat egyetlen hostot (idp.e-kreta.hu) érint.
 */

import { createHash, randomBytes } from "node:crypto";

export const IDP_BASE_URL = "https://idp.e-kreta.hu";
export const AUTHORIZE_URL = `${IDP_BASE_URL}/connect/authorize`;
export const TOKEN_URL = `${IDP_BASE_URL}/connect/token`;
export const REVOCATION_URL = `${IDP_BASE_URL}/connect/revocation`;
export const REDIRECT_URI =
  "https://mobil.e-kreta.hu/ellenorzo-student/prod/oauthredirect";
export const CLIENT_ID = "kreta-ellenorzo-student-mobile-ios";
export const SCOPE = [
  "openid",
  "email",
  "offline_access",
  "kreta-ellenorzo-webapi.public",
  "kreta-eugyintezes-webapi.public",
  "kreta-fileservice-webapi.public",
  "kreta-mobile-global-webapi.public",
  "kreta-dkt-webapi.public",
  "kreta-ier-webapi.public",
].join(" ");
export const WEB_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export const MOBILE_USER_AGENT = "hu.ekreta.tanulo/1.0.5/Android/0/0";
export const MOBILE_API_KEY = "21ff6c25-d1da-4a68-a811-c881a6057463";
export const TIMEOUT_MS = 25_000;

/** Biztonságosan felhasználó elé adható KRÉTA-hiba. */
export class KretaError extends Error {}

function base64urlSha256(value) {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function randomToken(bytes) {
  return randomBytes(bytes).toString("base64url");
}

/** Minimális, host-onkénti cookie-tár a bejelentkezési folyamathoz. */
export class CookieJar {
  constructor() {
    this.byHost = new Map();
  }

  store(host, response) {
    const cookies = response.headers.getSetCookie?.() ?? [];
    if (!cookies.length) return;
    if (!this.byHost.has(host)) this.byHost.set(host, new Map());
    const jar = this.byHost.get(host);
    for (const line of cookies) {
      const pair = line.split(";", 1)[0];
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header(host) {
    const jar = this.byHost.get(host);
    if (!jar || !jar.size) return "";
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

/**
 * fetch cookie-tárral, időkorláttal és kézben tartott átirányításokkal.
 * `follow: true` esetén az azonos módszerű (GET) átirányításokat követi,
 * miközben minden lépés cookie-jait elteszi.
 */
export async function request(jar, url, options = {}) {
  const { follow = false, maxRedirects = 5, headers = {}, ...rest } = options;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const host = new URL(current).host;
    const cookie = jar.header(host);
    let response;
    try {
      response = await fetch(current, {
        ...rest,
        ...(hop > 0 ? { method: "GET", body: undefined } : {}),
        headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw new KretaError("A KRÉTA-kérés hálózati hibával leállt.", { cause });
    }
    jar.store(host, response);
    const location = response.headers.get("location");
    if (!follow || !location || response.status < 300 || response.status >= 400) {
      return response;
    }
    current = new URL(location, current).toString();
  }
  throw new KretaError("A KRÉTA bejelentkezés túl sok átirányítást kért.");
}

/**
 * Az első method="post" űrlap action-je és input név→érték párjai.
 * A cél egy ismert, generált IdentityServer-oldal, ezért az egyszerű
 * regex-értelmezés elegendő (a BeautifulSoup-hívás megfelelője).
 */
export function parseLoginForm(html) {
  const formMatch = html.match(/<form\b[^>]*>([\s\S]*?)<\/form>/gi) ?? [];
  for (const formHtml of formMatch) {
    const openTag = formHtml.match(/<form\b[^>]*>/i)[0];
    if (!/method\s*=\s*["']?post["']?/i.test(openTag)) continue;
    const action = attr(openTag, "action");
    if (!action) continue;
    const fields = {};
    for (const inputTag of formHtml.match(/<input\b[^>]*>/gi) ?? []) {
      const name = attr(inputTag, "name");
      if (name) fields[name] = attr(inputTag, "value") ?? "";
    }
    return { action, fields };
  }
  return null;
}

function attr(tag, name) {
  const match = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );
  if (!match) return null;
  const raw = match[2] ?? match[3] ?? match[4] ?? "";
  return raw
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function findCode(location, expectedState) {
  if (!location) return null;
  let query;
  try {
    query = new URL(location).searchParams;
  } catch {
    return null;
  }
  const code = query.get("code");
  if (code === null) return null;
  if (query.get("state") !== expectedState) {
    throw new KretaError("A bejelentkezési válasz state értéke nem egyezik.");
  }
  return code;
}

async function fetchToken(jar, data, failure) {
  const response = await request(jar, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data).toString(),
  });
  let token = null;
  if (response.ok) token = await response.json().catch(() => null);
  if (!token?.access_token) throw new KretaError(failure);
  return token;
}

/** Teljes Authorization Code + PKCE bejelentkezés; a token objektumot adja. */
export async function login(jar, credentials) {
  const codeVerifier = randomToken(64);
  const state = randomToken(32);
  const params = new URLSearchParams({
    prompt: "login",
    nonce: randomToken(32),
    response_type: "code",
    code_challenge_method: "S256",
    scope: SCOPE,
    code_challenge: base64urlSha256(codeVerifier),
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    state,
    suppressed_prompt: "login",
  });

  const loginPage = await request(jar, `${AUTHORIZE_URL}?${params}`, {
    follow: true,
    headers: { "User-Agent": WEB_USER_AGENT },
  });
  if (!loginPage.ok) {
    throw new KretaError("A KRÉTA bejelentkezési oldal nem érhető el.");
  }
  const form = parseLoginForm(await loginPage.text());
  if (!form) {
    throw new KretaError("A KRÉTA bejelentkezési űrlapja nem ismerhető fel.");
  }

  const payload = {
    ...form.fields,
    UserName: credentials.username,
    Password: credentials.password,
    InstituteCode: credentials.instituteCode,
    IsTemporaryLogin: "False",
    loginType: "InstituteLogin",
  };
  const formUrl = new URL(form.action, loginPage.url).toString();
  const submitted = await request(jar, formUrl, {
    method: "POST",
    headers: {
      "User-Agent": WEB_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(payload).toString(),
  });
  if (submitted.status >= 400) {
    throw new KretaError("A KRÉTA elutasította a bejelentkezési kérést.");
  }

  let code = findCode(
    absoluteLocation(submitted.headers.get("location"), formUrl),
    state,
  );
  if (code === null) {
    const returnUrl = form.fields.ReturnUrl ?? "";
    if (!returnUrl) {
      throw new KretaError("Nem érkezett bejelentkezési visszatérési URL.");
    }
    const callback = await request(
      jar,
      new URL(returnUrl, IDP_BASE_URL).toString(),
      { headers: { "User-Agent": WEB_USER_AGENT } },
    );
    if (callback.status >= 400) {
      throw new KretaError("A KRÉTA bejelentkezési visszahívása sikertelen.");
    }
    code = findCode(
      absoluteLocation(callback.headers.get("location"), IDP_BASE_URL),
      state,
    );
  }
  if (code === null) {
    throw new KretaError(
      "Sikertelen bejelentkezés. Ellenőrizd az azonosítót, a jelszót és " +
        "az intézmény kódját.",
    );
  }

  return fetchToken(
    jar,
    {
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
    },
    "A KRÉTA nem adott használható hozzáférési tokent.",
  );
}

/** Access token frissítése; ha a válaszból hiányzik, megtartja a régi refresh tokent. */
export async function refresh(jar, refreshToken) {
  const token = await fetchToken(
    jar,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    },
    "A KRÉTA hozzáférési token frissítése sikertelen.",
  );
  if (!token.refresh_token) token.refresh_token = refreshToken;
  return token;
}

/** Refresh token visszavonása; hibát sosem dob. */
export async function revokeRefreshToken(jar, refreshToken) {
  try {
    const response = await request(jar, REVOCATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: refreshToken,
        client_id: CLIENT_ID,
      }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function absoluteLocation(location, base) {
  if (!location) return null;
  try {
    return new URL(location, base).toString();
  } catch {
    return null;
  }
}
