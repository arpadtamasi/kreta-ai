import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";

const AAD = Buffer.from("uzenofuzet-kreta-relay-v1", "utf8");
const MAX_CLOCK_SKEW_MS = 60_000;

export interface RelayRequest {
  id: string;
  issuedAt: number;
  request: {
    url: string;
    method: string;
    headers: [string, string][];
    body: string | null;
  };
}

export interface RelayResponse {
  id: string;
  response?: {
    status: number;
    statusText: string;
    headers: [string, string][];
    bodyBase64: string;
  };
  error?: string;
}

interface SealedPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}

export class KretaRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KretaRelayError";
  }
}

function decodeKey(encoded: string): Buffer {
  const key = Buffer.from(encoded.trim(), "base64url");
  if (key.length !== 32) {
    throw new KretaRelayError("A KRETA_RELAY_KEY pontosan 32 bájtos base64url kulcs legyen.");
  }
  return key;
}

export function sealRelayPayload(payload: unknown, encodedKey: string): string {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  } satisfies SealedPayload);
}

export function openRelayPayload<T>(sealed: string, encodedKey: string): T {
  const key = decodeKey(encodedKey);
  let payload: SealedPayload;
  try {
    payload = JSON.parse(sealed) as SealedPayload;
    if (
      typeof payload.iv !== "string" ||
      typeof payload.ciphertext !== "string" ||
      typeof payload.tag !== "string"
    ) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    throw new KretaRelayError("A relay üzenete nem hiteles vagy sérült.");
  }
}

export function isAllowedKretaUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "e-kreta.hu" ||
    host.endsWith(".e-kreta.hu") ||
    host === "ekreta.hu" ||
    host.endsWith(".ekreta.hu")
  );
}

function requestUrl(input: string | URL | Request): string {
  if (input instanceof Request) return input.url;
  return input.toString();
}

function requestMethod(input: string | URL | Request, init?: RequestInit): string {
  return (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
}

async function requestBody(input: string | URL | Request, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === "string") return init.body;
  if (init?.body instanceof URLSearchParams) return init.body.toString();
  if (init?.body !== undefined && init.body !== null) {
    throw new KretaRelayError("A relay csak szöveges HTTP-kéréstörzset fogad.");
  }
  if (input instanceof Request && input.body !== null) return input.clone().text();
  return null;
}

function requestHeaders(input: string | URL | Request, init?: RequestInit): [string, string][] {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return [...headers.entries()];
}

function responseHeaders(pairs: [string, string][]): Headers {
  const headers = new Headers();
  for (const [name, value] of pairs) headers.append(name, value);
  return headers;
}

export function createKretaRelayFetch(options: {
  relayUrl: string;
  relayKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): typeof fetch {
  const relayUrl = new URL(options.relayUrl);
  if (relayUrl.protocol !== "https:") {
    throw new KretaRelayError("A KRETA_RELAY_URL csak HTTPS-cím lehet.");
  }
  decodeKey(options.relayKey);
  const directFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const now = options.now ?? Date.now;

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (!isAllowedKretaUrl(url)) return directFetch(input, init);

    const id = randomUUID();
    const request: RelayRequest = {
      id,
      issuedAt: now(),
      request: {
        url,
        method: requestMethod(input, init),
        headers: requestHeaders(input, init),
        body: await requestBody(input, init),
      },
    };
    const outer = await directFetch(relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: sealRelayPayload(request, options.relayKey),
      redirect: "error",
      signal: init?.signal ?? null,
    });
    const result = openRelayPayload<RelayResponse>(await outer.text(), options.relayKey);
    if (result.id !== id) throw new KretaRelayError("A relay válasza nem ehhez a kéréshez tartozik.");
    if (!outer.ok || result.error || !result.response) {
      throw new KretaRelayError(result.error ?? "A KRÉTA relay nem válaszolt megfelelően.");
    }
    const hasNoBody = [204, 205, 304].includes(result.response.status);
    return new Response(
      hasNoBody ? null : Buffer.from(result.response.bodyBase64, "base64"),
      {
        status: result.response.status,
        statusText: result.response.statusText,
        headers: responseHeaders(result.response.headers),
      },
    );
  };
}

export function installKretaRelayFromEnv(env: NodeJS.ProcessEnv = process.env): void {
  const relayUrl = env.KRETA_RELAY_URL?.trim() ?? "";
  const relayKey = env.KRETA_RELAY_KEY?.trim() ?? "";
  if (!relayUrl && !relayKey) return;
  if (!relayUrl || !relayKey) {
    throw new KretaRelayError("A KRETA_RELAY_URL és KRETA_RELAY_KEY csak együtt állítható be.");
  }
  globalThis.fetch = createKretaRelayFetch({ relayUrl, relayKey });
}

export function assertFreshRelayRequest(request: RelayRequest, now = Date.now()): void {
  if (
    typeof request.id !== "string" ||
    !request.id ||
    !Number.isFinite(request.issuedAt) ||
    Math.abs(now - request.issuedAt) > MAX_CLOCK_SKEW_MS ||
    !isAllowedKretaUrl(request.request?.url ?? "")
  ) {
    throw new KretaRelayError("Érvénytelen vagy lejárt relay kérés.");
  }
}
