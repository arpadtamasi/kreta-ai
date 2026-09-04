/**
 * OAuth 2.1 Authorization Server for MCP clients. Google identifies the
 * parent; the already connected child profiles determine the grant. KRÉTA
 * credentials never appear in this client-facing authorization flow.
 */
import { Router } from "express";
import { readSessionCookie } from "../auth/session.js";
import type { VerifySessionCookie } from "../auth/types.js";
import type { Config } from "../config.js";
import { connectionIsOnline } from "../profiles/connection.js";
import { classroomConnectionIsActive } from "../classroom/connection.js";
import type { ChildProfileStore } from "../profiles/store.js";
import { randomId } from "../seal.js";
import { issueClientId, openClientId } from "./clients.js";
import { renderConsentPage, renderErrorPage } from "./pages.js";
import { verifyCodeVerifier } from "./pkce.js";
import type { ReplayCache } from "./replayCache.js";
import type { SealedAuthorizationCode, SealedChild, SealedSession } from "./types.js";

export interface OAuthRouterDeps {
  config: Config;
  codeReplayCache: ReplayCache;
  childProfileStore: ChildProfileStore;
  verifySessionCookie: VerifySessionCookie;
}

interface SealedAuthorizationRequest {
  jti: string;
  uid: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  returnTo: string;
  state?: string;
}

const AUTHORIZATION_REQUEST_TTL_SECONDS = 10 * 60;

/** Public origin of this deployment: explicit config wins, else the proxied request. */
function issuerOf(req: { protocol: string; get(name: string): string | undefined }, config: Config): string {
  if (config.issuer) return config.issuer.replace(/\/+$/, "");
  const host = req.get("host") ?? "localhost";
  return `${req.protocol}://${host}`;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function setupRedirect(returnTo: string): string {
  return `/?${new URLSearchParams({ return_to: returnTo }).toString()}#gyerekek`;
}

export function createOAuthRouter(deps: OAuthRouterDeps): Router {
  const { config, codeReplayCache } = deps;
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

  // --- /authorize: Google session -> already connected profiles -----------
  router.get("/authorize", (req, res) => {
    void (async () => {
      const query = req.query as Record<string, unknown>;
      const clientId = firstString(query.client_id);
      const redirectUri = firstString(query.redirect_uri);
      const responseType = firstString(query.response_type);
      const codeChallenge = firstString(query.code_challenge);
      const codeChallengeMethod = firstString(query.code_challenge_method);
      const state = firstString(query.state);
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
        res.set("Cache-Control", "no-store").redirect(302, setupRedirect(req.originalUrl));
        return;
      }

      const profiles = (await deps.childProfileStore.list(user.uid)).filter((profile) =>
        Boolean(
          (profile.connection && connectionIsOnline(profile.connection)) ||
          (profile.classroomConnection && classroomConnectionIsActive(profile.classroomConnection)),
        )
      );
      if (profiles.length === 0) {
        res.set("Cache-Control", "no-store").redirect(302, setupRedirect(req.originalUrl));
        return;
      }

      const authorizationRequest: SealedAuthorizationRequest = {
        jti: randomId(),
        uid: user.uid,
        clientId,
        redirectUri,
        codeChallenge,
        returnTo: req.originalUrl,
        ...(state ? { state } : {}),
      };
      res
        .set("Cache-Control", "no-store")
        .set("Content-Security-Policy", "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        .type("html")
        .send(renderConsentPage({
          clientName: client.n ?? "Claude",
          ...(user.name ? { parentName: user.name } : {}),
          childNames: profiles.map((profile) => profile.childName),
          authorizationRequest: sealer.seal(
            "request",
            authorizationRequest,
            AUTHORIZATION_REQUEST_TTL_SECONDS,
          ),
        }));
    })().catch(() => {
      res.status(503).type("html").send(
        renderErrorPage("A profilok nem érhetők el", "A gyerekprofilokat most nem sikerült betölteni. Próbáld újra."),
      );
    });
  });

  router.post("/authorize", (req, res) => {
    void (async () => {
      if (req.get("origin") !== issuerOf(req, config)) {
        res.status(403).type("html").send(
          renderErrorPage("Érvénytelen jóváhagyás", "A kapcsolódást csak az Üzenőfüzet oldalán lehet jóváhagyni."),
        );
        return;
      }

      const rawRequest = firstString(req.body?.authorization_request);
      const decision = firstString(req.body?.decision);
      let authorizationRequest: SealedAuthorizationRequest;
      try {
        if (!rawRequest) throw new Error("missing_request");
        authorizationRequest = sealer.open<SealedAuthorizationRequest>("request", rawRequest);
      } catch {
        res.status(400).type("html").send(
          renderErrorPage("Lejárt kérés", "Indítsd újra a Claude csatlakoztatását."),
        );
        return;
      }

      const client = openClientId(sealer, authorizationRequest.clientId);
      if (
        !client ||
        !client.r.includes(authorizationRequest.redirectUri) ||
        !config.allowedRedirectUris.includes(authorizationRequest.redirectUri)
      ) {
        res.status(400).type("html").send(
          renderErrorPage("Ismeretlen kliens", "A kapcsolódási kérés nem érvényes."),
        );
        return;
      }

      const sessionCookie = readSessionCookie(req);
      let user;
      try {
        if (!sessionCookie) throw new Error("missing_session");
        user = await deps.verifySessionCookie(sessionCookie);
        if (user.uid !== authorizationRequest.uid) throw new Error("session_mismatch");
      } catch {
        res.set("Cache-Control", "no-store").redirect(302, setupRedirect(authorizationRequest.returnTo));
        return;
      }

      if (!codeReplayCache.claim(authorizationRequest.jti)) {
        res.status(400).type("html").send(
          renderErrorPage("Már felhasznált kérés", "Indítsd újra a Claude csatlakoztatását."),
        );
        return;
      }

      const target = new URL(authorizationRequest.redirectUri);
      if (authorizationRequest.state) target.searchParams.set("state", authorizationRequest.state);
      if (decision !== "approve") {
        target.searchParams.set("error", "access_denied");
        target.searchParams.set("error_description", "A felhasználó nem hagyta jóvá a kapcsolódást.");
        res.set("Cache-Control", "no-store").redirect(302, target.toString());
        return;
      }

      const profiles = (await deps.childProfileStore.list(user.uid)).filter((profile) =>
        Boolean(
          (profile.connection && connectionIsOnline(profile.connection)) ||
          (profile.classroomConnection && classroomConnectionIsActive(profile.classroomConnection)),
        )
      );
      if (profiles.length === 0) {
        res.set("Cache-Control", "no-store").redirect(302, setupRedirect(authorizationRequest.returnTo));
        return;
      }

      const session: SealedSession = {
        uid: user.uid,
        sid: randomId(),
        connectedAt: Date.now(),
        children: profiles.map((profile): SealedChild => ({
          profileId: profile.id,
          label: profile.childName,
          instituteCode: profile.instituteCode,
        })),
      };
      const code: SealedAuthorizationCode = {
        jti: randomId(),
        clientId: authorizationRequest.clientId,
        redirectUri: authorizationRequest.redirectUri,
        codeChallenge: authorizationRequest.codeChallenge,
        session,
      };
      target.searchParams.set("code", sealer.seal("code", code, config.authorizationCodeTtlSeconds));
      res.set("Cache-Control", "no-store").redirect(302, target.toString());
    })().catch(() => {
      res.status(503).type("html").send(
        renderErrorPage("A profilok nem érhetők el", "A gyerekprofilokat most nem sikerült betölteni. Próbáld újra."),
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
