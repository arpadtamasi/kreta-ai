/**
 * Read-only KRÉTA Student API client, ported from python/kreta_client.py.
 *
 * One instance serves one child for one MCP request: it holds no password,
 * only the encrypted profile's opened token pair. Only relative, fixed API
 * paths are accepted — there is
 * no "call any URL" escape hatch, and no write verb anywhere in the class.
 */
import { MOBILE_API_KEY, MOBILE_USER_AGENT, HTTP_TIMEOUT_MS } from "./constants.js";
import { KretaError } from "./institute.js";
import { refresh, type KretaTokens } from "./auth.js";

export interface KretaClientOptions {
  instituteCode: string;
  refreshToken: string;
  accessToken?: string;
  accessExpiresAt?: number;
  allowRefresh?: boolean;
  fetchImpl?: typeof fetch;
  /** Persists every newly minted access token and any rotated refresh token. */
  onRefresh?: (tokens: KretaTokens) => void | Promise<void>;
  /** Atomically reserves the current single-use refresh token. */
  onBeforeRefresh?: () => void | Promise<void>;
}

export class KretaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onRefresh: ((tokens: KretaTokens) => void | Promise<void>) | undefined;
  private readonly onBeforeRefresh: (() => void | Promise<void>) | undefined;
  private readonly allowRefresh: boolean;
  private refreshToken: string;
  private tokens: KretaTokens | null = null;
  private expiresAt = 0;
  private inFlight: Promise<void> | null = null;

  /** True once the IDP has handed back a refresh token differing from the presented one. */
  rotationObserved = false;

  constructor(options: KretaClientOptions) {
    this.baseUrl = `https://${options.instituteCode.toLowerCase()}.e-kreta.hu/ellenorzo/v3/`;
    this.refreshToken = options.refreshToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onRefresh = options.onRefresh;
    this.onBeforeRefresh = options.onBeforeRefresh;
    this.allowRefresh = options.allowRefresh ?? true;
    if (options.accessToken && options.accessExpiresAt) {
      this.tokens = {
        accessToken: options.accessToken,
        refreshToken: options.refreshToken,
        expiresIn: Math.max(1, Math.floor((options.accessExpiresAt - Date.now()) / 1000)),
        rotated: false,
      };
      this.expiresAt = options.accessExpiresAt;
    }
  }

  /** The newest refresh token seen, which may differ from the one passed in. */
  get currentRefreshToken(): string {
    return this.refreshToken;
  }

  private async authenticate(force = false): Promise<void> {
    if (!force && this.tokens && Date.now() < this.expiresAt - 60_000) return;
    if (!this.allowRefresh) {
      throw new KretaError("A 30 perces próbakapcsolat lejárt. Csatlakoztasd újra a gyereket a kapcsolati pulton.");
    }
    // Collapse concurrent tool calls onto one token request rather than
    // racing several refreshes for the same connection.
    if (!force && this.inFlight) return this.inFlight;

    const run = (async () => {
      await this.onBeforeRefresh?.();
      const tokens = await refresh(this.refreshToken, this.fetchImpl);
      this.tokens = tokens;
      this.expiresAt = Date.now() + tokens.expiresIn * 1000;
      if (tokens.refreshToken !== this.refreshToken) {
        this.refreshToken = tokens.refreshToken;
        this.rotationObserved = this.rotationObserved || tokens.rotated;
      }
      await this.onRefresh?.(tokens);
    })();
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** GETs a relative Student API path and returns its decoded JSON. */
  async getJson(
    path: string,
    // An array of pairs, not just a record: one endpoint
    // (Ertekelesek/Atlagok/OsztalyAtlagok) expects the same parameter twice.
    params?: Record<string, string | undefined> | Array<[string, string]>,
  ): Promise<unknown> {
    const normalized = path.replace(/^\/+/, "");
    if (!normalized || normalized.includes("://") || normalized.split("/").includes("..")) {
      throw new KretaError("Csak relatív, rögzített KRÉTA API-útvonal használható.");
    }

    const url = new URL(this.baseUrl + normalized);
    const pairs = Array.isArray(params) ? params : Object.entries(params ?? {});
    for (const [key, value] of pairs) {
      if (value !== undefined) url.searchParams.append(key, value);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.authenticate(attempt === 1);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            authorization: `Bearer ${this.tokens?.accessToken ?? ""}`,
            "user-agent": MOBILE_USER_AGENT,
            apiKey: MOBILE_API_KEY,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });
      } catch {
        throw new KretaError("A KRÉTA API-kérés hálózati hibával leállt.");
      }

      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) {
        throw new KretaError(`A KRÉTA API HTTP ${response.status} választ adott.`);
      }
      if (response.status === 204) return null;
      const body = await response.text();
      if (!body) return null;
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new KretaError("A KRÉTA API nem JSON választ adott.");
      }
    }

    throw new KretaError("A KRÉTA munkamenet nem frissíthető.");
  }
}
