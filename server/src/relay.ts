import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  assertFreshRelayRequest,
  KretaRelayError,
  openRelayPayload,
  sealRelayPayload,
  type RelayRequest,
  type RelayResponse,
} from "./kreta/relay.js";

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;
const seen = new Map<string, number>();

function pruneSeen(now: number): void {
  for (const [id, expiresAt] of seen) {
    if (expiresAt <= now) seen.delete(id);
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new KretaRelayError("A relay kérés túl nagy."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeRequestHeaders(pairs: [string, string][]): Headers {
  const headers = new Headers();
  const forbidden = new Set([
    "connection",
    "content-length",
    "host",
    "proxy-authorization",
    "transfer-encoding",
  ]);
  for (const [name, value] of pairs) {
    if (!forbidden.has(name.toLowerCase())) headers.append(name, value);
  }
  return headers;
}

function responseHeaderPairs(headers: Headers): [string, string][] {
  const pairs: [string, string][] = [];
  headers.forEach((value, name) => {
    if (name !== "set-cookie") pairs.push([name, value]);
  });
  for (const cookie of headers.getSetCookie()) pairs.push(["set-cookie", cookie]);
  return pairs;
}

async function fetchUpstream(request: RelayRequest): Promise<RelayResponse> {
  const now = Date.now();
  assertFreshRelayRequest(request, now);
  pruneSeen(now);
  if (seen.has(request.id)) throw new KretaRelayError("A relay kérés már fel lett használva.");
  seen.set(request.id, now + 2 * 60_000);

  try {
    const method = request.request.method.toUpperCase();
    const requestBody =
      method === "GET" || method === "HEAD" ? undefined : request.request.body ?? undefined;
    const response = await fetch(request.request.url, {
      method,
      headers: safeRequestHeaders(request.request.headers),
      ...(requestBody === undefined ? {} : { body: requestBody }),
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_RESPONSE_BYTES) throw new KretaRelayError("A KRÉTA válasza túl nagy.");
    return {
      id: request.id,
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaderPairs(response.headers),
        bodyBase64: body.toString("base64"),
      },
    };
  } catch (error) {
    return {
      id: request.id,
      error: error instanceof KretaRelayError ? error.message : "A KRÉTA-kérés hálózati hibával leállt.",
    };
  }
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse, key: string): Promise<void> {
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/v1/fetch") {
    send(res, 404, JSON.stringify({ error: "not_found" }));
    return;
  }

  try {
    const request = openRelayPayload<RelayRequest>(await readBody(req), key);
    const result = await fetchUpstream(request);
    send(res, result.error ? 502 : 200, sealRelayPayload(result, key));
  } catch (error) {
    const message = error instanceof KretaRelayError ? error.message : "Érvénytelen relay kérés.";
    send(res, 400, sealRelayPayload({ id: "invalid", error: message } satisfies RelayResponse, key));
  }
}

function main(): void {
  const key = process.env.KRETA_RELAY_KEY?.trim() ?? "";
  if (!key) throw new KretaRelayError("A helyi relayhez KRETA_RELAY_KEY szükséges.");
  const port = Number(process.env.RELAY_PORT ?? "39090");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new KretaRelayError("A RELAY_PORT érvénytelen.");
  }
  createServer((req, res) => {
    void handle(req, res, key);
  }).listen(port, "127.0.0.1", () => {
    process.stdout.write(`Üzenőfüzet KRÉTA relay listening on 127.0.0.1:${port}\n`);
  });
}

main();
