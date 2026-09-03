/**
 * OAuth 2.1 Authorization Server for MCP clients — with one difference from
 * an ordinary AS: /authorize does not federate to an upstream identity
 * provider, because KRÉTA offers no third-party client registration to
 * federate with. Instead /authorize hosts the KRÉTA login itself, exchanges
 * the parent's credential for KRÉTA tokens on the spot, drops the password,
 * and seals the resulting refresh token into the authorization code.
 *
 * The consequence is that this layer stores nothing: no client table, no
 * code table, no token table, no per-user record anywhere. Every artifact it
 * issues is an AES-256-GCM sealed blob the client holds for us (src/seal.ts).
 */
import { Router } from "express";
import type { Config } from "../config.js";
import { login, type LoginCredentials } from "../kreta/auth.js";
import { KretaError, normalizeInstituteCode } from "../kreta/institute.js";
import { randomId } from "../seal.js";
import { issueClientId, openClientId } from "./clients.js";
import { renderErrorPage, renderLoginPage } from "./pages.js";
import { verifyCodeVerifier } from "./pkce.js";
import type { ReplayCache } from "./replayCache.js";
import type { SealedAuthorizationCode, SealedChild, SealedSession } from "./types.js";

/** The in-flight authorization request, carried through the login page. */
interface SealedAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  scope?: string;
  clientName?: string;
}

export interface OAuthRouterDeps {
  config: Config;
  codeReplayCache: ReplayCache;
  /** Injectable so tests exercise the whole flow without touching KRÉTA. */
  loginImpl?: typeof login;
}

/** Public origin of this deployment: explicit config wins, else the proxied request. */
function issuerOf(req: { protocol: string; get(name: string): string | undefined }, config: Config): string {
  if (config.issuer) return config.issuer.replace(/\/+$/, "");
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}`;
}

function asList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const { config, codeReplayCache } = deps;
  const doLogin = deps.loginImpl ?? login;
  const { sealer } = config;
  const router = Router();

  // --- Discovery (RFC 8414 + the MCP authorization spec) -------------------
  router.get("/.well-known/oauth-authorization-server", (req, res) => {
    const issuer = issuerOf(req, config);
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
    });
  });

  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    const issuer = issuerOf(req, config);
    res.json({ resource: issuer, authorization_servers: [issuer] });
  });

  // --- Dynamic Client Registration ----------------------------------------
  router.post("/register", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    if (redirectUris.length === 0 || !redirectUris.every((uri): uri is string => typeof uri === "string")) {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: "redirect_uris must be a non-empty array of strings",
      });
      return;
    }

    const rejected = redirectUris.filter((uri) => !config.allowedRedirectUris.includes(uri));
    if (rejected.length > 0) {
      res.status(400).json({
        error: "invalid_redirect_uri",
        error_description: `redirect_uri not allowed by this deployment: ${rejected.join(", ")}`,
      });
      return;
    }

    const clientName = typeof body.client_name === "string" ? body.client_name.slice(0, 120) : undefined;
    const clientId = issueClientId(sealer, {
      ...(clientName ? { n: clientName } : {}),
      r: redirectUris,
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: sealer.deriveClientSecret(clientId),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_secret_expires_at: 0,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
      ...(clientName ? { client_name: clientName } : {}),
    });
  });

  // --- /authorize: show the KRÉTA login -----------------------------------
  router.get("/authorize", (req, res) => {
    const query = req.query as Record<string, unknown>;
    const clientId = firstString(query.client_id);
    const redirectUri = firstString(query.redirect_uri);
    const responseType = firstString(query.response_type);
    const codeChallenge = firstString(query.code_challenge);
    const codeChallengeMethod = firstString(query.code_challenge_method);
    const state = firstString(query.state);
    const scope = firstString(query.scope);

    if (!clientId || !redirectUri) {
      res.status(400).type("html").send(
        renderErrorPage("Hiányos kérés", "A kliens nem küldött client_id-t vagy redirect_uri-t."),
      );
      return;
    }

    const client = openClientId(sealer, clientId);
    if (!client) {
      res.status(401).type("html").send(
        renderErrorPage("Ismeretlen kliens", "Ez a client_id nem ettől a szolgáltatástól származik."),
      );
      return;
    }

    // Only ever redirect to a URI the client registered AND the deployment
    // allows — never echo back an arbitrary redirect_uri from the query.
    if (!client.r.includes(redirectUri) || !config.allowedRedirectUris.includes(redirectUri)) {
      res.status(400).type("html").send(
        renderErrorPage("Nem engedélyezett átirányítás", "A kért redirect_uri nem tartozik ehhez a klienshez."),
      );
      return;
    }

    // From here the redirect_uri is trusted, so protocol errors go back to
    // the client as an error redirect rather than dead-ending in the browser.
    const fail = (error: string, description: string): void => {
      const target = new URL(redirectUri);
      target.searchParams.set("error", error);
      target.searchParams.set("error_description", description);
      if (state) target.searchParams.set("state", state);
      res.redirect(302, target.toString());
    };

    if (responseType !== "code") {
      fail("unsupported_response_type", "Only response_type=code is supported.");
      return;
    }
    if (!codeChallenge || codeChallengeMethod !== "S256") {
      fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
      return;
    }

    const request: SealedAuthorizationRequest = {
      clientId,
      redirectUri,
      codeChallenge,
      ...(state ? { state } : {}),
      ...(scope ? { scope } : {}),
      ...(client.n ? { clientName: client.n } : {}),
    };

    res
      .type("html")
      .set("cache-control", "no-store")
      .send(
        renderLoginPage({
          request: sealer.seal("request", request, config.authorizationCodeTtlSeconds * 5),
          clientName: client.n,
        }),
      );
  });

  // --- /authorize/login: the KRÉTA sign-in itself -------------------------
  router.post("/authorize/login", (req, res) => {
    void (async () => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const sealedRequest = firstString(body.request);
      if (!sealedRequest) {
        res.status(400).type("html").send(
          renderErrorPage("Hiányos űrlap", "A bejelentkezési kérés azonosítója hiányzik."),
        );
        return;
      }

      let request: SealedAuthorizationRequest;
      try {
        request = sealer.open<SealedAuthorizationRequest>("request", sealedRequest);
      } catch {
        res.status(400).type("html").send(
          renderErrorPage(
            "Lejárt bejelentkezés",
            "A bejelentkezési ablak lejárt. Indítsd újra a csatlakoztatást Claude-ban.",
          ),
        );
        return;
      }

      const reject = (message: string): void => {
        res
          .status(400)
          .type("html")
          .set("cache-control", "no-store")
          .send(
            renderLoginPage({
              request: sealedRequest,
              clientName: request.clientName,
              error: message,
            }),
          );
      };

      const labels = asList(body.label);
      const usernames = asList(body.username);
      const passwords = asList(body.password);
      const instituteCodes = asList(body.instituteCode);

      // The form renders three fixed fieldsets and enables them in order, so
      // a mismatch here means a hand-crafted POST, not a parent's mistake.
      if (
        usernames.length === 0 ||
        new Set([labels.length, usernames.length, passwords.length, instituteCodes.length]).size !== 1
      ) {
        reject("Hiányos űrlap: minden gyerekhez név, felhasználónév, jelszó és intézménykód kell.");
        return;
      }

      const credentials: Array<LoginCredentials & { label: string }> = [];
      const seen = new Set<string>();
      for (let index = 0; index < usernames.length; index += 1) {
        const label = (labels[index] ?? "").trim();
        const username = (usernames[index] ?? "").trim();
        const password = passwords[index] ?? "";
        const rawCode = (instituteCodes[index] ?? "").trim();
        if (!label || !username || !password || !rawCode) {
          reject("Hiányos adat: minden kitöltött gyerekhez mind a négy mező kell.");
          return;
        }
        if (seen.has(label.toLowerCase())) {
          reject(`Kétszer szerepel ugyanaz a név: ${label}. Adj mindegyik gyereknek külön nevet.`);
          return;
        }
        seen.add(label.toLowerCase());
        try {
          credentials.push({
            label,
            username,
            password,
            instituteCode: normalizeInstituteCode(rawCode),
          });
        } catch (error) {
          reject(error instanceof KretaError ? error.message : "Érvénytelen intézménykód.");
          return;
        }
      }

      const children: SealedChild[] = [];
      for (const credential of credentials) {
        let tokens;
        try {
          tokens = await doLogin({
            username: credential.username,
            password: credential.password,
            instituteCode: credential.instituteCode,
          });
        } catch (error) {
          // Name the child so a parent connecting siblings knows which line
          // to fix; never echo the credential itself.
          const detail = error instanceof KretaError ? error.message : "Ismeretlen hiba a bejelentkezéskor.";
          reject(`${credential.label}: ${detail}`);
          return;
        }
        children.push({
          label: credential.label,
          instituteCode: credential.instituteCode,
          refreshToken: tokens.refreshToken,
        });
      }
      // Passwords were parameters of the calls above and are not referenced
      // again: nothing from `credentials` reaches the sealed session.

      const session: SealedSession = { sid: randomId(), children, connectedAt: Date.now() };
      const code: SealedAuthorizationCode = {
        jti: randomId(),
        clientId: request.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        session,
      };

      const target = new URL(request.redirectUri);
      target.searchParams.set("code", sealer.seal("code", code, config.authorizationCodeTtlSeconds));
      if (request.state) target.searchParams.set("state", request.state);
      res.set("cache-control", "no-store").redirect(302, target.toString());
    })().catch(() => {
      res.status(500).type("html").send(
        renderErrorPage("Váratlan hiba", "A bejelentkezés nem fejeződött be. Próbáld újra."),
      );
    });
  });

  // --- /token: authorization_code -> sealed access token ------------------
  router.post("/token", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (firstString(body.grant_type) !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    const rawCode = firstString(body.code);
    const redirectUri = firstString(body.redirect_uri);
    const clientId = firstString(body.client_id);
    const clientSecret = firstString(body.client_secret);
    const codeVerifier = firstString(body.code_verifier);
    if (!rawCode || !redirectUri || !clientId || !clientSecret || !codeVerifier) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    if (!openClientId(sealer, clientId) || !sealer.verifyClientSecret(clientId, clientSecret)) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    let code: SealedAuthorizationCode;
    try {
      code = sealer.open<SealedAuthorizationCode>("code", rawCode);
    } catch {
      res.status(400).json({ error: "invalid_grant", error_description: "Unknown or expired code" });
      return;
    }

    if (code.clientId !== clientId || code.redirectUri !== redirectUri) {
      res.status(400).json({ error: "invalid_grant", error_description: "client_id/redirect_uri mismatch" });
      return;
    }
    if (!verifyCodeVerifier(codeVerifier, code.codeChallenge)) {
      res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
      return;
    }
    // Single-use, enforced per instance — see ReplayCache for what that
    // does and does not guarantee beyond one Cloud Run instance.
    if (!codeReplayCache.claim(code.jti)) {
      res.status(400).json({ error: "invalid_grant", error_description: "Code has already been redeemed" });
      return;
    }

    res.set("cache-control", "no-store").json({
      access_token: sealer.seal("access", code.session, config.accessTokenTtlSeconds),
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
    });
  });

  return router;
}
