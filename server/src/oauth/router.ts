/**
 * OAuth 2.1 Authorization Server for MCP clients — with one difference from
 * an ordinary AS: /authorize does not federate to an upstream identity
 * provider, because KRÉTA offers no third-party client registration to
 * federate with. Instead /authorize hosts the KRÉTA login itself, exchanges
 * the parent's credential for KRÉTA tokens on the spot, drops the password,
 * and seals the resulting refresh token into the authorization code.
 *
 * The KRÉTA password is still transient. A separate Firebase-authenticated
 * profile store keeps only the child's familiar name, KRÉTA username and
 * institution so the password manager sees an ordinary two-field login.
 * OAuth codes and KRÉTA tokens remain AES-256-GCM sealed blobs held by the
 * client (src/seal.ts).
 */
import { Router } from "express";
import { readSessionCookie } from "../auth/session.js";
import type { VerifySessionCookie } from "../auth/types.js";
import type { Config } from "../config.js";
import { login, type LoginCredentials } from "../kreta/auth.js";
import { KretaError } from "../kreta/institute.js";
import { normalizeChildName, type ChildProfile, type ChildProfileStore } from "../profiles/store.js";
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
  uid: string;
}

export interface OAuthRouterDeps {
  config: Config;
  codeReplayCache: ReplayCache;
  childProfileStore: ChildProfileStore;
  verifySessionCookie: VerifySessionCookie;
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

function authorizePath(request: SealedAuthorizationRequest): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  });
  if (request.state) query.set("state", request.state);
  if (request.scope) query.set("scope", request.scope);
  return `/authorize?${query.toString()}`;
}

function dashboardRedirect(returnTo: string): string {
  return `/dashboard?${new URLSearchParams({ return_to: returnTo }).toString()}#gyerekek`;
}

function profileForName(profiles: ChildProfile[], childName: string): ChildProfile | undefined {
  const normalizedName = normalizeChildName(childName);
  return profiles.find((profile) => profile.normalizedName === normalizedName);
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
    void (async () => {
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

      const sessionCookie = readSessionCookie(req);
      let user;
      try {
        if (!sessionCookie) throw new Error("missing_session");
        user = await deps.verifySessionCookie(sessionCookie);
      } catch {
        res.set("Cache-Control", "no-store").redirect(302, dashboardRedirect(req.originalUrl));
        return;
      }

      const profiles = await deps.childProfileStore.list(user.uid);
      if (profiles.length === 0) {
        res.set("Cache-Control", "no-store").redirect(302, dashboardRedirect(req.originalUrl));
        return;
      }

      const request: SealedAuthorizationRequest = {
        clientId,
        redirectUri,
        codeChallenge,
        uid: user.uid,
        ...(state ? { state } : {}),
        ...(scope ? { scope } : {}),
        ...(client.n ? { clientName: client.n } : {}),
      };

      res
        .type("html")
        .set("Cache-Control", "no-store")
        .send(
          renderLoginPage({
            request: sealer.seal("request", request, config.authorizationCodeTtlSeconds * 5),
            clientName: client.n,
            accountName: user.name,
            manageProfilesUrl: dashboardRedirect(authorizePath(request)),
            profiles,
          }),
        );
    })().catch(() => {
      res.status(503).type("html").send(
        renderErrorPage("A profilok nem érhetők el", "A gyerekprofilokat most nem sikerült betölteni. Próbáld újra."),
      );
    });
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

      const origin = req.get("origin");
      if (origin !== issuerOf(req, config)) {
        res.status(403).type("html").send(
          renderErrorPage("Nem engedélyezett kérés", "A belépést az Üzenőfüzet oldaláról kell elküldeni."),
        );
        return;
      }

      const sessionCookie = readSessionCookie(req);
      let user;
      try {
        if (!sessionCookie) throw new Error("missing_session");
        user = await deps.verifySessionCookie(sessionCookie);
        if (!request.uid || user.uid !== request.uid) throw new Error("session_changed");
      } catch {
        res.set("Cache-Control", "no-store").redirect(302, dashboardRedirect(authorizePath(request)));
        return;
      }

      const profiles = await deps.childProfileStore.list(user.uid);
      if (profiles.length === 0) {
        res.set("Cache-Control", "no-store").redirect(302, dashboardRedirect(authorizePath(request)));
        return;
      }

      const labels = asList(body.childName);
      const passwords = asList(body.password);

      const reject = (message: string): void => {
        res
          .status(400)
          .type("html")
          .set("cache-control", "no-store")
          .send(
            renderLoginPage({
              request: sealedRequest,
              clientName: request.clientName,
              accountName: user.name,
              manageProfilesUrl: dashboardRedirect(authorizePath(request)),
              profiles,
              selectedNames: labels,
              error: message,
            }),
          );
      };

      if (labels.length === 0 || labels.length !== passwords.length || labels.length > profiles.length) {
        reject("Hiányos űrlap: minden gyerekhez név és KRÉTA-jelszó kell.");
        return;
      }

      const credentials: Array<LoginCredentials & { label: string }> = [];
      const seen = new Set<string>();
      for (let index = 0; index < labels.length; index += 1) {
        const label = (labels[index] ?? "").trim();
        const password = passwords[index] ?? "";
        if (!label || !password) {
          reject("Hiányos adat: minden kitöltött gyerekhez név és KRÉTA-jelszó kell.");
          return;
        }
        const normalizedLabel = normalizeChildName(label);
        if (seen.has(normalizedLabel)) {
          reject(`Kétszer szerepel ugyanaz a név: ${label}. Adj mindegyik gyereknek külön nevet.`);
          return;
        }
        seen.add(normalizedLabel);
        const profile = profileForName(profiles, label);
        if (!profile) {
          reject(`Nincs „${label}” nevű gyerekprofil ebben a Google-fiókban.`);
          return;
        }
        credentials.push({
          label: profile.childName,
          username: profile.kretaUsername,
          password,
          instituteCode: profile.instituteCode,
        });
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
