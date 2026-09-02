/**
 * Memóriában élő, csak olvasó KRÉTA API-kliens (a kreta_client.py portja).
 *
 * A tokenek csak memóriában élnek; a lejáró access tokent a kliens frissíti,
 * záráskor a refresh tokent visszavonja. Az egyidejű tool-hívások közös
 * login-t kapnak: az authenticate() egy folyamatban lévő ígéretet oszt meg.
 */

import {
  CookieJar,
  KretaError,
  MOBILE_API_KEY,
  MOBILE_USER_AGENT,
  TIMEOUT_MS,
  login,
  refresh,
  revokeRefreshToken,
} from "./kreta-auth.js";

export class KretaClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.jar = new CookieJar();
    this.token = null;
    this.expiresAt = 0;
    this.pending = null;
    this.baseUrl = `https://${credentials.instituteCode.toLowerCase()}.e-kreta.hu/ellenorzo/v3/`;
  }

  async authenticate({ forceRefresh = false } = {}) {
    if (
      !forceRefresh &&
      this.token?.access_token &&
      Date.now() < this.expiresAt - 60_000
    ) {
      return;
    }
    if (!this.pending) {
      this.pending = this.#renewToken().finally(() => {
        this.pending = null;
      });
    }
    await this.pending;
  }

  async #renewToken() {
    const refreshToken = this.token?.refresh_token ?? "";
    if (refreshToken) {
      try {
        this.#setToken(await refresh(this.jar, refreshToken));
        return;
      } catch (error) {
        if (!(error instanceof KretaError)) throw error;
        // Elutasított/lejárt refresh token: mehet a friss PKCE-bejelentkezés.
        this.token = null;
        this.expiresAt = 0;
      }
    }
    this.#setToken(await login(this.jar, this.credentials));
  }

  #setToken(token) {
    const expiresIn = Math.max(1, Number(token.expires_in) || 300);
    this.token = token;
    this.expiresAt = Date.now() + expiresIn * 1000;
  }

  /**
   * Relatív Student API-útvonal lekérése; a params lehet objektum vagy
   * [kulcs, érték] párok listája (utóbbi ismételt paraméterhez kell).
   */
  async getJson(path, params = null) {
    const normalized = path.replace(/^\/+/, "");
    if (
      !normalized ||
      normalized.includes("://") ||
      normalized.split("/").includes("..")
    ) {
      throw new KretaError("Csak relatív, rögzített KRÉTA API-útvonal használható.");
    }
    const query = new URLSearchParams(params ?? undefined).toString();
    const url = this.baseUrl + normalized + (query ? `?${query}` : "");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.authenticate({ forceRefresh: attempt === 1 });
      let response;
      try {
        response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.token?.access_token ?? ""}`,
            "User-Agent": MOBILE_USER_AGENT,
            apiKey: MOBILE_API_KEY,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (cause) {
        throw new KretaError("A KRÉTA API-kérés hálózati hibával leállt.", {
          cause,
        });
      }
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) {
        throw new KretaError(`A KRÉTA API HTTP ${response.status} választ adott.`);
      }
      const body = await response.text();
      if (response.status === 204 || !body) return null;
      try {
        return JSON.parse(body);
      } catch {
        throw new KretaError("A KRÉTA API nem JSON választ adott.");
      }
    }
    throw new KretaError("A KRÉTA munkamenet nem frissíthető.");
  }

  /** Bejelentkezik, és nem érzékeny kapcsolati metaadatokat ad vissza. */
  async status() {
    await this.authenticate();
    return {
      authenticated: true,
      label: this.credentials.label || null,
      institution: this.credentials.instituteCode,
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      read_only: true,
      token_storage: "memory_only",
    };
  }

  /** A memóriában lévő refresh token visszavonása. */
  async close() {
    const refreshToken = this.token?.refresh_token ?? "";
    this.token = null;
    this.expiresAt = 0;
    if (refreshToken) await revokeRefreshToken(this.jar, refreshToken);
  }
}
